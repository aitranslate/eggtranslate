/**
 * Agent 全管线（对齐 AsrAgent）：
 * 1) Terminology tool-loop Agent
 * 2) 分窗 Translation Subagent (submit_translation) + 覆盖率重试
 * 3) 每窗 QA Agent；critical → 带反馈重译
 * 4) Checkpoint B1/B2 + Egg 事件（流式上屏 / 进度）
 */

import type { SubtitleEntry, TranslationConfig } from '@/types';
import { isAbortError } from '@/utils/errors';
import { getActiveProfile } from '@/utils/llmProfiles';
import { logger } from '@/utils/logger';
import { runTerminologyToolAgent } from './agents/terminologyAgent';
import {
  formatQaFeedback,
  hasCriticalIssues,
  runWindowQaAgent,
} from './agents/qaAgent';
import { runTranslateWindowAgent } from './agents/translateAgent';
import {
  clearAgentJob,
  computeAgentFingerprint,
  createEmptyJob,
  loadAgentJob,
  saveAgentJob,
} from './checkpointStore';
import { runTerminologyAgent } from './terminology';
import type {
  AgentEventHandler,
  AgentStage,
  GlossaryEntry,
  RunAgentTranslationInput,
} from './types';
import type { TranscriptEntry } from './toolTypes';
import type { AgentLoopToolHook } from './loop';
import { splitAgentWindows } from './windows';

function abortError(message = '翻译已取消'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortError();
}

async function emit(handler: AgentEventHandler, event: Parameters<AgentEventHandler>[0]) {
  await handler(event);
}

/** 将 loop 工具钩子映射为 AgentEvent（过程面板「工具」Tab） */
function makeToolBridge(
  onEvent: AgentEventHandler,
  stage: AgentStage
): AgentLoopToolHook {
  return async (e) => {
    if (e.phase === 'start') {
      await emit(onEvent, {
        type: 'tool_start',
        name: e.name,
        argsSummary: e.argsSummary,
        callId: e.callId,
        stage,
      });
      return;
    }
    await emit(onEvent, {
      type: 'tool_end',
      name: e.name,
      argsSummary: e.argsSummary,
      callId: e.callId,
      ok: e.ok !== false,
      detail: e.detail,
      durationMs: e.durationMs,
      stage,
    });
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

function toTranscriptEntries(entries: SubtitleEntry[]): TranscriptEntry[] {
  return entries.map((e, i) => ({
    index: i + 1,
    entryId: e.id,
    start: e.startTime,
    end: e.endTime,
    text: e.text || '',
  }));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 把模型返回的 index 映射到窗内 segment。
 * 兼容：全局 1-based / 窗内 1..n / 0-based（模型常混用）。
 */
export function resolveWindowSegment(
  segments: TranscriptEntry[],
  index: number
): TranscriptEntry | undefined {
  if (!segments.length || !Number.isFinite(index)) return undefined;
  const n = Math.trunc(index);
  const byExact = segments.find((s) => s.index === n);
  if (byExact) return byExact;
  // 优先窗内 1..len（模型常返回 1..n 而不是全局编号）
  if (n >= 1 && n <= segments.length) return segments[n - 1];
  // 0-based 兜底
  if (n >= 0 && n < segments.length) return segments[n];
  return undefined;
}

export function mapWindowTranslations(
  segments: TranscriptEntry[],
  translations: Array<{ index: number; text: string }>
): Array<{ entryId: number; text: string }> {
  const out: Array<{ entryId: number; text: string }> = [];
  const seen = new Set<number>();
  for (const t of translations) {
    const text = (t.text || '').trim();
    if (!text) continue;
    const seg = resolveWindowSegment(segments, t.index);
    if (!seg?.entryId || seen.has(seg.entryId)) continue;
    seen.add(seg.entryId);
    out.push({ entryId: seg.entryId, text });
  }
  return out;
}

/**
 * 完整 Agent 翻译管线。
 * 生命周期：成功必发 pipeline_end；非取消失败必发 pipeline_error 再抛出；取消只抛 AbortError。
 * 窗内翻译用 tool-loop；提交成功后 emit translation_partial 适配 Egg 流式 UI。
 */
export async function runAgentTranslation(
  entries: SubtitleEntry[],
  input: RunAgentTranslationInput
): Promise<{ tokensUsed: number }> {
  try {
    return await executeAgentTranslation(entries, input);
  } catch (e) {
    if (isAbortError(e) || input.signal.aborted) {
      throw isAbortError(e) ? e : abortError();
    }
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await emit(input.onEvent, { type: 'pipeline_error', error: msg });
    } catch (emitErr) {
      logger.error('emit pipeline_error failed:', emitErr);
    }
    throw e;
  }
}

async function executeAgentTranslation(
  entries: SubtitleEntry[],
  input: RunAgentTranslationInput
): Promise<{ tokensUsed: number }> {
  const {
    fileId,
    taskId,
    filename,
    config,
    signal,
    userTerms,
    onEvent,
  } = input;

  const windowSize = config.agentWindowSize ?? 30;
  const concurrency = config.agentMaxConcurrency ?? 3;
  const profile = getActiveProfile(config);
  const fingerprint = computeAgentFingerprint({
    entryTexts: entries.map((e) => e.text || ''),
    sourceLanguage: config.sourceLanguage,
    targetLanguage: config.targetLanguage,
    windowSize,
    model: profile.model || '',
    userTermsKey: userTerms
      .map((t) => `${t.original}\t${t.translation}`)
      .sort()
      .join('|'),
  });

  const windows = splitAgentWindows(entries, windowSize, 5);
  const allTranscript = toTranscriptEntries(entries);
  let tokensUsed = 0;

  await emit(onEvent, {
    type: 'pipeline_start',
    totalEntries: entries.length,
    totalWindows: windows.length,
  });

  let job = await loadAgentJob(taskId);
  if (job && job.fingerprint !== fingerprint) {
    logger.info('Agent job fingerprint 不匹配，丢弃旧断点');
    await clearAgentJob(taskId);
    job = null;
  }
  if (!job) {
    job = createEmptyJob({ taskId, fileId, fingerprint });
  }

  const skipIds = new Set(
    entries
      .filter((e) => e.translationStatus === 'completed' && e.translatedText?.trim())
      .map((e) => e.id)
  );

  const resumedFromJob: Array<{ entryId: number; text: string }> = [];
  for (const map of Object.values(job.windowResults)) {
    for (const [idStr, text] of Object.entries(map)) {
      const id = Number(idStr);
      if (text?.trim()) {
        skipIds.add(id);
        resumedFromJob.push({ entryId: id, text });
      }
    }
  }
  if (resumedFromJob.length) {
    await emit(onEvent, {
      type: 'window_done',
      windowIndex: -1,
      translations: resumedFromJob,
      tokensUsed: 0,
    });
  }

  let glossary: GlossaryEntry[] = job.glossary || [];
  let styleGuide = job.styleGuide || '';

  let persistChain: Promise<void> = Promise.resolve();
  const persistJob = () => {
    persistChain = persistChain.then(() => saveAgentJob(job!));
    return persistChain;
  };

  // ── B1 Terminology Agent (tool loop) ──
  if (job.stage === 'terminology' || !styleGuide) {
    assertNotAborted(signal);
    await emit(onEvent, {
      type: 'stage',
      stage: 'terminology',
      detail: 'Terminology Agent…',
    });
    await emit(onEvent, {
      type: 'progress',
      completedEntries: skipIds.size,
      totalEntries: entries.length,
      statusText: 'Agent：术语分析中（tool loop）…',
    });

    let termTokens = 0;
    try {
      const term = await runTerminologyToolAgent({
        entries: allTranscript,
        config,
        userTerms,
        title: filename,
        signal,
        maxRounds: 30,
        onTool: makeToolBridge(onEvent, 'terminology'),
      });
      glossary = term.glossary;
      styleGuide = term.styleGuide;
      termTokens = term.tokensUsed;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      logger.error('Terminology tool agent failed, fallback single-shot:', e);
      const fb = await runTerminologyAgent(
        entries,
        config,
        userTerms,
        filename,
        signal,
        input.callLlmForTerminology
      );
      glossary = fb.glossary;
      styleGuide = fb.styleGuide;
      termTokens = fb.tokensUsed;
    }

    tokensUsed += termTokens;
    job.glossary = glossary;
    job.styleGuide = styleGuide;
    job.stage = 'translate';
    await persistJob();

    await emit(onEvent, {
      type: 'terminology_done',
      glossary,
      styleGuide,
      tokensUsed: termTokens,
    });
    await emit(onEvent, { type: 'checkpoint', boundary: 'B1' });
    await emit(onEvent, {
      type: 'progress',
      completedEntries: skipIds.size,
      totalEntries: entries.length,
      tokensDelta: termTokens,
      statusText: `Agent：术语完成（${glossary.length}）· 开始分窗翻译`,
    });
  } else {
    await emit(onEvent, {
      type: 'stage',
      stage: 'translate',
      detail: '从断点恢复…',
    });
  }

  // ── B2 Windows: translate subagent + QA ──
  await emit(onEvent, {
    type: 'stage',
    stage: 'translate',
    detail: `${windows.length} 窗 · 并发 ${concurrency}`,
  });

  let completedEntries = skipIds.size;

  await mapPool(windows, concurrency, async (win) => {
    assertNotAborted(signal);
    const winKey = String(win.windowIndex);

    if (job!.windowResults[winKey] && Object.keys(job!.windowResults[winKey]).length > 0) {
      return;
    }

    const targetIndices = win.entryIndices.filter((i) => {
      const e = entries[i];
      return e && !skipIds.has(e.id);
    });
    if (!targetIndices.length) {
      job!.windowResults[winKey] = {};
      return;
    }

    // 窗内编号固定 1..n（勿用全局 id）：模型常返回 1..n，全局编号会导致映射失败→进度有数、列表无译文
    const windowSegments: TranscriptEntry[] = targetIndices.map((i, local) => ({
      index: local + 1,
      entryId: entries[i].id,
      start: entries[i].startTime,
      end: entries[i].endTime,
      text: entries[i].text || '',
    }));

    const contextBefore: TranscriptEntry[] = win.contextBeforeIndices.map((i, local) => ({
      index: -(local + 1), // 负号仅标记上下文，不参与 submit 覆盖
      entryId: entries[i].id,
      text: entries[i].text || '',
      start: entries[i].startTime,
      end: entries[i].endTime,
    }));
    const contextAfter: TranscriptEntry[] = win.contextAfterIndices.map((i, local) => ({
      index: 10_000 + local + 1,
      entryId: entries[i].id,
      text: entries[i].text || '',
      start: entries[i].startTime,
      end: entries[i].endTime,
    }));

    const entryIds = windowSegments.map((s) => s.entryId!).filter(Boolean);
    await emit(onEvent, {
      type: 'window_start',
      windowIndex: win.windowIndex,
      entryIds,
    });

    let translations: Array<{ index: number; text: string }> = [];
    let winTokens = 0;
    let qaFeedback: string | undefined;

    // 覆盖率重试（对齐 AsrAgent retries=3）
    for (let attempt = 1; attempt <= 3; attempt++) {
      assertNotAborted(signal);
      const tr = await runTranslateWindowAgent({
        window: {
          windowIndex: win.windowIndex,
          segments: windowSegments,
          contextBefore,
          contextAfter,
        },
        glossary,
        styleGuide,
        config,
        signal,
        qaFeedback,
        maxRounds: 24,
        onTool: makeToolBridge(onEvent, 'translate'),
      });
      winTokens += tr.tokensUsed;
      translations = tr.translations;
      const expected = new Set(windowSegments.map((s) => s.index));
      const got = new Set(translations.filter((t) => t.text.trim()).map((t) => t.index));
      const missing = [...expected].filter((i) => !got.has(i));
      if (!missing.length) break;
      qaFeedback =
        `Coverage incomplete (attempt ${attempt}/3). Missing indices: ${missing.join(', ')}. ` +
        `Resubmit FULL translations for every required index.`;
      if (attempt < 3) await sleep(400 * attempt);
    }

    /** 映射 index→entryId 并立即落库（勿等 QA，否则进度有数但列表长时间空白） */
    const commitWindowTranslations = async (
      rows: Array<{ index: number; text: string }>,
      tokensDelta?: number
    ) => {
      const finalized = mapWindowTranslations(windowSegments, rows);
      if (finalized.length) {
        // 先 partial 上屏，再 window_done 写 store（clear overlay）
        await emit(onEvent, { type: 'translation_partial', updates: finalized });
        await emit(onEvent, {
          type: 'window_done',
          windowIndex: win.windowIndex,
          translations: finalized,
          tokensUsed: tokensDelta ?? 0,
        });
      }

      const winMap: Record<number, string> = {};
      for (const f of finalized) {
        winMap[f.entryId] = f.text;
        skipIds.add(f.entryId);
      }
      // 无有效映射时不要写空窗结果挡住重试
      if (Object.keys(winMap).length > 0) {
        job!.windowResults[winKey] = winMap;
        await persistJob();
      }

      completedEntries = skipIds.size;
      await emit(onEvent, {
        type: 'progress',
        completedEntries,
        totalEntries: entries.length,
        tokensDelta: tokensDelta && tokensDelta > 0 ? tokensDelta : undefined,
        statusText: `Agent：${completedEntries}/${entries.length} · 窗 ${win.windowIndex + 1}/${windows.length}`,
      });
      return finalized;
    };

    // 译完立刻落库上屏（修复：进度 1/32 但列表仍空——原先要等 QA 才 window_done）
    const firstDelta = winTokens;
    await commitWindowTranslations(translations, firstDelta);

    // 窗级 QA + critical 重译（对齐 AsrAgent qa_retries=2）
    for (let qaAttempt = 1; qaAttempt <= 2; qaAttempt++) {
      assertNotAborted(signal);
      await emit(onEvent, {
        type: 'stage',
        stage: 'qa',
        detail: `窗 ${win.windowIndex + 1} QA (${qaAttempt}/2)`,
      });
      const qa = await runWindowQaAgent({
        segments: windowSegments,
        translations,
        glossary,
        styleGuide,
        config,
        signal,
        maxRounds: 16,
        onTool: makeToolBridge(onEvent, 'qa'),
      });
      winTokens += qa.tokensUsed;
      const critical = qa.issues.filter(
        (i) => String(i.severity || '').toLowerCase() === 'critical'
      ).length;
      await emit(onEvent, {
        type: 'qa_result',
        windowIndex: win.windowIndex,
        critical,
        total: qa.issues.length,
        summary:
          critical > 0
            ? `窗 ${win.windowIndex + 1}：${critical} 条 critical，将重译`
            : `窗 ${win.windowIndex + 1} QA 通过`,
      });
      if (!hasCriticalIssues(qa.issues)) {
        if (qa.tokensUsed > 0) {
          await emit(onEvent, {
            type: 'progress',
            completedEntries: skipIds.size,
            totalEntries: entries.length,
            tokensDelta: qa.tokensUsed,
            statusText: `Agent：${skipIds.size}/${entries.length} · 窗 ${win.windowIndex + 1}/${windows.length}`,
          });
        }
        break;
      }

      const feedback = formatQaFeedback(qa.issues);
      logger.info(
        `Agent 窗 ${win.windowIndex} QA critical，重译 (${qaAttempt}/2)`,
        feedback
      );
      const tr = await runTranslateWindowAgent({
        window: {
          windowIndex: win.windowIndex,
          segments: windowSegments,
          contextBefore,
          contextAfter,
        },
        glossary,
        styleGuide,
        config,
        signal,
        qaFeedback: feedback,
        maxRounds: 24,
        onTool: makeToolBridge(onEvent, 'translate'),
      });
      winTokens += tr.tokensUsed;
      translations = tr.translations;
      // 只把本轮新增消耗计入 tokensDelta，避免与首轮重复
      await commitWindowTranslations(translations, tr.tokensUsed + qa.tokensUsed);
    }

    tokensUsed += winTokens;
    await emit(onEvent, { type: 'checkpoint', boundary: 'B2' });
  });

  await persistChain;
  job.stage = 'done';
  await persistJob();
  await emit(onEvent, { type: 'stage', stage: 'finalize' });
  await emit(onEvent, { type: 'checkpoint', boundary: 'B3' });
  await emit(onEvent, {
    type: 'progress',
    completedEntries: entries.length,
    totalEntries: entries.length,
    statusText: 'Agent：完成',
  });
  await emit(onEvent, { type: 'pipeline_end' });
  await clearAgentJob(taskId);

  return { tokensUsed };
}
