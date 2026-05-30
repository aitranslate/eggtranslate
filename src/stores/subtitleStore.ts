/**
 * 字幕文件管理 Store
 * 替代原 SubtitleContext，使用 Zustand 管理状态
 */

import { create } from 'zustand';
import { SubtitleFile, SubtitleEntry, TranscriptionStatus, TranscriptionProgressInfo, SubtitleFileMetadata, Term, TranslationStatus } from '@/types';
import { loadFromFile, removeFile as removeFileData, clearAllData as clearAllFileData, restoreFiles, restoreFilesWithEntries, type SubtitleFile as SubtitleFileType } from '@/services/SubtitleFileManager';
import { runTranscriptionPipeline } from '@/services/transcriptionPipeline';
import { executeTranslation } from '@/services/TranslationOrchestrator';
import { llmSourceSplit, llmAlignTranslation } from '@/services/llmSplitAlign';
import dataManager from '@/services/dataManager';
import { generateStableFileId } from '@/utils/taskIdGenerator';
import { mapSourcePartsToBoundaries, boundariesToRanges } from '@/utils/sourceSplitBoundaries';
import { formatTime, parseTime } from '@/utils/timeUtils';
import { countUnits } from '@/utils/textUnitCounter';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { toAppError } from '@/utils/errors';
import toast from 'react-hot-toast';
import localforage from 'localforage';

// ============================================
// 循环导入解决
// ============================================

// 注意：这些 store 必须在使用前导入，避免运行时 undefined
// TypeScript 的类型检查允许延迟导入，但运行时需要实际可用的引用
import { useTranscriptionStore } from './transcriptionStore';
import { useTranslationConfigStore } from './translationConfigStore';

// ============================================
// 类型定义
// ============================================

interface SubtitleStore {
  // State
  files: SubtitleFileMetadata[];  // ✅ Phase 3: 改为轻量级元数据数组
  selectedFileId: string | null;

  // Actions - 文件操作
  loadFiles: () => Promise<void>;
  addFile: (file: File) => Promise<string>;
  removeFile: (fileId: string) => Promise<void>;
  selectFile: (fileId: string) => void;
  clearAll: () => Promise<void>;

  // Actions - 字幕操作
  updateEntry: (fileId: string, entryId: number, text: string, translatedText?: string, status?: TranslationStatus, startTime?: string, endTime?: string, words?: SubtitleEntry['words']) => Promise<void>;
  deleteEntry: (fileId: string, entryId: number) => Promise<void>;
  batchUpdateEntries: (fileId: string, updates: Array<{id: number, text: string, translatedText?: string}>) => Promise<void>;

  // Actions - 转录
  startTranscription: (fileId: string) => Promise<void>;
  updateTranscriptionProgress: (fileId: string, progress: TranscriptionProgressInfo) => void;
  updateTranscriptionStatus: (fileId: string, status: TranscriptionStatus) => void;

  // Actions - 翻译
  startTranslation: (fileId: string) => Promise<void>;
  updateTranslationProgress: (fileId: string, completed: number, total: number) => void;
  updateSplitProgress: (fileId: string, progress: number) => void;

  // ============================================
  // Tokens 管理（新增）
  // ============================================

  /**
   * 添加 tokens（转录或翻译）
   * @param fileId - 文件 ID
   * @param tokens - 新增的 tokens（会累加到现有值）
   */
  addTokens: (fileId: string, tokens: number) => void;

  /**
   * 设置 tokens（用于从 DataManager 恢复）
   * @param fileId - 文件 ID
   * @param tokens - 总 tokens（覆盖现有值）
   */
  setTokens: (fileId: string, tokens: number) => void;

  /**
   * 获取文件的 tokens
   */
  getTokens: (fileId: string) => number;

  // ============================================
  // 元数据管理方法（Phase 1-2）
  // ============================================

  /**
   * 从 DataManager 延迟加载文件的完整字幕条目
   * 用于编辑器等需要完整数据的场景
   */
  getFileEntries: (fileId: string) => SubtitleEntry[];

  /**
   * 从 DataManager 更新文件的统计信息
   * 用于翻译/转录完成后更新缓存的统计数据
   */
  updateFileStatistics: (fileId: string) => void;

  // Getters
  getFile: (fileId: string) => SubtitleFileMetadata | undefined;
  getAllFiles: () => SubtitleFileMetadata[];
  getTranslationProgress: (fileId: string) => { completed: number; total: number };
}

// ============================================
// Phase 3: 持久化由 DataManager 统一管理
// ============================================

// 页面关闭前强制持久化所有数据并检查是否有进行中的任务
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    // 检查是否有进行中的任务
    const hasOngoingTasks = checkOngoingTasks();

    if (hasOngoingTasks) {
      // 触发浏览器确认对话框
      event.preventDefault();
      // Chrome 需要设置 returnValue
      event.returnValue = '';
    }

    // 无论如何都强制持久化数据
    dataManager.forcePersistAllData().catch(console.error);
  });
}

/**
 * 检查是否有进行中的任务（转录或翻译）
 */
function checkOngoingTasks(): boolean {
  // 检查是否有翻译正在进行
  const isTranslating = useTranslationConfigStore.getState().isTranslating;

  // 检查是否有转录正在进行
  const files = useSubtitleStore.getState().files;
  const isTranscribing = files.some(file =>
    file.transcriptionStatus && (
      file.transcriptionStatus === 'uploading' ||
      file.transcriptionStatus === 'transcribing' ||
      file.transcriptionStatus === 'llm_merging'
    )
  );

  return isTranslating || isTranscribing;
}

// ============================================
// Store 创建
// ============================================

export const useSubtitleStore = create<SubtitleStore>((set, get) => ({
  // Initial State
  files: [],
  selectedFileId: null,

  // ========================================
  // 文件操作
  // ========================================

  /**
   * 从 IndexedDB 加载文件列表
   */
  loadFiles: async () => {
    try {
      const files = await restoreFiles();

      // ✅ 从 DataManager 恢复 tokensUsed
      const filesWithTokens = files.map(file => {
        const task = dataManager.getTaskById(file.taskId);
        return {
          ...file,
          tokensUsed: task?.translation_progress?.tokens || 0
        };
      });

      set({ files: filesWithTokens });
    } catch (error) {
      const appError = toAppError(error, '加载文件失败');
      console.error('[subtitleStore]', appError.message, appError);
      toast.error('加载文件失败');
    }
  },

  /**
   * 添加新文件
   */
  addFile: async (file: File) => {
    try {
      const newFile = await loadFromFile(file, { existingFilesCount: get().files.length });
      // ✅ Phase 3: newFile 现在是 SubtitleFileMetadata
      set((state) => ({
        files: [...state.files, newFile]
      }));
      // ✅ Phase 3: 移除 schedulePersist，DataManager 负责持久化
      return newFile.id;
    } catch (error) {
      const appError = toAppError(error, '文件加载失败');
      console.error('[subtitleStore]', appError.message, appError);
      toast.error(`文件加载失败: ${appError.message}`);
      throw error;
    }
  },

  /**
   * 删除文件
   */
  removeFile: async (fileId: string) => {
    const file = get().getFile(fileId);
    if (!file) return;

    // 检查是否正在翻译此文件，如果是则停止翻译
    const translationStore = useTranslationConfigStore.getState();
    if (translationStore.isTranslating && translationStore.currentTaskId === file.taskId) {
      translationStore.stopTranslation();
    }

    try {
      set((state) => ({
        files: state.files.filter(f => f.id !== fileId),
        selectedFileId: state.selectedFileId === fileId ? null : state.selectedFileId
      }));

      // ✅ Phase 3: removeFileData 现在接受 SubtitleFileMetadata
      await removeFileData(file);
      // ✅ Phase 3: 移除 schedulePersist，DataManager 负责持久化
      toast.success('文件已删除');
    } catch (error) {
      const appError = toAppError(error, '删除文件失败');
      console.error('[subtitleStore]', appError.message, appError);
      toast.error('删除文件失败');
    }
  },

  /**
   * 选择文件
   */
  selectFile: (fileId: string) => {
    set({ selectedFileId: fileId });
  },

  /**
   * 清空所有数据
   */
  clearAll: async () => {
    try {
      set({ files: [], selectedFileId: null });
      await clearAllFileData();
      window.dispatchEvent(new CustomEvent('taskCleared'));
    } catch (error) {
      const appError = toAppError(error, '清空数据失败');
      console.error('[subtitleStore]', appError.message, appError);
      toast.error('清空数据失败');
    }
  },

  // ========================================
  // 字幕操作
  // ========================================

  /**
   * 更新单条字幕
   */
  updateEntry: async (fileId: string, entryId: number, text: string, translatedText?: string, status?: TranslationStatus, startTime?: string, endTime?: string, words?: SubtitleEntry['words']) => {
    const file = get().getFile(fileId);
    if (!file) return;

    // 更新 DataManager 内存（传递 status、时间戳和单词时间戳）
    dataManager.updateTaskSubtitleEntryInMemory(file.taskId, entryId, text, translatedText, status, startTime, endTime, words);

    // ✅ Phase 3: 更新统计信息，而不是 entries 数组
    get().updateFileStatistics(fileId);

    // ✅ Phase 3: 移除 schedulePersist，DataManager 负责持久化
  },

  /**
   * 删除单条字幕
   */
  deleteEntry: async (fileId: string, entryId: number) => {
    const file = get().getFile(fileId);
    if (!file) return;

    dataManager.deleteTaskSubtitleEntryInMemory(file.taskId, entryId);
    get().updateFileStatistics(fileId);
  },

  /**
   * 批量更新字幕
   */
  batchUpdateEntries: async (fileId: string, updates: Array<{id: number, text: string, translatedText?: string}>) => {
    const file = get().getFile(fileId);
    if (!file) return;

    await dataManager.batchUpdateTaskSubtitleEntries(file.taskId, updates);

    // ✅ Phase 3: 更新统计信息，而不是 entries 数组
    get().updateFileStatistics(fileId);

    // ✅ Phase 3: 移除 schedulePersist，DataManager 负责持久化
  },

  // ========================================
  // 转录操作
  // ========================================

  /**
   * 开始转录
   */
  startTranscription: async (fileId: string) => {
    const file = get().getFile(fileId);
    if (!file || file.fileType === 'srt') return;

    try {
      // ✅ Phase 3: 从 DataManager 获取 fileRef
      const task = dataManager.getTaskById(file.taskId);
      const fileRef = (file as any).fileRef; // 临时访问
      if (!fileRef) {
        toast.error('文件引用丢失，请重新上传');
        return;
      }

      // ✅ 预检 API Key
      const { apiKeys } = useTranscriptionStore.getState();
      if (!apiKeys.trim()) {
        toast.error('请先在设置中配置 AssemblyAI API Key');
        get().updateTranscriptionStatus(fileId, 'failed');
        return;
      }

      // ✅ 获取热词（所有分组的词汇合并）
      const { keytermGroups, keytermsEnabled } = useTranscriptionStore.getState();
      const allKeyterms = keytermsEnabled ? keytermGroups.flatMap(g => g.keyterms) : [];

      get().updateTranscriptionStatus(fileId, 'converting');

      const result = await runTranscriptionPipeline(
        fileRef,
        allKeyterms,
        {
          onConverting: () => {
            get().updateTranscriptionStatus(fileId, 'converting');
          },
          onUploading: () => {
            get().updateTranscriptionStatus(fileId, 'uploading');
          },
          onTranscribing: () => {
            get().updateTranscriptionStatus(fileId, 'transcribing');
          },
          onProgress: (percent) => {
            get().updateTranscriptionProgress(fileId, { percent });
          },
          onCompleted: () => {
            // 状态更新将在数据保存和统计更新后进行
          },
          onError: (_error) => {
            get().updateTranscriptionStatus(fileId, 'failed');
          }
        }
      );

      // 持久化转录结果
      await dataManager.updateTaskWithTranscription(file.taskId, result.entries, result.duration, 0);

      // 更新统计信息
      get().updateFileStatistics(fileId);

      // 现在更新状态为 completed（确保 entryCount 已正确更新）
      get().updateTranscriptionStatus(fileId, 'completed');

      toast.success(`转录完成！生成 ${result.entries.length} 条字幕`);
    } catch (error) {
      const appError = toAppError(error, '转录失败');
      console.error('[subtitleStore]', appError.message, appError);
      toast.error(`转录失败: ${appError.message}`);

      get().updateTranscriptionStatus(fileId, 'failed');
    }
  },

  /**
   * 更新转录进度
   */
  updateTranscriptionProgress: (fileId: string, progress: TranscriptionProgressInfo) => {
    set((state) => ({
      files: state.files.map(f =>
        f.id === fileId
          ? {
              ...f,
              transcriptionProgress: {
                ...f.transcriptionProgress,
                ...progress
              }
            }
          : f
      )
    }));
  },

  /**
   * 更新转录状态
   */
  updateTranscriptionStatus: (fileId: string, status: TranscriptionStatus) => {
    set((state) => ({
      files: state.files.map(f =>
        f.id === fileId
          ? {
              ...f,
              transcriptionStatus: status
            }
          : f
      )
    }));
  },

  // ========================================
  // 翻译操作
  // ========================================

  /**
   * 开始翻译
   */
  startTranslation: async (fileId: string) => {
    const file = get().getFile(fileId);
    if (!file) return;

    const translationConfigStore = useTranslationConfigStore.getState();
    const config = translationConfigStore.config;
    if (!translationConfigStore.isConfigured) {
      toast.error('请先配置翻译 API');
      return;
    }

    // 设置全局翻译状态
    const controller = await translationConfigStore.startTranslation(file.taskId);

    // 重置 splitProgress（避免上次翻译残留值影响状态判断）
    set((state) => ({
      files: state.files.map(f =>
        f.id === fileId ? { ...f, splitProgress: undefined } : f
      )
    }));

    try {
      // ✅ Phase 3: 从 DataManager 获取完整 entries
      const task = dataManager.getTaskById(file.taskId);
      const entries = task?.subtitle_entries || [];

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
            await get().updateEntry(fileId, id, text, translatedText, status);
          },
          updateProgress: async (current: number, total: number, phase: 'direct' | 'splitting' | 'completed', status: string, taskId: string, newTokens?: number) => {
            // 调用 TranslationService.updateProgress（它会累加 tokens 并更新 DataManager）
            await translationConfigStore.updateProgress(current, total, phase, status, taskId, newTokens);

            // ✅ 同步更新 Store 的 tokens
            if (newTokens !== undefined && newTokens > 0) {
              get().addTokens(fileId, newTokens);
            }
          },
          getRelevantTerms: (batchText: string, before: string, after: string): Term[] => {
            // 从 dataManager 获取术语
            const allTerms = dataManager.getTerms();
            if (allTerms.length === 0) return [];

            // 合并所有文本
            const fullText = `${before} ${batchText} ${after}`;
            const cleanedFullText = fullText.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

            // 预处理术语
            const processedTerms = allTerms.map((term: Term) => ({
              ...term,
              cleanedOriginal: term.original.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
            }));

            // 筛选出在清洗后文本中出现的术语
            return processedTerms
              .filter(term => term.cleanedOriginal && cleanedFullText.includes(term.cleanedOriginal))
              .map(({ original, translation, notes }) => ({ original, translation, notes }));
          },
          formatTermsForPrompt: (terms: Term[]): string => {
            return terms.map(term => {
              if (term.notes) {
                return `${term.original} -> ${term.translation} // ${term.notes}`;
              }
              return `${term.original} -> ${term.translation}`;
            }).join('\n');
          }
        }
      );

      // 检查是否被中止（删除文件时）
      if (controller.signal.aborted) {
        console.log('[subtitleStore] 翻译已中止（文件已删除）');
        return;
      }

      // 完成翻译
      await dataManager.completeTask(file.taskId, translationConfigStore.tokensUsed || 0);

      // ✅ 同步 DataManager 中的 tokens（翻译完成后需要同步，因为 TranslationService 也会更新）
      get().updateFileStatistics(fileId);

      // Step 5.1+5.2: LLM 断句对齐（翻译后处理超长字幕）
      const aiSegmentationEnabled = useTranscriptionStore.getState().aiSegmentationEnabled;
      if (!aiSegmentationEnabled) {
        console.log('[subtitleStore] AI 断句对齐已关闭，跳过');
        toast.success(`${file.name} 翻译完成`);
        return;
      }

      let splitSucceeded = false;
      try {
        const preset = useTranscriptionStore.getState().subtitleLengthPreset;
        let postSplitEntries = dataManager.getTaskById(file.taskId)?.subtitle_entries || [];

        // 清理旧的拆分条目：先合并回父条目，再删除（避免丢失原始文本）
        const compositeEntries = postSplitEntries.filter(e => e.id > 999999);
        if (compositeEntries.length > 0) {
          // 按父条目 ID 分组
          const groups = new Map<number, SubtitleEntry[]>();
          for (const ce of compositeEntries) {
            const parentId = Math.floor(ce.id / 1000000);
            const group = groups.get(parentId) || [];
            group.push(ce);
            groups.set(parentId, group);
          }
          // 合并回父条目（重建 text、translatedText、words、startTime、endTime）
          for (const [parentId, parts] of groups) {
            const parent = postSplitEntries.find(e => e.id === parentId);
            if (parent) {
              // 按 splitId 排序确保拼接顺序正确
              parts.sort((a, b) => (a.id % 1000000) - (b.id % 1000000));
              const allParts = [parent, ...parts];
              const mergedText = allParts.map(p => p.text).join(' ');
              const mergedTranslation = allParts.map(p => p.translatedText || '').join(' ');
              // 重建 words 数组：合并所有 parts 的 words
              const mergedWords = allParts.flatMap(p => p.words || []);
              // 恢复原始时间范围（第一段的 start ~ 最后一段的 end）
              const restoredStartTime = parent.words?.length
                ? parent.startTime
                : parent.startTime;
              const restoredEndTime = parts.length > 0
                ? parts[parts.length - 1].endTime
                : parent.endTime;
              dataManager.updateTaskSubtitleEntryInMemory(
                file.taskId, parentId, mergedText, mergedTranslation,
                undefined, restoredStartTime, restoredEndTime,
                mergedWords.length > 0 ? mergedWords : undefined
              );
            }
          }
          // 删除所有复合条目
          for (const ce of compositeEntries) {
            dataManager.deleteTaskSubtitleEntryInMemory(file.taskId, ce.id);
          }
          postSplitEntries = dataManager.getTaskById(file.taskId)?.subtitle_entries || [];
        }

        const fullSourceText = postSplitEntries.map(e => e.text).join('\n');
        const fullDraftTranslation = postSplitEntries.map(e => e.translatedText || '').join('\n');

        console.log('[subtitleStore] 开始 LLM 断句对齐...');

        // 进入断句阶段
        get().updateSplitProgress(fileId, 0);
        await translationConfigStore.updateProgress(0, postSplitEntries.length, 'splitting', '断句对齐中...', file.taskId);

        // Step 5.1: LLM 原文拆分
        let lastSplitTokens = 0;
        const splitResults = await llmSourceSplit({
          entries: postSplitEntries,
          sourceLang: config.sourceLanguage,
          targetLang: config.targetLanguage,
          preset,
          fullSourceText,
          fullDraftTranslation,
          threadCount: config.threadCount,
          onProgress: (current, total, tokensUsed) => {
            const percent = total > 0 ? Math.round((current / total) * 50) : 0;
            get().updateSplitProgress(fileId, percent);
            translationConfigStore.updateProgress(current, total, 'splitting', `断句拆分中 ${current}/${total}`, file.taskId).catch(err => console.warn('[subtitleStore] updateProgress failed:', err));
            // tokensUsed 是累计值，只需累加增量
            const delta = tokensUsed - (lastSplitTokens);
            lastSplitTokens = tokensUsed;
            if (delta > 0) {
              get().addTokens(fileId, delta);
            }
          },
        });

        if (splitResults.length > 0) {
          console.log(`[subtitleStore] ${splitResults.length} 条字幕需要拆分对齐`);

          // Step 5.2: 对拆分结果进行译文对齐（并发 LLM 调用，顺序写入数据）
          const alignThreadCount = config.threadCount;
          let alignCompleted = 0;

          // 准备对齐任务
          const alignTasks = splitResults
            .map(split => {
              const entry = postSplitEntries.find(e => e.id === split.entryId);
              if (!entry || split.sourceParts.length <= 1) return null;
              return { split, entry };
            })
            .filter((t): t is { split: typeof splitResults[0]; entry: SubtitleEntry } => t !== null);

          // 按 threadCount 分组并发调用 LLM 对齐
          type AlignResult = {
            entryId: number;
            entry: SubtitleEntry;
            sourceParts: string[];
            alignments: { id: number; text: string }[];
            tokensUsed: number;
          };

          const allAlignResults: AlignResult[] = [];

          for (let i = 0; i < alignTasks.length; i += alignThreadCount) {
            const chunk = alignTasks.slice(i, i + alignThreadCount);

            const chunkResults = await Promise.all(
              chunk.map(async ({ split, entry }) => {
                try {
                  const { translations: alignments, tokensUsed: alignTokens } = await llmAlignTranslation({
                    sourceText: entry.text,
                    draftTranslation: entry.translatedText || '',
                    splitSourceLines: split.sourceParts.map((s, i) => ({ id: i + 1, source: s })),
                    sourceLang: config.sourceLanguage,
                    targetLang: config.targetLanguage,
                    theme: '',
                    terminology: [],
                  });

                  if (alignTokens > 0) {
                    get().addTokens(fileId, alignTokens);
                  }

                  if (alignments.length === split.sourceParts.length) {
                    return { entryId: entry.id, entry, sourceParts: split.sourceParts, alignments, tokensUsed: alignTokens };
                  }
                } catch (alignError) {
                  console.warn(`[subtitleStore] 译文对齐失败，跳过条目 ${entry.id}:`, alignError);
                }
                return null;
              })
            );

            for (const result of chunkResults) {
              alignCompleted++;
              if (result) {
                allAlignResults.push(result);
              }
              const alignPercent = 50 + Math.round((alignCompleted / alignTasks.length) * 50);
              get().updateSplitProgress(fileId, alignPercent);
              await translationConfigStore.updateProgress(
                postSplitEntries.length + alignCompleted,
                postSplitEntries.length + alignTasks.length,
                'splitting',
                `译文对齐中 ${alignCompleted}/${alignTasks.length}`,
                file.taskId
              );
            }
          }

          // 顺序写入数据（避免并发插入导致顺序错乱）
          // 初始化计数器：跳过已有的拆分条目 ID，避免重翻译时 ID 碰撞
          let splitIdCounter = 0;
          const existingEntries = dataManager.getTaskById(file.taskId)?.subtitle_entries || [];
          for (const e of existingEntries) {
            if (e.id > 999999) {
              splitIdCounter = Math.max(splitIdCounter, e.id % 1000000);
            }
          }
          for (const result of allAlignResults) {
            const entry = result.entry;
            const words = entry.words;

            if (words && words.length > 0) {
              // 有单词时间戳：通过文本匹配推导精确时间
              const boundaries = mapSourcePartsToBoundaries(result.sourceParts, words, config.sourceLanguage);
              const ranges = boundariesToRanges(boundaries, words.length);

              // 更新原条目（第一段），截断 words 到第一段范围
              const firstStart = words[ranges[0][0]].start;
              const firstEnd = words[ranges[0][1]].end;
              const firstWords = words.slice(ranges[0][0], ranges[0][1] + 1);
              await get().updateEntry(fileId, result.entryId,
                result.sourceParts[0], result.alignments[0]?.text || '',
                undefined, formatTime(firstStart), formatTime(firstEnd), firstWords);

              // 插入后续段（倒序插入保持位置正确）
              for (let i = ranges.length - 1; i >= 1; i--) {
                const ws = words[ranges[i][0]];
                const we = words[ranges[i][1]];
                splitIdCounter++;
                dataManager.addSubtitleEntryAfterInMemory(file.taskId, result.entryId, {
                  id: result.entryId * 1000000 + splitIdCounter,
                  startTime: formatTime(ws.start),
                  endTime: formatTime(we.end),
                  text: result.sourceParts[i],
                  translatedText: result.alignments[i]?.text || '',
                  translationStatus: 'completed',
                  words: words.slice(ranges[i][0], ranges[i][1] + 1),
                });
              }
            } else {
              // 无单词时间戳（SRT 导入）：按文本比例插值
              const totalDuration = parseTime(entry.endTime) - parseTime(entry.startTime);
              const unitCounts = result.sourceParts.map(p => countUnits(p, config.sourceLanguage));
              const totalUnits = unitCounts.reduce((a, b) => a + b, 0);

              // 预计算所有段时间戳
              const partTimestamps: { start: number; end: number }[] = [];
              let offset = parseTime(entry.startTime);
              for (let i = 0; i < result.sourceParts.length; i++) {
                const duration = totalUnits > 0
                  ? (unitCounts[i] / totalUnits) * totalDuration
                  : totalDuration / result.sourceParts.length;
                partTimestamps.push({ start: offset, end: offset + duration });
                offset += duration;
              }

              // 更新原条目（第一段）
              await get().updateEntry(fileId, result.entryId,
                result.sourceParts[0], result.alignments[0]?.text || '',
                undefined, formatTime(partTimestamps[0].start), formatTime(partTimestamps[0].end));

              // 插入后续段（倒序插入保持位置正确）
              for (let i = result.sourceParts.length - 1; i >= 1; i--) {
                splitIdCounter++;
                dataManager.addSubtitleEntryAfterInMemory(file.taskId, result.entryId, {
                  id: result.entryId * 1000000 + splitIdCounter,
                  startTime: formatTime(partTimestamps[i].start),
                  endTime: formatTime(partTimestamps[i].end),
                  text: result.sourceParts[i],
                  translatedText: result.alignments[i]?.text || '',
                  translationStatus: 'completed',
                });
              }
            }
          }

          // Update statistics after split/align（触发 Zustand 通知 UI 刷新）
          get().updateFileStatistics(fileId);
          get().updateSplitProgress(fileId, 100);
          splitSucceeded = true;
          console.log('[subtitleStore] LLM 断句对齐完成');
        } else {
          get().updateSplitProgress(fileId, 100);
          splitSucceeded = true;
          console.log('[subtitleStore] 无需拆分的字幕');
        }
      } catch (splitAlignError) {
        console.warn('[subtitleStore] LLM 断句对齐失败，保留原始翻译:', splitAlignError);
        get().updateSplitProgress(fileId, 100);
      }

      // ✅ Phase 3: 移除 forcePersist，DataManager 负责持久化
      if (splitSucceeded) {
        toast.success(`${file.name} 翻译完成`);
      } else {
        toast.success(`${file.name} 翻译完成（断句对齐失败，保留原始分段）`);
      }
    } catch (error) {
      const appError = toAppError(error, '翻译失败');
      console.error('[subtitleStore]', appError.message, appError);
      toast.error(`翻译失败: ${appError.message}`);
    } finally {
      translationConfigStore.stopTranslation();
    }
  },

  /**
   * 更新翻译进度
   */
  updateTranslationProgress: (fileId: string, completed: number, total: number) => {
    // ✅ Phase 3: 不再直接更新 entries 数组
    // 进度通过 DataManager 更新，需要时通过 getFileEntries 获取
    // 这里只更新统计信息的缓存
    set((state) => ({
      files: state.files.map(f =>
        f.id === fileId
          ? {
              ...f,
              translatedCount: completed,
              entryCount: total
            }
          : f
      )
    }));
  },

  /**
   * 更新断句对齐进度（0-100）
   */
  updateSplitProgress: (fileId: string, progress: number) => {
    set((state) => ({
      files: state.files.map(f =>
        f.id === fileId
          ? { ...f, splitProgress: progress }
          : f
      )
    }));
  },

  // ========================================
  // Tokens 管理
  // ========================================

  /**
   * 添加 tokens（转录或翻译）
   */
  addTokens: (fileId: string, tokens: number) => {
    if (tokens <= 0) return;

    // 先获取当前 file（此时是旧值）
    const file = get().getFile(fileId);

    // 同步到 DataManager（使用旧值计算）
    if (file) {
      dataManager.updateTaskTranslationProgressInMemory(
        file.taskId,
        { tokens: file.tokensUsed + tokens }
      );
    }

    // 再更新 Store
    set((state) => ({
      files: state.files.map(f =>
        f.id === fileId
          ? { ...f, tokensUsed: f.tokensUsed + tokens }
          : f
      )
    }));
  },

  /**
   * 设置 tokens（用于从 DataManager 恢复）
   */
  setTokens: (fileId: string, tokens: number) => {
    set((state) => ({
      files: state.files.map(f =>
        f.id === fileId
          ? { ...f, tokensUsed: tokens }
          : f
      )
    }));
  },

  /**
   * 获取文件的 tokens
   */
  getTokens: (fileId: string) => {
    return get().getFile(fileId)?.tokensUsed || 0;
  },

  // ========================================
  // Getters
  // ========================================

  /**
   * 获取单个文件
   */
  getFile: (fileId: string) => {
    return get().files.find(f => f.id === fileId);
  },

  /**
   * 获取所有文件
   */
  getAllFiles: () => {
    return get().files;
  },

  /**
   * 获取翻译进度
   */
  getTranslationProgress: (fileId: string) => {
    const file = get().getFile(fileId);
    if (!file) return { completed: 0, total: 0 };

    // ✅ Phase 3: 使用缓存的统计信息
    return {
      completed: file.translatedCount || 0,
      total: file.entryCount || 0
    };
  },

  // ========================================
  // 元数据管理方法实现（Phase 1-3）
  // ========================================

  /**
   * 从 DataManager 延迟加载文件的完整字幕条目
   * 用于编辑器等需要完整数据的场景
   */
  getFileEntries: (fileId: string) => {
    const file = get().getFile(fileId);
    if (!file) return [];

    // 从 DataManager 获取完整的 subtitle_entries
    const task = dataManager.getTaskById(file.taskId);
    return task?.subtitle_entries || [];
  },

  /**
   * 从 DataManager 更新文件的统计信息
   * 用于翻译/转录完成后更新缓存的统计数据
   */
  updateFileStatistics: (fileId: string) => {
    const file = get().getFile(fileId);
    if (!file) return;

    // 从 DataManager 获取最新数据
    const task = dataManager.getTaskById(file.taskId);
    if (!task) return;

    // 重新计算统计信息（从 DataManager 的最新数据）
    const entryCount = task.subtitle_entries?.length || 0;
    const translatedCount = task.subtitle_entries?.filter(e => e.translatedText).length || 0;

    // 更新 Store 中的元数据，递增 entriesVersion 通知 UI entries 已变更
    set((state) => ({
      files: state.files.map(f =>
        f.id === fileId
          ? {
              ...f,
              entryCount,
              translatedCount,
              entriesVersion: (f.entriesVersion ?? 0) + 1
            }
          : f
      )
    }));
  }
}));

// ============================================
// 导出辅助 hooks
// ============================================

/**
 * 获取文件列表
 */
export const useFiles = () => useSubtitleStore((state) => state.files);

/**
 * 获取选中文件
 */
export const useSelectedFile = () => {
  const selectedFileId = useSubtitleStore((state) => state.selectedFileId);
  const files = useSubtitleStore((state) => state.files);
  return selectedFileId ? files.find(f => f.id === selectedFileId) : null;
};

/**
 * 获取单个文件
 */
export const useFile = (fileId: string) => {
  return useSubtitleStore((state) => state.files.find(f => f.id === fileId));
};
