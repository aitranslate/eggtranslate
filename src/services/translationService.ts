/**
 * 翻译 Service
 * 编排单文件翻译流程：会话态 → Orchestrator → phase / 历史
 *
 * - 默认通过 store getState 接线（App 运行时）
 * - 可通过 deps 注入依赖（单测 / 将来非 React 宿主）
 * - agentTranslationEnabled：分叉到 Agent 管线（术语+分窗）；关则完全旧路径
 *
 * 注：断句（DP 断句）统一在转录阶段完成：音视频走 segmentWords，
 * 直接上传 SRT 不再二次断句。本服务只负责翻译，不含 AI 断句对齐。
 */

import { useFilesStore, flushFilesStorePersist } from '@/stores/filesStore';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { useTermsStore } from '@/stores/termsStore';
import { useStreamingOverlayStore } from '@/stores/streamingOverlayStore';
import { executeTranslation } from './TranslationOrchestrator';
import { translateBatch as llmTranslateBatch } from './llmTranslationService';
import type { AgentEvent } from './agent/types';
import { useAgentRunStore } from '@/stores/agentRunStore';
import { isAbortError, toAppError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import {
  getRelevantTerms as getRelevantTermsUtil,
  formatTermsForPrompt as formatTermsForPromptUtil
} from '@/utils/termsHelpers';
import type {
  SubtitleEntry,
  Term,
  FilePhases,
  SubtitleFileMetadata,
  TranslationConfig,
  TranslationStatus,
} from '@/types';
import toast from 'react-hot-toast';

/** 可注入依赖：单测时 mock，默认走全局 store */
export type TranslationServiceDeps = {
  getFile: (fileId: string) => SubtitleFileMetadata | undefined;
  getTaskEntries: (taskId: string) => SubtitleEntry[];
  getConfig: () => TranslationConfig;
  isConfigured: () => boolean;
  beginSession: (taskId: string) => Promise<AbortController>;
  endSession: () => void;
  updateUiProgress: (
    current: number,
    total: number,
    phase: 'direct' | 'completed',
    status: string,
    taskId?: string
  ) => Promise<void>;
  updatePhase: (
    fileId: string,
    phase: 'translating',
    update: Partial<FilePhases['translating']> & { tokensDelta?: number }
  ) => void;
  batchUpdateEntries: (
    fileId: string,
    updates: Array<{
      id: number;
      text: string;
      translatedText: string;
      status?: TranslationStatus;
    }>
  ) => void;
  applyStreamingPartials: (fileId: string, updates: Array<{ id: number; text: string }>) => void;
  clearStreamingIds: (fileId: string, ids: number[]) => void;
  clearStreamingFile: (fileId: string) => void;
  getTokensUsed: (fileId: string) => number;
  getAllTerms: () => Term[];
  flushPersist: () => Promise<void>;
  translateBatch: typeof llmTranslateBatch;
  notifySuccess: (message: string) => void;
  notifyError: (message: string) => void;
};

function createDefaultDeps(): TranslationServiceDeps {
  return {
    getFile: (fileId) => useFilesStore.getState().getFile(fileId),
    getTaskEntries: (taskId) => {
      const task = useFilesStore.getState().tasks.find((t) => t.taskId === taskId);
      return task?.subtitle_entries || [];
    },
    getConfig: () => useTranslationConfigStore.getState().config,
    isConfigured: () => useTranslationConfigStore.getState().isConfigured,
    beginSession: (taskId) => useTranslationConfigStore.getState().startTranslation(taskId),
    endSession: () => useTranslationConfigStore.getState().stopTranslation(),
    updateUiProgress: (current, total, phase, status, taskId) =>
      useTranslationConfigStore.getState().updateProgress(current, total, phase, status, taskId),
    updatePhase: (fileId, phase, update) =>
      useFilesStore.getState().updatePhase(fileId, phase, update),
    batchUpdateEntries: (fileId, updates) =>
      useFilesStore.getState().batchUpdateEntries(fileId, updates),
    applyStreamingPartials: (fileId, updates) =>
      useStreamingOverlayStore.getState().applyPartials(fileId, updates),
    clearStreamingIds: (fileId, ids) =>
      useStreamingOverlayStore.getState().clearIds(fileId, ids),
    clearStreamingFile: (fileId) => useStreamingOverlayStore.getState().clearFile(fileId),
    getTokensUsed: (fileId) => useFilesStore.getState().getFile(fileId)?.tokensUsed || 0,
    getAllTerms: () => useTermsStore.getState().terms,
    flushPersist: () => flushFilesStorePersist(),
    translateBatch: llmTranslateBatch,
    notifySuccess: (message) => toast.success(message),
    notifyError: (message) => toast.error(message),
  };
}

export async function startTranslation(
  fileId: string,
  depsOverride?: Partial<TranslationServiceDeps>
): Promise<{ tokens: number; entries: SubtitleEntry[]; phases: FilePhases } | null> {
  const deps = { ...createDefaultDeps(), ...depsOverride };

  const file = deps.getFile(fileId);
  if (!file) return null;

  // 如果翻译已完成，跳过
  if (file.phases.translating.status === 'completed') {
    logger.info('翻译已完成，跳过');
    return null;
  }

  const config = deps.getConfig();
  if (!deps.isConfigured()) {
    deps.notifyError('请先配置翻译 API');
    return null;
  }

  let controller: AbortController | null = null;
  const usedAgent = Boolean(config.agentTranslationEnabled);

  try {
    controller = await deps.beginSession(file.taskId);

    const entries = deps.getTaskEntries(file.taskId);

    // 恢复翻译进度（断点续跑时保持已有进度）
    const restoredProgress = file.phases.translating.progress > 0 ? file.phases.translating.progress : 0;
    const restoredTokens = file.phases.translating.tokens || 0;

    // 只有未完成才设置 active 状态，但保留已有进度和 tokens
    const translatingStatus = deps.getFile(fileId)?.phases.translating.status;
    if (translatingStatus !== 'completed') {
      deps.updatePhase(fileId, 'translating', {
        status: 'active',
        progress: restoredProgress,
        tokens: restoredTokens,
      });
    }

    // ── 唯一分叉：Agent 开 → 新管线；关 → 现有批译 ──
    // 设置开关只决定「这次」走哪条路；历史路径/快照写在任务上，关开关不擦除。
    if (usedAgent) {
      useFilesStore.getState().setTranslationPathMeta(fileId, {
        translationPath: 'agent',
      });
      await runAgentTranslationPath({
        fileId,
        file,
        entries,
        config,
        controller,
        deps,
      });
    } else {
      useFilesStore.getState().setTranslationPathMeta(fileId, {
        translationPath: 'batch',
      });
      await executeTranslation(
        {
          entries,
          filename: file.name,
          config: {
            batchSize: config.batchSize,
            contextBefore: config.contextBefore,
            contextAfter: config.contextAfter,
            threadCount: config.threadCount,
          },
          controller,
          taskId: file.taskId,
        },
        {
          translateBatch: (
            texts,
            signal,
            contextBefore,
            contextAfter,
            terms,
            onPartial,
            onAttemptStart
          ) =>
            deps.translateBatch(config, texts, {
              signal,
              contextBefore,
              contextAfter,
              terms,
              onPartial,
              onAttemptStart,
            }),
          batchUpdateEntries: (updates) => {
            deps.batchUpdateEntries(fileId, updates);
          },
          // 流式只打内存 overlay，不碰 filesStore / persist
          applyStreamingPartials: (updates) => {
            deps.applyStreamingPartials(fileId, updates);
          },
          clearStreamingIds: (ids) => {
            deps.clearStreamingIds(fileId, ids);
          },
          getCurrentEntries: () => deps.getTaskEntries(file.taskId),
          updateProgress: async (
            current: number,
            total: number,
            phase: 'direct' | 'completed',
            status: string,
            taskId: string,
            newTokens?: number
          ) => {
            await deps.updateUiProgress(current, total, phase, status, taskId);

            // 进度与 token 解耦；tokensDelta 在 store 内原子累加（并发 batch 安全）
            const progress = total > 0 ? Math.round((current / total) * 100) : 0;
            if (newTokens !== undefined && newTokens > 0) {
              deps.updatePhase(fileId, 'translating', {
                progress,
                tokensDelta: newTokens,
              });
            } else {
              deps.updatePhase(fileId, 'translating', { progress });
            }
          },
          getRelevantTerms: (batchText: string, before: string, after: string): Term[] => {
            return getRelevantTermsUtil(deps.getAllTerms(), batchText, before, after);
          },
          formatTermsForPrompt: (terms: Term[]): string => formatTermsForPromptUtil(terms),
        }
      );
    }

    if (controller.signal.aborted) {
      logger.info('翻译已中止');
      deps.clearStreamingFile(fileId);
      deactivateAgentRunIfNeeded(fileId);
      return null;
    }

    // 完成翻译 — 更新 tasks（内存操作）；updatePhase(completed) 会 flush persist
    deps.clearStreamingFile(fileId);
    const finalTokens = deps.getTokensUsed(fileId);
    deps.updatePhase(fileId, 'translating', {
      status: 'completed',
      progress: 100,
      tokens: finalTokens,
    });
    await deps.flushPersist();

    const lastEntries = deps.getTaskEntries(file.taskId);
    const finalPhases = deps.getFile(fileId)?.phases;
    deps.notifySuccess(`${file.name} 翻译完成`);
    logger.info(`任务完成，总消耗 ${finalTokens} tokens`);
    return { tokens: finalTokens, entries: lastEntries, phases: finalPhases! };
  } catch (error) {
    deps.clearStreamingFile(fileId);

    // 取消：与批译一致，不标 failed、不 toast 失败
    if (isAbortError(error) || controller?.signal.aborted) {
      logger.info('翻译已取消');
      deactivateAgentRunIfNeeded(fileId);
      return null;
    }

    const appError = toAppError(error, '翻译失败');
    logger.error(appError.message, appError);
    deps.notifyError(`翻译失败: ${appError.message}`);

    // Agent 管线已 emit pipeline_error + 快照；批译 / 漏网错误在此收尾 phase
    const phases = deps.getFile(fileId)?.phases;
    if (phases?.translating.status === 'active') {
      deps.updatePhase(fileId, 'translating', {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      // 若 Agent 路径未写入快照（异常未走事件），补一份
      if (usedAgent) {
        ensureAgentFailureSnapshot(
          fileId,
          file.taskId,
          error instanceof Error ? error.message : String(error)
        );
      }
      await deps.flushPersist();
    }
  } finally {
    deps.endSession();
  }
  return null;
}

/** 取消时收起 live Agent UI，不写成失败快照 */
function deactivateAgentRunIfNeeded(fileId: string) {
  const st = useAgentRunStore.getState().byFileId[fileId];
  if (!st?.active) return;
  useAgentRunStore.setState((s) => {
    const cur = s.byFileId[fileId];
    if (!cur?.active) return s;
    return {
      byFileId: {
        ...s.byFileId,
        [fileId]: {
          ...cur,
          active: false,
          compactBadge: '',
          compactSummary: '',
          actionLine: cur.actionLine || '已取消',
          updatedAt: Date.now(),
        },
      },
    };
  });
}

/** 失败快照兜底：pipeline 已 emit 时 store 已有 error 终态，再落盘一次幂等 */
function ensureAgentFailureSnapshot(fileId: string, taskId: string, error: string) {
  const st = useAgentRunStore.getState().byFileId[fileId];
  // 已由 pipeline_error 写入且 inactive
  if (st && !st.active && st.error) {
    useFilesStore.getState().setTranslationPathMeta(fileId, {
      translationPath: 'agent',
      agentSnapshot: {
        glossaryCount: st.glossaryCount ?? 0,
        styleGuidePreview: st.styleGuidePreview || undefined,
        lastActionLine: st.actionLine || `失败：${st.error}`,
        completedAt: Date.now(),
        error: st.error,
        totalEntries: st.totalEntries,
        totalWindows: st.totalWindows,
      },
    });
    return;
  }
  // store 仍 active 或无 error：合成终态事件
  useAgentRunStore.getState().applyEvent(fileId, taskId, {
    type: 'pipeline_error',
    error,
  });
  const after = useAgentRunStore.getState().byFileId[fileId];
  useFilesStore.getState().setTranslationPathMeta(fileId, {
    translationPath: 'agent',
    agentSnapshot: {
      glossaryCount: after?.glossaryCount ?? 0,
      styleGuidePreview: after?.styleGuidePreview || undefined,
      lastActionLine: after?.actionLine || `失败：${error}`,
      completedAt: Date.now(),
      error,
      totalEntries: after?.totalEntries,
      totalWindows: after?.totalWindows,
    },
  });
}

/**
 * Agent 路径：事件 → 现有 store（overlay / phase / entries）。
 * 与旧 orchestrator 隔离；仅 agentTranslationEnabled 时进入。
 */
async function runAgentTranslationPath(opts: {
  fileId: string;
  file: SubtitleFileMetadata;
  entries: SubtitleEntry[];
  config: TranslationConfig;
  controller: AbortController;
  deps: TranslationServiceDeps;
}): Promise<void> {
  const { fileId, file, entries, config, controller, deps } = opts;
  const total = entries.length || 1;
  // window_done 事件按 entryId 回查原文，预建索引避免每窗口 O(window × n) 线性查找
  const entriesById = new Map(entries.map((e) => [e.id, e]));

  /** 终态快照：success 显式 error=null，不会被旧 st.error 污染 */
  const persistAgentSnapshot = (outcome: 'success' | 'error', errorMessage?: string) => {
    const st = useAgentRunStore.getState().byFileId[fileId];
    const error =
      outcome === 'success' ? null : (errorMessage ?? st?.error ?? '未知错误');
    useFilesStore.getState().setTranslationPathMeta(fileId, {
      translationPath: 'agent',
      agentSnapshot: {
        glossaryCount: st?.glossaryCount ?? 0,
        styleGuidePreview: st?.styleGuidePreview || undefined,
        lastActionLine:
          st?.actionLine ||
          (error ? `失败：${error}` : 'Agent 流程完成'),
        completedAt: Date.now(),
        error,
        totalEntries: st?.totalEntries,
        totalWindows: st?.totalWindows,
      },
    });
  };

  const onEvent = async (event: AgentEvent) => {
    // UI 读模型：阶段摘要 / 大脑面板（与列表落库并行）
    useAgentRunStore.getState().applyEvent(fileId, file.taskId, event);

    switch (event.type) {
      case 'translation_partial':
        deps.applyStreamingPartials(
          fileId,
          event.updates.map((u) => ({ id: u.entryId, text: u.text }))
        );
        break;
      case 'window_done': {
        if (event.translations.length) {
          deps.batchUpdateEntries(
            fileId,
            event.translations.map((t) => ({
              id: t.entryId,
              text: entriesById.get(t.entryId)?.text ?? '',
              translatedText: t.text,
              status: 'completed' as TranslationStatus,
            }))
          );
          deps.clearStreamingIds(
            fileId,
            event.translations.map((t) => t.entryId)
          );
        }
        break;
      }
      case 'progress': {
        const progress =
          event.totalEntries > 0
            ? Math.min(
                99,
                Math.round((event.completedEntries / event.totalEntries) * 100)
              )
            : 0;
        // 术语阶段给 5–12% 可见进度
        const displayProgress =
          event.statusText?.includes('术语') && event.completedEntries === 0
            ? Math.max(progress, 8)
            : progress;
        // UI 进度条用短状态，长叙事只在大脑面板
        const shortStatus =
          useAgentRunStore.getState().byFileId[fileId]?.compactSummary ||
          'Agent 翻译中…';
        await deps.updateUiProgress(
          event.completedEntries,
          event.totalEntries || total,
          'direct',
          shortStatus,
          file.taskId
        );
        if (event.tokensDelta && event.tokensDelta > 0) {
          deps.updatePhase(fileId, 'translating', {
            progress: displayProgress,
            tokensDelta: event.tokensDelta,
          });
        } else {
          deps.updatePhase(fileId, 'translating', { progress: displayProgress });
        }
        break;
      }
      case 'pipeline_error':
        logger.error('Agent pipeline error:', event.error);
        persistAgentSnapshot('error', event.error);
        break;
      case 'pipeline_end':
        // 终态写入任务（持久化）；关设置也不丢
        persistAgentSnapshot('success');
        break;
      default:
        break;
    }
  };

  // 按需加载 Agent 管线：关 Agent 时冷启动不拉 pipeline / tool-loop 图
  const { runAgentTranslation } = await import('./agent');
  await runAgentTranslation(entries, {
    fileId,
    taskId: file.taskId,
    filename: file.name,
    config,
    signal: controller.signal,
    userTerms: deps.getAllTerms(),
    onEvent,
    translateBatch: (cfg, texts, options) => deps.translateBatch(cfg, texts, options),
  });
}
