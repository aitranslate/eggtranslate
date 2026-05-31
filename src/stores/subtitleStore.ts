/**
 * 字幕文件管理 Store
 * 替代原 SubtitleContext，使用 Zustand 管理状态
 * 直接读写 localforage，不再依赖 dataManager
 */

import { create } from 'zustand';
import { SubtitleEntry, SubtitleFileMetadata, Term, TranslationStatus, FilePhases, PhaseProgress, WorkflowType, SplitAlignStatus } from '@/types';
import { loadFromFile as loadFromFileOriginal, removeFile as removeFileData, clearAllData as clearAllFileData, restoreFiles, convertTaskToMetadata } from '@/services/SubtitleFileManager';
import { runTranscriptionPipeline } from '@/services/transcriptionPipeline';
import { executeTranslation } from '@/services/TranslationOrchestrator';
import { llmSourceSplit, llmAlignTranslation } from '@/services/llmSplitAlign';
import { generateStableFileId } from '@/utils/taskIdGenerator';
import { mapSourcePartsToBoundaries, boundariesToRanges } from '@/utils/sourceSplitBoundaries';
import { formatTime, parseTime } from '@/utils/timeUtils';
import { countUnits } from '@/utils/textUnitCounter';
import { getSourceLimit, getTargetLimit } from '@/utils/subtitleLengthPresets';
import { toAppError } from '@/utils/errors';
import { convertToMP3 } from '@/utils/convertToMP3';
import type { ProgressPhase } from '@/types';
import { markDirty, flushAll } from '@/services/PhasePersistence';
import toast from 'react-hot-toast';
import localforage from 'localforage';
import type { BatchTasks, SingleTask } from '@/types';

// ============================================
// 循环导入解决
// ============================================

import { useTranscriptionStore } from './transcriptionStore';
import { useTranslationConfigStore } from './translationConfigStore';
import { useTermsStore } from './termsStore';

// ============================================
// 类型定义
// ============================================

interface SubtitleStore {
  // State
  files: SubtitleFileMetadata[];  // 轻量级元数据数组
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

  // Actions - 翻译
  startTranslation: (fileId: string) => Promise<{ tokens: number; entries: SubtitleEntry[]; phases: FilePhases } | null>;
  updateTranslationProgress: (fileId: string, completed: number, total: number) => void;

  // Actions - 阶段状态管理
  updatePhase: (fileId: string, phase: ProgressPhase, update: Partial<PhaseProgress>) => void;
  setWorkflow: (fileId: string, workflow: WorkflowType) => void;

  // ============================================
  // 持久化管理
  // ============================================

  /**
   * 强制将所有脏相位立即写入 localforage
   * 用于应用关闭时
   */
  flushPhasesToPersistence: () => Promise<void>;

  // ============================================
  // Tokens 管理
  // ============================================

  addTokens: (fileId: string, tokens: number) => void;
  setTokens: (fileId: string, tokens: number) => void;
  getTokens: (fileId: string) => number;

  // ============================================
  // 元数据管理方法
  // ============================================

  /**
   * 从 localforage 延迟加载文件的完整字幕条目
   */
  getFileEntries: (fileId: string) => Promise<SubtitleEntry[]>;

  /**
   * 更新文件的统计信息
   */
  updateFileStatistics: (fileId: string) => Promise<void>;

  // Getters
  getFile: (fileId: string) => SubtitleFileMetadata | undefined;
  getAllFiles: () => SubtitleFileMetadata[];
  getTranslationProgress: (fileId: string) => { completed: number; total: number };
  updateEntrySplitStatus: (fileId: string, entryId: number, status: SplitAlignStatus) => Promise<void>;
}

// ============================================
// 页面关闭前检查进行中的任务
// ============================================

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    const hasOngoingTasks = checkOngoingTasks();

    if (hasOngoingTasks) {
      event.preventDefault();
      event.returnValue = '';
    }

    flushAll().catch(console.error);
  });
}

function checkOngoingTasks(): boolean {
  const files = useSubtitleStore.getState().files;
  return files.some(file =>
    file.phases.converting.status === 'active' ||
    file.phases.transcribing.status === 'active' ||
    file.phases.translating.status === 'active' ||
    file.phases.splitting.status === 'active'
  );
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

  loadFiles: async () => {
    try {
      const files = await restoreFiles();
      set({ files });
    } catch (error) {
      const appError = toAppError(error, '加载文件失败');
      console.error('[subtitleStore]', appError.message, appError);
      toast.error('加载文件失败');
    }
  },

  addFile: async (file: File) => {
    try {
      const newFile = await loadFromFileOriginal(file, { existingFilesCount: get().files.length });
      set((state) => ({
        files: [...state.files, newFile]
      }));
      return newFile.id;
    } catch (error) {
      const appError = toAppError(error, '文件加载失败');
      console.error('[subtitleStore]', appError.message, appError);
      toast.error(`文件加载失败: ${appError.message}`);
      throw error;
    }
  },

  removeFile: async (fileId: string) => {
    const file = get().getFile(fileId);
    if (!file) return;

    const translationStore = useTranslationConfigStore.getState();
    if (translationStore.isTranslating && translationStore.currentTaskId === file.taskId) {
      translationStore.stopTranslation();
    }

    try {
      set((state) => ({
        files: state.files.filter(f => f.id !== fileId),
        selectedFileId: state.selectedFileId === fileId ? null : state.selectedFileId
      }));

      await removeFileData(file);
      toast.success('文件已删除');
    } catch (error) {
      const appError = toAppError(error, '删除文件失败');
      console.error('[subtitleStore]', appError.message, appError);
      toast.error('删除文件失败');
    }
  },

  selectFile: (fileId: string) => {
    set({ selectedFileId: fileId });
  },

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

  updateEntry: async (fileId: string, entryId: number, text: string, translatedText?: string, status?: TranslationStatus, startTime?: string, endTime?: string, words?: SubtitleEntry['words']) => {
    const file = get().getFile(fileId);
    if (!file) return;

    // 直接更新 localforage
    const batchTasks = await localforage.getItem<BatchTasks>('batch_tasks');
    if (!batchTasks) return;

    const taskIndex = batchTasks.tasks.findIndex(t => t.taskId === file.taskId);
    if (taskIndex === -1) return;

    const task = batchTasks.tasks[taskIndex];
    const entries = task.subtitle_entries || [];
    const entryIndex = entries.findIndex(e => e.id === entryId);

    if (entryIndex !== -1) {
      entries[entryIndex] = {
        ...entries[entryIndex],
        text,
        translatedText: translatedText ?? entries[entryIndex].translatedText,
        translationStatus: status ?? entries[entryIndex].translationStatus,
        startTime: startTime ?? entries[entryIndex].startTime,
        endTime: endTime ?? entries[entryIndex].endTime,
        words: words ?? entries[entryIndex].words,
      };
      batchTasks.tasks[taskIndex] = { ...task, subtitle_entries: entries };
      await localforage.setItem('batch_tasks', batchTasks);
    }

    get().updateFileStatistics(fileId);
  },

  deleteEntry: async (fileId: string, entryId: number) => {
    const file = get().getFile(fileId);
    if (!file) return;

    const batchTasks = await localforage.getItem<BatchTasks>('batch_tasks');
    if (!batchTasks) return;

    const taskIndex = batchTasks.tasks.findIndex(t => t.taskId === file.taskId);
    if (taskIndex === -1) return;

    const task = batchTasks.tasks[taskIndex];
    const entries = task.subtitle_entries || [];
    const filteredEntries = entries.filter(e => e.id !== entryId);

    batchTasks.tasks[taskIndex] = { ...task, subtitle_entries: filteredEntries };
    await localforage.setItem('batch_tasks', batchTasks);

    get().updateFileStatistics(fileId);
  },

  batchUpdateEntries: async (fileId: string, updates: Array<{id: number, text: string, translatedText?: string}>) => {
    const file = get().getFile(fileId);
    if (!file) return;

    const batchTasks = await localforage.getItem<BatchTasks>('batch_tasks');
    if (!batchTasks) return;

    const taskIndex = batchTasks.tasks.findIndex(t => t.taskId === file.taskId);
    if (taskIndex === -1) return;

    const task = batchTasks.tasks[taskIndex];
    const entries = task.subtitle_entries || [];

    for (const update of updates) {
      const entryIndex = entries.findIndex(e => e.id === update.id);
      if (entryIndex !== -1) {
        entries[entryIndex] = {
          ...entries[entryIndex],
          text: update.text,
          translatedText: update.translatedText ?? entries[entryIndex].translatedText,
        };
      }
    }

    batchTasks.tasks[taskIndex] = { ...task, subtitle_entries: entries };
    await localforage.setItem('batch_tasks', batchTasks);

    get().updateFileStatistics(fileId);
  },

  updateEntrySplitStatus: async (fileId: string, entryId: number, status: SplitAlignStatus) => {
    const file = get().getFile(fileId);
    if (!file) return;

    const batchTasks = await localforage.getItem<BatchTasks>('batch_tasks');
    if (!batchTasks) return;

    const taskIndex = batchTasks.tasks.findIndex(t => t.taskId === file.taskId);
    if (taskIndex === -1) return;

    const task = batchTasks.tasks[taskIndex];
    const entries = task.subtitle_entries || [];
    const entryIndex = entries.findIndex(e => e.id === entryId);

    if (entryIndex !== -1) {
      entries[entryIndex] = {
        ...entries[entryIndex],
        splitAlignStatus: status,
      };
      batchTasks.tasks[taskIndex] = { ...task, subtitle_entries: entries };
      await localforage.setItem('batch_tasks', batchTasks);
    }
  },

  // ========================================
  // 转录操作
  // ========================================

  startTranscription: async (fileId: string) => {
    const file = get().getFile(fileId);
    if (!file || file.fileType === 'srt') return;

    try {
      const fileRef = (file as any).fileRef;
      let mediaFile: File | undefined = fileRef;

      // 如果没有 fileRef，尝试从 IndexedDB 加载保存的 MP3
      if (!mediaFile) {
        const savedMp3 = await localforage.getItem<Blob>(`mp3_data:${file.taskId}`);
        if (savedMp3) {
          mediaFile = new File([savedMp3], 'audio.mp3', { type: 'audio/mpeg' });
          console.log('[subtitleStore] 从 IndexedDB 恢复 MP3 用于转录');
        }
      }

      if (!mediaFile) {
        toast.error('文件引用丢失，请重新上传');
        return;
      }

      const { apiKeys } = useTranscriptionStore.getState();
      if (!apiKeys.trim()) {
        toast.error('请先在设置中配置 AssemblyAI API Key');
        return;
      }

      const { keytermGroups, keytermsEnabled } = useTranscriptionStore.getState();
      const allKeyterms = keytermsEnabled ? keytermGroups.flatMap(g => g.keyterms) : [];

      // 设置仅转录工作流
      get().setWorkflow(fileId, 'transcribe');
      get().updatePhase(fileId, 'converting', { status: 'active', progress: -1, tokens: 0 });

      // 转码前保存 MP3 到 IndexedDB（如果是新上传的文件，需要转换）
      let mp3Blob: Blob;
      try {
        mp3Blob = await convertToMP3(mediaFile);
      } catch (error) {
        const appError = toAppError(error, '音频转码失败');
        console.error('[subtitleStore]', appError.message, appError);
        toast.error(`转码失败: ${appError.message}`);
        get().updatePhase(fileId, 'converting', { status: 'failed', progress: 0 });
        return;
      }
      await localforage.setItem(`mp3_data:${file.taskId}`, mp3Blob);
      console.log('[subtitleStore] 已保存 MP3 到 IndexedDB');

      // 使用转换后的 MP3 文件进行转录
      const mp3File = new File([mp3Blob], 'audio.mp3', { type: 'audio/mpeg' });

      const result = await runTranscriptionPipeline(
        mp3File,
        allKeyterms,
        {
          onConverting: () => {
            get().updatePhase(fileId, 'converting', { status: 'active', progress: -1 });
          },
          onUploading: () => {
            get().updatePhase(fileId, 'converting', { status: 'active', progress: -1 });
          },
          onTranscribing: () => {
            get().updatePhase(fileId, 'converting', { status: 'completed', progress: 100 });
            get().updatePhase(fileId, 'transcribing', { status: 'active', progress: -1, tokens: 0 });
          },
          onProgress: (percent) => {
            get().updatePhase(fileId, 'transcribing', { progress: percent });
          },
          onCompleted: () => {},
          onError: (_error) => {
            const phases = get().getFile(fileId)?.phases;
            if (phases?.converting.status === 'active') {
              get().updatePhase(fileId, 'converting', { status: 'failed', progress: 0 });
            }
            if (phases?.transcribing.status === 'active') {
              get().updatePhase(fileId, 'transcribing', { status: 'failed', progress: 0 });
            }
          }
        }
      );

      // 直接写入 localforage
      const batchTasks = await localforage.getItem<BatchTasks>('batch_tasks') || { tasks: [] };
      const taskIndex = batchTasks.tasks.findIndex(t => t.taskId === file.taskId);
      if (taskIndex !== -1) {
        batchTasks.tasks[taskIndex] = {
          ...batchTasks.tasks[taskIndex],
          subtitle_entries: result.entries,
          duration: result.duration,
          phases: {
            ...batchTasks.tasks[taskIndex].phases,
            converting: { status: 'completed', progress: 100, tokens: 0 },
            transcribing: { status: 'completed', progress: 100, tokens: 0 },
          }
        };
        await localforage.setItem('batch_tasks', batchTasks);
      }

      get().updateFileStatistics(fileId);

      get().updatePhase(fileId, 'converting', { status: 'completed', progress: 100 });
      get().updatePhase(fileId, 'transcribing', { status: 'completed', progress: 100 });

      // 更新 file.duration
      set((state) => ({
        files: state.files.map(f =>
          f.id === fileId ? { ...f, duration: result.duration } : f
        )
      }));

      toast.success(`转录完成！生成 ${result.entries.length} 条字幕`);
    } catch (error) {
      const appError = toAppError(error, '转录失败');
      console.error('[subtitleStore]', appError.message, appError);
      toast.error(`转录失败: ${appError.message}`);

      const phases = get().getFile(fileId)?.phases;
      if (phases?.converting.status === 'active') {
        get().updatePhase(fileId, 'converting', { status: 'failed', progress: 0 });
      }
      if (phases?.transcribing.status === 'active') {
        get().updatePhase(fileId, 'transcribing', { status: 'failed', progress: 0 });
      }
    }
  },

  updatePhase: (fileId: string, phase: ProgressPhase, update: Partial<PhaseProgress>) => {
    const file = get().getFile(fileId);
    if (!file) return;

    set((state) => ({
      files: state.files.map(f => {
        if (f.id !== fileId) return f;
        return {
          ...f,
          phases: {
            ...f.phases,
            [phase]: { ...f.phases[phase], ...update }
          }
        };
      })
    }));

    const updatedFile = get().getFile(fileId);
    if (updatedFile) {
      markDirty(file.taskId, phase, updatedFile.phases);
    }
  },

  setWorkflow: (fileId: string, workflow: WorkflowType) => {
    const file = get().getFile(fileId);
    if (!file) return;

    set((state) => ({
      files: state.files.map(f => {
        if (f.id !== fileId) return f;
        return {
          ...f,
          phases: {
            ...f.phases,
            workflow
          }
        };
      })
    }));

    const updatedFile = get().getFile(fileId);
    if (updatedFile) {
      markDirty(file.taskId, 'transcribing', updatedFile.phases);
    }
  },

  flushPhasesToPersistence: async () => {
    await flushAll();
  },

  // ========================================
  // 翻译操作
  // ========================================

  startTranslation: async (fileId: string): Promise<{ tokens: number; entries: SubtitleEntry[]; phases: FilePhases } | null> => {
    const file = get().getFile(fileId);
    if (!file) return null;

    const translationConfigStore = useTranslationConfigStore.getState();
    const config = translationConfigStore.config;
    if (!translationConfigStore.isConfigured) {
      toast.error('请先配置翻译 API');
      return null;
    }

    try {
      const controller = await translationConfigStore.startTranslation(file.taskId);

      get().updatePhase(fileId, 'translating', { status: 'active', progress: 0, tokens: 0 });
      get().updatePhase(fileId, 'splitting', { status: 'upcoming', progress: 0, tokens: 0 });

      // 从 localforage 获取完整 entries
      const batchTasks = await localforage.getItem<BatchTasks>('batch_tasks');
      const task = batchTasks?.tasks.find(t => t.taskId === file.taskId);
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
            await translationConfigStore.updateProgress(current, total, phase, status, taskId);

            // 只在文件级别累加 tokens
            if (newTokens !== undefined && newTokens > 0) {
              const prevTokens = get().getFile(fileId)?.tokensUsed || 0;
              const currentTokens = prevTokens + newTokens;
              get().updatePhase(fileId, 'translating', {
                progress: total > 0 ? Math.round((current / total) * 100) : 0,
                tokens: currentTokens
              });
              get().setTokens(fileId, currentTokens);
            }
          },
          getRelevantTerms: (batchText: string, before: string, after: string): Term[] => {
            const allTerms = useTermsStore.getState().terms;
            if (allTerms.length === 0) return [];

            const fullText = `${before} ${batchText} ${after}`;
            const cleanedFullText = fullText.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

            const processedTerms = allTerms.map((term: Term) => ({
              ...term,
              cleanedOriginal: term.original.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
            }));

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

      if (controller.signal.aborted) {
        console.log('[subtitleStore] 翻译已中止（文件已删除）');
        return null;
      }

      // 完成翻译 - 直接写 localforage
      const tokensAfterTranslate = get().getFile(fileId)?.tokensUsed || 0;
      const finalBatchTasks = await localforage.getItem<BatchTasks>('batch_tasks');
      const finalTaskIndex = finalBatchTasks?.tasks.findIndex(t => t.taskId === file.taskId);
      if (finalTaskIndex !== -1 && finalBatchTasks) {
        finalBatchTasks.tasks[finalTaskIndex] = {
          ...finalBatchTasks.tasks[finalTaskIndex],
          phases: {
            ...finalBatchTasks.tasks[finalTaskIndex].phases,
            translating: { status: 'completed', progress: 100, tokens: tokensAfterTranslate }
          }
        };
        await localforage.setItem('batch_tasks', finalBatchTasks);
      }

      get().updateFileStatistics(fileId);
      get().setTokens(fileId, tokensAfterTranslate);
      get().updatePhase(fileId, 'translating', { status: 'completed', progress: 100 });

      const aiSegmentationEnabled = useTranscriptionStore.getState().aiSegmentationEnabled;
      if (!aiSegmentationEnabled) {
        console.log('[subtitleStore] AI 断句对齐已关闭，跳过');
        toast.success(`${file.name} 翻译完成`);
        const tokens = get().getFile(fileId)?.tokensUsed || 0;
        return { tokens, entries, phases: get().getFile(fileId)?.phases };
      }

      let splitSucceeded = false;
      try {
        const preset = useTranscriptionStore.getState().subtitleLengthPreset;
        let postSplitEntries = (await localforage.getItem<BatchTasks>('batch_tasks'))?.tasks.find(t => t.taskId === file.taskId)?.subtitle_entries || [];

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

              await get().updateEntry(fileId, parentId, mergedText, mergedTranslation, undefined, restoredStartTime, restoredEndTime, mergedWords.length > 0 ? mergedWords : undefined);
            }
          }
          for (const ce of compositeEntries) {
            await get().deleteEntry(fileId, ce.id);
          }
          postSplitEntries = (await localforage.getItem<BatchTasks>('batch_tasks'))?.tasks.find(t => t.taskId === file.taskId)?.subtitle_entries || [];
        }

        // ============================================
        // 原子 split+align 操作
        // ============================================

        // 获取需要处理的条目（无 parentId，未完成）
        const entriesToProcess = postSplitEntries.filter(e =>
          !e.parentId && e.splitAlignStatus !== 'completed'
        );

        if (entriesToProcess.length === 0) {
          console.log('[subtitleStore] 无需拆分的字幕');
          get().updatePhase(fileId, 'splitting', { status: 'completed', progress: 100 });
          splitSucceeded = true;
        } else {
          console.log('[subtitleStore] 开始 LLM 断句对齐...');

          get().updatePhase(fileId, 'splitting', { status: 'active', progress: 0, tokens: 0 });
          await translationConfigStore.updateProgress(0, entriesToProcess.length, 'splitting', '断句对齐中...', file.taskId);

          // 辅助函数：检查是否需要拆分
          const needsSplit = (entry: SubtitleEntry, sourceLimit: number, targetLimit: number): boolean => {
            const sourceUnits = countUnits(entry.text, config.sourceLanguage);
            const targetUnits = countUnits(entry.translatedText || '', config.targetLanguage);
            return sourceUnits > sourceLimit || targetUnits > targetLimit;
          };

          // 辅助函数：为单条 entry 生成唯一 ID
          const generateSplitEntryId = async (): Promise<number> => {
            const batchTasks = await localforage.getItem<BatchTasks>('batch_tasks');
            const entries = batchTasks?.tasks.find(t => t.taskId === file.taskId)?.subtitle_entries || [];
            const maxId = entries.reduce((max, e) => Math.max(max, e.id), 0);
            return maxId + 1;
          };

          // 辅助函数：执行单条 entry 的原子 split+align
          const performSplitAlignAtomic = async (
            entry: SubtitleEntry,
            sourceLimit: number,
            targetLimit: number
          ): Promise<boolean> => {
            try {
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

              let parsed: { sourceParts: string[] };
              try {
                parsed = JSON.parse(result.content);
              } catch {
                const repaired = jsonrepair(result.content);
                parsed = JSON.parse(repaired);
              }

              if (!parsed.sourceParts || parsed.sourceParts.length <= 1) {
                // 无需拆分，标记完成
                return true;
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

              let alignParsed: { translations: { id: number; text: string }[] };
              try {
                alignParsed = JSON.parse(alignResult.content);
              } catch {
                const repaired = jsonrepair(alignResult.content);
                alignParsed = JSON.parse(repaired);
              }

              const translations = alignParsed.translations || [];
              if (translations.length !== parsed.sourceParts.length) {
                console.warn(`[subtitleStore] 对齐结果数量不匹配，跳过条目 ${entry.id}`);
                return false;
              }

              // 3. 创建子条目
              const words = entry.words;
              let newEntryIdCounter = await generateSplitEntryId();

              if (words && words.length > 0) {
                // 有单词级时间戳，使用边界映射
                const boundaries = mapSourcePartsToBoundaries(parsed.sourceParts, words, config.sourceLanguage);
                const ranges = boundariesToRanges(boundaries, words.length);

                // 更新父条目为第一个部分
                const firstStart = words[ranges[0][0]].start;
                const firstEnd = words[ranges[0][1]].end;
                const firstWords = words.slice(ranges[0][0], ranges[0][1] + 1);
                await get().updateEntry(fileId, entry.id, parsed.sourceParts[0], translations[0]?.text || '', undefined, formatTime(firstStart), formatTime(firstEnd), firstWords);

                // 创建其余子条目
                for (let i = ranges.length - 1; i >= 1; i--) {
                  const ws = words[ranges[i][0]];
                  const we = words[ranges[i][1]];
                  const newEntry: SubtitleEntry = {
                    id: newEntryIdCounter++,
                    parentId: entry.id,
                    splitIndex: i + 1,
                    startTime: formatTime(ws.start),
                    endTime: formatTime(we.end),
                    text: parsed.sourceParts[i],
                    translatedText: translations[i]?.text || '',
                    translationStatus: 'completed',
                    splitAlignStatus: 'completed',
                    words: words.slice(ranges[i][0], ranges[i][1] + 1),
                  };
                  const bt = await localforage.getItem<BatchTasks>('batch_tasks');
                  const ti = bt?.tasks.findIndex(t => t.taskId === file.taskId);
                  if (bt && ti !== -1 && ti !== undefined) {
                    bt.tasks[ti].subtitle_entries.push(newEntry);
                    await localforage.setItem('batch_tasks', bt);
                  }
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
                await get().updateEntry(fileId, entry.id, parsed.sourceParts[0], translations[0]?.text || '', undefined, formatTime(partTimestamps[0].start), formatTime(partTimestamps[0].end));

                // 创建其余子条目
                for (let i = parsed.sourceParts.length - 1; i >= 1; i--) {
                  const newEntry: SubtitleEntry = {
                    id: newEntryIdCounter++,
                    parentId: entry.id,
                    splitIndex: i + 1,
                    startTime: formatTime(partTimestamps[i].start),
                    endTime: formatTime(partTimestamps[i].end),
                    text: parsed.sourceParts[i],
                    translatedText: translations[i]?.text || '',
                    translationStatus: 'completed',
                    splitAlignStatus: 'completed',
                  };
                  const bt = await localforage.getItem<BatchTasks>('batch_tasks');
                  const ti = bt?.tasks.findIndex(t => t.taskId === file.taskId);
                  if (bt && ti !== -1 && ti !== undefined) {
                    bt.tasks[ti].subtitle_entries.push(newEntry);
                    await localforage.setItem('batch_tasks', bt);
                  }
                }
              }

              return true;
            } catch (error) {
              console.warn(`[subtitleStore] 原子 split+align 失败，条目 ${entry.id}:`, error);
              return false;
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
                await get().updateEntrySplitStatus(fileId, entry.id, 'in_progress');

                if (!needsSplit(entry, sourceLimit, targetLimit)) {
                  await get().updateEntrySplitStatus(fileId, entry.id, 'completed');
                  return { success: true, tokens: 0 };
                }

                const success = await performSplitAlignAtomic(entry, sourceLimit, targetLimit);
                if (success) {
                  await get().updateEntrySplitStatus(fileId, entry.id, 'completed');
                }
                return { success, tokens: 0 };
              })
            );

            for (const result of chunkResults) {
              completedCount++;
              const percent = entriesToProcess.length > 0
                ? Math.round((completedCount / entriesToProcess.length) * 100)
                : 100;
              get().updatePhase(fileId, 'splitting', { progress: percent, tokens: totalTokens });
              await translationConfigStore.updateProgress(
                completedCount,
                entriesToProcess.length,
                'splitting',
                `断句对齐中 ${completedCount}/${entriesToProcess.length}`,
                file.taskId
              );
            }
          }

          get().updateFileStatistics(fileId);
          get().updatePhase(fileId, 'splitting', { status: 'completed', progress: 100 });
          splitSucceeded = true;
          console.log('[subtitleStore] LLM 断句对齐完成');
        }
      } catch (splitAlignError) {
        console.warn('[subtitleStore] LLM 断句对齐失败，保留原始翻译:', splitAlignError);
        get().updatePhase(fileId, 'splitting', { status: 'failed', progress: 0 });
      }

      if (splitSucceeded) {
        toast.success(`${file.name} 翻译完成`);
      } else {
        toast.success(`${file.name} 翻译完成（断句对齐失败，保留原始分段）`);
      }

      const finalTokens = get().getFile(fileId)?.tokensUsed || 0;
      const lastBatchTasks = await localforage.getItem<BatchTasks>('batch_tasks');
      const lastEntries = lastBatchTasks?.tasks.find(t => t.taskId === file.taskId)?.subtitle_entries || [];

      // 更新 localforage 中的 tokens（供后续恢复使用）
      if (lastBatchTasks) {
        const taskIdx = lastBatchTasks.tasks.findIndex(t => t.taskId === file.taskId);
        if (taskIdx !== -1) {
          lastBatchTasks.tasks[taskIdx] = {
            ...lastBatchTasks.tasks[taskIdx],
            phases: {
              ...lastBatchTasks.tasks[taskIdx].phases,
              translating: { ...lastBatchTasks.tasks[taskIdx].phases.translating, tokens: finalTokens }
            }
          };
          await localforage.setItem('batch_tasks', lastBatchTasks);
        }
      }

      const finalPhases = get().getFile(fileId)?.phases;
      console.log(`[subtitleStore] 任务完成，总消耗 ${finalTokens} tokens`);
      return { tokens: finalTokens, entries: lastEntries, phases: finalPhases };
    } catch (error) {
      const appError = toAppError(error, '翻译失败');
      console.error('[subtitleStore]', appError.message, appError);
      toast.error(`翻译失败: ${appError.message}`);

      const phases = get().getFile(fileId)?.phases;
      if (phases?.translating.status === 'active') {
        get().updatePhase(fileId, 'translating', { status: 'failed', progress: 0 });
      }
      if (phases?.splitting.status === 'active') {
        get().updatePhase(fileId, 'splitting', { status: 'failed', progress: 0 });
      }
    } finally {
      translationConfigStore.stopTranslation();
    }
    return null;
  },

  updateTranslationProgress: (fileId: string, completed: number, total: number) => {
    set((state) => ({
      files: state.files.map(f =>
        f.id === fileId
          ? { ...f, translatedCount: completed, entryCount: total }
          : f
      )
    }));
  },

  // ========================================
  // Tokens 管理
  // ========================================

  addTokens: (fileId: string, tokens: number) => {
    if (tokens <= 0) return;

    const file = get().getFile(fileId);
    const newTokens = (file?.tokensUsed || 0) + tokens;

    // 直接更新 localforage
    if (file) {
      useSubtitleStore.getState().setTokens(fileId, newTokens);

      // 更新 localforage 中的 phases
      const batchTasks = localforage.getItem<BatchTasks>('batch_tasks');
      batchTasks.then(bt => {
        if (!bt) return;
        const taskIndex = bt.tasks.findIndex(t => t.taskId === file.taskId);
        if (taskIndex !== -1) {
          bt.tasks[taskIndex] = {
            ...bt.tasks[taskIndex],
            phases: {
              ...bt.tasks[taskIndex].phases,
              translating: { ...bt.tasks[taskIndex].phases.translating, tokens: newTokens }
            }
          };
          localforage.setItem('batch_tasks', bt);
        }
      });
    }
  },

  setTokens: (fileId: string, tokens: number) => {
    set((state) => ({
      files: state.files.map(f =>
        f.id === fileId ? { ...f, tokensUsed: tokens } : f
      )
    }));
  },

  getTokens: (fileId: string) => {
    return get().getFile(fileId)?.tokensUsed || 0;
  },

  // ========================================
  // Getters
  // ========================================

  getFile: (fileId: string) => {
    return get().files.find(f => f.id === fileId);
  },

  getAllFiles: () => {
    return get().files;
  },

  getTranslationProgress: (fileId: string) => {
    const file = get().getFile(fileId);
    if (!file) return { completed: 0, total: 0 };
    return { completed: file.translatedCount || 0, total: file.entryCount || 0 };
  },

  // ========================================
  // 元数据管理方法
  // ========================================

  getFileEntries: (fileId: string) => {
    const file = get().getFile(fileId);
    if (!file) return Promise.resolve([]);

    return (async () => {
      const batchTasks = await localforage.getItem<BatchTasks>('batch_tasks');
      const task = batchTasks?.tasks.find(t => t.taskId === file.taskId);
      return task?.subtitle_entries || [];
    })();
  },

  updateFileStatistics: (fileId: string) => {
    const file = get().getFile(fileId);
    if (!file) return Promise.resolve();

    (async () => {
      const batchTasks = await localforage.getItem<BatchTasks>('batch_tasks');
      const task = batchTasks?.tasks.find(t => t.taskId === file.taskId);
      if (!task) return;

      const entryCount = task.subtitle_entries?.length || 0;
      const translatedCount = task.subtitle_entries?.filter(e => e.translatedText).length || 0;

      set((state) => ({
        files: state.files.map(f =>
          f.id === fileId
            ? { ...f, entryCount, translatedCount, entriesVersion: (f.entriesVersion ?? 0) + 1 }
            : f
        )
      }));
    })();
  }
}));

// ============================================
// 导出辅助 hooks
// ============================================

export const useFiles = () => useSubtitleStore((state) => state.files);

export const useSelectedFile = () => {
  const selectedFileId = useSubtitleStore((state) => state.selectedFileId);
  const files = useSubtitleStore((state) => state.files);
  return selectedFileId ? files.find(f => f.id === selectedFileId) : null;
};

export const useFile = (fileId: string) => {
  return useSubtitleStore((state) => state.files.find(f => f.id === fileId));
};