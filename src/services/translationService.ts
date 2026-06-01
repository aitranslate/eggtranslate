/**
 * 翻译 Service
 * 编排翻译流程 + 原子 split+align 操作
 *
 * 从原 subtitleStore.startTranslation 提取（463 行 → service 层）
 * - 通过 useFilesStore.getState() 访问状态
 * - 不再持有业务编排逻辑在 store 内
 */

import { useFilesStore } from '@/stores/filesStore';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { useTermsStore } from '@/stores/termsStore';
import { executeTranslation } from './TranslationOrchestrator';
import { mapSourcePartsToBoundaries, boundariesToRanges } from '@/utils/sourceSplitBoundaries';
import { formatTime, parseTime } from '@/utils/timeUtils';
import { countUnits } from '@/utils/textUnitCounter';
import { getSourceLimit, getTargetLimit } from '@/utils/subtitleLengthPresets';
import { toAppError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import {
  getRelevantTerms as getRelevantTermsUtil,
  formatTermsForPrompt as formatTermsForPromptUtil
} from '@/utils/termsHelpers';
import type { SubtitleEntry, Term, TranslationStatus, FilePhases } from '@/types';
import toast from 'react-hot-toast';

export async function startTranslation(
  fileId: string
): Promise<{ tokens: number; entries: SubtitleEntry[]; phases: FilePhases } | null> {
  const file = useFilesStore.getState().getFile(fileId);
  if (!file) return null;

  // 如果翻译已完成，跳过
  if (file.phases.translating.status === 'completed' && file.phases.splitting.status === 'completed') {
    logger.info('翻译和断句对齐都已完成，跳过');
    return null;
  }

  const translationConfigStore = useTranslationConfigStore.getState();
  const config = translationConfigStore.config;
  if (!translationConfigStore.isConfigured) {
    toast.error('请先配置翻译 API');
    return null;
  }

  try {
    const controller = await translationConfigStore.startTranslation(file.taskId);

    // 从 tasks 获取 entries（内存读取）
    const task = useFilesStore.getState().tasks.find(t => t.taskId === file.taskId);
    const entries = task?.subtitle_entries || [];

    // 恢复翻译进度（断点续跑时保持已有进度）
    const restoredProgress = file.phases.translating.progress > 0 ? file.phases.translating.progress : 0;
    const restoredTokens = file.phases.translating.tokens || 0;

    // 只有未完成才设置 active 状态，但保留已有进度和 tokens
    if (file.phases.translating.status !== 'completed') {
      useFilesStore.getState().updatePhase(fileId, 'translating', { status: 'active', progress: restoredProgress, tokens: restoredTokens });
    }
    if (file.phases.splitting.status !== 'completed') {
      useFilesStore.getState().updatePhase(fileId, 'splitting', { status: 'upcoming', progress: 0, tokens: 0 });
    }

    await executeTranslation(
      {
        entries,
        filename: file.name,
        config: {
          batchSize: config.batchSize,
          contextBefore: config.contextBefore,
          contextAfter: config.contextAfter,
          threadCount: config.threadCount
        },
        controller,
        taskId: file.taskId
      },
      {
        translateBatch: translationConfigStore.translateBatch,
        updateEntry: async (id: number, text: string, translatedText: string, status?: TranslationStatus) => {
          useFilesStore.getState().updateEntry(fileId, id, text, translatedText, status);
        },
        updateProgress: async (current: number, total: number, phase: 'direct' | 'splitting' | 'completed', status: string, taskId: string, newTokens?: number) => {
          await translationConfigStore.updateProgress(current, total, phase, status, taskId);

          if (newTokens !== undefined && newTokens > 0) {
            const prevTokens = useFilesStore.getState().getFile(fileId)?.tokensUsed || 0;
            const currentTokens = prevTokens + newTokens;
            useFilesStore.getState().updatePhase(fileId, 'translating', {
              progress: total > 0 ? Math.round((current / total) * 100) : 0,
              tokens: currentTokens
            });
          }
        },
        getRelevantTerms: (batchText: string, before: string, after: string): Term[] => {
          const allTerms = useTermsStore.getState().terms;
          return getRelevantTermsUtil(allTerms, batchText, before, after);
        },
        formatTermsForPrompt: (terms: Term[]): string => formatTermsForPromptUtil(terms)
      }
    );

    if (controller.signal.aborted) {
      logger.info('翻译已中止（文件已删除）');
      return null;
    }

    // 完成翻译 — 更新 tasks（内存操作）
    const tokensAfterTranslate = useFilesStore.getState().getFile(fileId)?.tokensUsed || 0;
    useFilesStore.getState().updatePhase(fileId, 'translating', { status: 'completed', progress: 100, tokens: tokensAfterTranslate });

    const aiSegmentationEnabled = useTranscriptionStore.getState().aiSegmentationEnabled;
    if (!aiSegmentationEnabled) {
      logger.info('AI 断句对齐已关闭，跳过');
      toast.success(`${file.name} 翻译完成`);
      const tokens = useFilesStore.getState().getFile(fileId)?.tokensUsed || 0;
      const finalTask = useFilesStore.getState().tasks.find(t => t.taskId === file.taskId);
      const finalFile = useFilesStore.getState().getFile(fileId);
      return { tokens, entries: finalTask?.subtitle_entries || entries, phases: finalFile!.phases };
    }

    let splitSucceeded = false;
    try {
      const preset = useTranscriptionStore.getState().subtitleLengthPreset;
      let postSplitEntries = useFilesStore.getState().tasks.find(t => t.taskId === file.taskId)?.subtitle_entries || [];

      // ============================================
      // 向后兼容：恢复使用旧 id encoding 的 composite entries
      // ============================================
      const compositeEntries = postSplitEntries.filter(e => e.id > 999999);
      if (compositeEntries.length > 0) {
        const groups = new Map<number, SubtitleEntry[]>();
        for (const ce of compositeEntries) {
          const parentId = Math.floor(ce.id / 1000000);
          const group = groups.get(parentId) || [];
          group.push(ce);
          groups.set(parentId, group);
        }
        for (const [parentId, parts] of groups) {
          const parent = postSplitEntries.find(e => e.id === parentId);
          if (parent) {
            parts.sort((a, b) => (a.id % 1000000) - (b.id % 1000000));
            const allParts = [parent, ...parts];
            const mergedText = allParts.map(p => p.text).join(' ');
            const mergedTranslation = allParts.map(p => p.translatedText || '').join(' ');
            const mergedWords = allParts.flatMap(p => p.words || []);
            const restoredStartTime = parent.startTime;
            const restoredEndTime = parts.length > 0 ? parts[parts.length - 1].endTime : parent.endTime;

            useFilesStore.getState().updateEntry(fileId, parentId, mergedText, mergedTranslation, undefined, restoredStartTime, restoredEndTime, mergedWords.length > 0 ? mergedWords : undefined);
          }
        }
        for (const ce of compositeEntries) {
          useFilesStore.getState().deleteEntry(fileId, ce.id);
        }
        postSplitEntries = useFilesStore.getState().tasks.find(t => t.taskId === file.taskId)?.subtitle_entries || [];
      }

      // ============================================
      // 原子 split+align 操作
      // ============================================

      // 获取需要处理的条目（无 parentId，未完成）
      const entriesToProcess = postSplitEntries.filter(e =>
        !e.parentId && e.splitAlignStatus !== 'completed'
      );

      if (entriesToProcess.length === 0) {
        logger.info('无需拆分的字幕');
        useFilesStore.getState().updatePhase(fileId, 'splitting', { status: 'completed', progress: 100 });
        splitSucceeded = true;
      } else {
        logger.info('开始 LLM 断句对齐...');

        // 恢复断句对齐进度（断点续跑时保持已有进度）
        const restoredSplitProgress = file.phases.splitting.progress > 0 ? file.phases.splitting.progress : 0;
        useFilesStore.getState().updatePhase(fileId, 'splitting', { status: 'active', progress: restoredSplitProgress, tokens: file.phases.splitting.tokens || 0 });

        // 计算已完成的条目数（用于进度显示）
        const alreadyCompletedCount = postSplitEntries.filter(e =>
          e.splitAlignStatus === 'completed'
        ).length;
        const totalToProcess = alreadyCompletedCount + entriesToProcess.length;
        const displayProgress = totalToProcess > 0 ? Math.round((alreadyCompletedCount / totalToProcess) * 100) : 0;
        await translationConfigStore.updateProgress(alreadyCompletedCount, totalToProcess, 'splitting', `断句对齐中... (${alreadyCompletedCount}/${totalToProcess})`, file.taskId);

        // 辅助函数：检查是否需要拆分
        const needsSplit = (entry: SubtitleEntry, sourceLimit: number, targetLimit: number): boolean => {
          const sourceUnits = countUnits(entry.text, config.sourceLanguage);
          const targetUnits = countUnits(entry.translatedText || '', config.targetLanguage);
          return sourceUnits > sourceLimit || targetUnits > targetLimit;
        };

        // 初始化 ID 计数器（读一次 store，后续原子递增）
        let nextSplitId = (() => {
          const entries = useFilesStore.getState().tasks.find(t => t.taskId === file.taskId)?.subtitle_entries || [];
          return entries.reduce((max, e) => Math.max(max, e.id), 0) + 1;
        })();

        // 辅助函数：执行单条 entry 的原子 split+align
        const performSplitAlignAtomic = async (
          entry: SubtitleEntry,
          sourceLimit: number,
          targetLimit: number
        ): Promise<{ success: boolean; tokens: number }> => {
          try {
            let entryTokens = 0;

            // 1. 调用 llmSourceSplit（单条）
            const fullSourceText = entry.text;
            const fullDraftTranslation = entry.translatedText || '';

            const sourceUnits = countUnits(entry.text, config.sourceLanguage);
            const targetUnits = countUnits(entry.translatedText || '', config.targetLanguage);
            const mustSplit = sourceUnits > sourceLimit * 1.5 || targetUnits > targetLimit * 1.5;

            const splitPrompt = {
              sourceLanguage: config.sourceLanguage,
              targetLanguage: config.targetLanguage,
              fullSourceText,
              fullDraftTranslation,
              sourceText: entry.text,
              sourceLimit,
              targetLimit,
              splitRound: 1,
              mustSplit,
            };

            // 直接调用 LLM（复用 llmSourceSplit 内部的 callLLMForSplit）
            const { buildSourceSplitPrompt } = await import('@/utils/splitAlignPrompts');
            const configStore = useTranslationConfigStore.getState().config;
            const { callLLM } = await import('@/utils/llmApi');
            const { jsonrepair } = await import('jsonrepair');

            const prompt = buildSourceSplitPrompt(splitPrompt);
            const result = await callLLM(
              { baseURL: configStore.baseURL, apiKey: configStore.apiKey, model: configStore.model, rpm: configStore.rpm },
              [
                { role: 'system', content: 'You are a subtitle segmentation assistant. Output JSON only.' },
                { role: 'user', content: JSON.stringify(prompt) },
              ],
              { temperature: 0.3 }
            );
            entryTokens += result.tokensUsed || 0;

            let parsed: { sourceParts: string[] };
            try {
              parsed = JSON.parse(result.content);
            } catch {
              const repaired = jsonrepair(result.content);
              parsed = JSON.parse(repaired);
            }

            if (!parsed.sourceParts || parsed.sourceParts.length <= 1) {
              // 无需拆分，标记完成
              return { success: true, tokens: entryTokens };
            }

            // 2. 调用 llmAlignTranslation
            const { buildAlignPrompt } = await import('@/utils/splitAlignPrompts');
            const alignPrompt = buildAlignPrompt({
              sourceLanguage: config.sourceLanguage,
              targetLanguage: config.targetLanguage,
              sourceText: entry.text,
              draftTranslation: entry.translatedText || '',
              splitSourceLines: parsed.sourceParts.map((s, i) => ({ id: i + 1, source: s })),
              theme: '',
              terminology: [],
            });

            const alignResult = await callLLM(
              { baseURL: configStore.baseURL, apiKey: configStore.apiKey, model: configStore.model, rpm: configStore.rpm },
              [
                { role: 'system', content: 'You are a subtitle alignment assistant. Output JSON only.' },
                { role: 'user', content: JSON.stringify(alignPrompt) },
              ],
              { temperature: 0.3 }
            );
            entryTokens += alignResult.tokensUsed || 0;

            let alignParsed: { translations: { id: number; text: string }[] };
            try {
              alignParsed = JSON.parse(alignResult.content);
            } catch {
              const repaired = jsonrepair(alignResult.content);
              alignParsed = JSON.parse(repaired);
            }

            const translations = alignParsed.translations || [];
            if (translations.length !== parsed.sourceParts.length) {
              logger.warn(`对齐结果数量不匹配，跳过条目 ${entry.id}`);
              return { success: false, tokens: entryTokens };
            }

            // 3. 创建子条目（直接修改内存 tasks）
            const words = entry.words;

            if (words && words.length > 0) {
              // 有单词级时间戳，使用边界映射
              const boundaries = mapSourcePartsToBoundaries(parsed.sourceParts, words, config.sourceLanguage);
              const ranges = boundariesToRanges(boundaries, words.length);

              // 更新父条目为第一个部分
              const firstStart = words[ranges[0][0]].start;
              const firstEnd = words[ranges[0][1]].end;
              const firstWords = words.slice(ranges[0][0], ranges[0][1] + 1);
              useFilesStore.getState().updateEntry(fileId, entry.id, parsed.sourceParts[0], translations[0]?.text || '', undefined, formatTime(firstStart), formatTime(firstEnd), firstWords);

              // 创建其余子条目（直接添加到 tasks）
              const childEntries: SubtitleEntry[] = [];
              for (let i = ranges.length - 1; i >= 1; i--) {
                const ws = words[ranges[i][0]];
                const we = words[ranges[i][1]];
                childEntries.push({
                  id: nextSplitId++,
                  parentId: entry.id,
                  splitIndex: i + 1,
                  startTime: formatTime(ws.start),
                  endTime: formatTime(we.end),
                  text: parsed.sourceParts[i],
                  translatedText: translations[i]?.text || '',
                  translationStatus: 'completed',
                  splitAlignStatus: 'completed',
                  words: words.slice(ranges[i][0], ranges[i][1] + 1),
                });
              }

              // 批量添加子条目到 tasks
              if (childEntries.length > 0) {
                useFilesStore.setState((state) => {
                  const newTasks = state.tasks.map(t => {
                    if (t.taskId !== file.taskId) return t;
                    return { ...t, subtitle_entries: [...(t.subtitle_entries || []), ...childEntries] };
                  });
                  return { tasks: newTasks };
                });
              }
            } else {
              // 无单词级时间戳，按长度比例分配时间
              const totalDuration = parseTime(entry.endTime) - parseTime(entry.startTime);
              const unitCounts = parsed.sourceParts.map(p => countUnits(p, config.sourceLanguage));
              const totalUnits = unitCounts.reduce((a, b) => a + b, 0);

              const partTimestamps: { start: number; end: number }[] = [];
              let offset = parseTime(entry.startTime);
              for (let i = 0; i < parsed.sourceParts.length; i++) {
                const duration = totalUnits > 0 ? (unitCounts[i] / totalUnits) * totalDuration : totalDuration / parsed.sourceParts.length;
                partTimestamps.push({ start: offset, end: offset + duration });
                offset += duration;
              }

              // 更新父条目为第一个部分
              useFilesStore.getState().updateEntry(fileId, entry.id, parsed.sourceParts[0], translations[0]?.text || '', undefined, formatTime(partTimestamps[0].start), formatTime(partTimestamps[0].end));

              // 创建其余子条目
              const childEntries: SubtitleEntry[] = [];
              for (let i = parsed.sourceParts.length - 1; i >= 1; i--) {
                childEntries.push({
                  id: nextSplitId++,
                  parentId: entry.id,
                  splitIndex: i + 1,
                  startTime: formatTime(partTimestamps[i].start),
                  endTime: formatTime(partTimestamps[i].end),
                  text: parsed.sourceParts[i],
                  translatedText: translations[i]?.text || '',
                  translationStatus: 'completed',
                  splitAlignStatus: 'completed',
                });
              }

              // 批量添加子条目到 tasks
              if (childEntries.length > 0) {
                useFilesStore.setState((state) => {
                  const newTasks = state.tasks.map(t => {
                    if (t.taskId !== file.taskId) return t;
                    return { ...t, subtitle_entries: [...(t.subtitle_entries || []), ...childEntries] };
                  });
                  return { tasks: newTasks };
                });
              }
            }

            return { success: true, tokens: entryTokens };
          } catch (error) {
            logger.warn(`原子 split+align 失败，条目 ${entry.id}:`, error);
            return { success: false, tokens: 0 };
          }
        };

        const sourceLimit = getSourceLimit(config.sourceLanguage, preset);
        const targetLimit = getTargetLimit(config.targetLanguage, preset);

        let completedCount = 0;
        let totalTokens = 0;

        // 按 threadCount 分块并发处理
        for (let i = 0; i < entriesToProcess.length; i += config.threadCount) {
          const chunk = entriesToProcess.slice(i, i + config.threadCount);

          const chunkResults = await Promise.all(
            chunk.map(async (entry) => {
              useFilesStore.getState().updateEntrySplitStatus(fileId, entry.id, 'in_progress');

              if (!needsSplit(entry, sourceLimit, targetLimit)) {
                useFilesStore.getState().updateEntrySplitStatus(fileId, entry.id, 'completed');
                return { success: true, tokens: 0 };
              }

              const result = await performSplitAlignAtomic(entry, sourceLimit, targetLimit);
              if (result.success) {
                useFilesStore.getState().updateEntrySplitStatus(fileId, entry.id, 'completed');
              } else {
                useFilesStore.getState().updateEntrySplitStatus(fileId, entry.id, 'pending');
              }
              return result;
            })
          );

          for (const result of chunkResults) {
            completedCount++;
            totalTokens += result.tokens;
            const percent = entriesToProcess.length > 0
              ? Math.round((completedCount / entriesToProcess.length) * 100)
              : 100;
            useFilesStore.getState().updatePhase(fileId, 'splitting', { progress: percent, tokens: totalTokens });
            await translationConfigStore.updateProgress(
              completedCount,
              entriesToProcess.length,
              'splitting',
              `断句对齐中 ${completedCount}/${entriesToProcess.length}`,
              file.taskId
            );
          }
        }

        useFilesStore.getState().updatePhase(fileId, 'splitting', {
          status: 'completed',
          progress: 100,
          tokens: totalTokens,
        });
        splitSucceeded = true;
        logger.info('LLM 断句对齐完成');
      }
    } catch (splitAlignError) {
      logger.warn('LLM 断句对齐失败，保留原始翻译:', splitAlignError);
      useFilesStore.getState().updatePhase(fileId, 'splitting', { status: 'failed', progress: 0 });
    }

    if (splitSucceeded) {
      toast.success(`${file.name} 翻译完成`);
    } else {
      toast.success(`${file.name} 翻译完成（断句对齐失败，保留原始分段）`);
    }

    const finalTokens = useFilesStore.getState().getFile(fileId)?.tokensUsed || 0;
    const finalTask = useFilesStore.getState().tasks.find(t => t.taskId === file.taskId);
    const lastEntries = finalTask?.subtitle_entries || entries;
    const finalPhases = useFilesStore.getState().getFile(fileId)?.phases;
    logger.info(`任务完成，总消耗 ${finalTokens} tokens`);
    return { tokens: finalTokens, entries: lastEntries, phases: finalPhases! };
  } catch (error) {
    const appError = toAppError(error, '翻译失败');
    logger.error(appError.message, appError);
    toast.error(`翻译失败: ${appError.message}`);

    const phases = useFilesStore.getState().getFile(fileId)?.phases;
    if (phases?.translating.status === 'active') {
      useFilesStore.getState().updatePhase(fileId, 'translating', {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
    if (phases?.splitting.status === 'active') {
      useFilesStore.getState().updatePhase(fileId, 'splitting', {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  } finally {
    useTranslationConfigStore.getState().stopTranslation();
  }
  return null;
}
