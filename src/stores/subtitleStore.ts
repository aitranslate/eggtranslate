/**
 * 字幕文件管理 Store
 * 内存优先架构：tasks 是唯一数据源，files 从 tasks 派生
 * Zustand persist 中间件自动处理 localforage 持久化
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { useMemo } from 'react';
import { SubtitleEntry, SubtitleFileMetadata, Term, TranslationStatus, FilePhases, PhaseProgress, WorkflowType, SplitAlignStatus } from '@/types';
import { loadFromFile as loadFromFileOriginal, convertTaskToMetadata, removeMp3Data } from '@/services/SubtitleFileManager';
import { runTranscriptionPipeline } from '@/services/transcriptionPipeline';
import { executeTranslation, saveTranslationHistory } from '@/services/TranslationOrchestrator';
import { useHistoryStore } from './historyStore';
import { generateStableFileId } from '@/utils/taskIdGenerator';
import { mapSourcePartsToBoundaries, boundariesToRanges } from '@/utils/sourceSplitBoundaries';
import { formatTime, parseTime } from '@/utils/timeUtils';
import { countUnits } from '@/utils/textUnitCounter';
import { getSourceLimit, getTargetLimit } from '@/utils/subtitleLengthPresets';
import { toAppError } from '@/utils/errors';
import { convertToMP3 } from '@/utils/convertToMP3';
import type { ProgressPhase } from '@/types';
import toast from 'react-hot-toast';
import localforage from 'localforage';
import type { SingleTask } from '@/types';

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
  // 唯一数据源
  tasks: SingleTask[];
  selectedFileId: string | null;

  // Queue state (memory-only, not persisted)
  taskQueue: string[];
  activeTaskId: string | null;

  // Actions - 文件操作
  addFile: (file: File) => Promise<string>;
  removeFile: (fileId: string) => Promise<void>;
  selectFile: (fileId: string) => void;
  clearAll: () => Promise<void>;

  // Queue actions
  enqueueTask: (fileId: string) => void;
  dequeueTask: (fileId: string) => void;
  enqueueAllUncompleted: () => void;
  processNext: () => Promise<void>;

  // Actions - 字幕操作
  updateEntry: (fileId: string, entryId: number, text: string, translatedText?: string, status?: TranslationStatus, startTime?: string, endTime?: string, words?: SubtitleEntry['words']) => void;
  deleteEntry: (fileId: string, entryId: number) => void;
  batchUpdateEntries: (fileId: string, updates: Array<{id: number, text: string, translatedText?: string}>) => void;

  // Actions - 转录
  startTranscription: (fileId: string) => Promise<void>;

  // Actions - 翻译
  startTranslation: (fileId: string) => Promise<{ tokens: number; entries: SubtitleEntry[]; phases: FilePhases } | null>;

  // Actions - 阶段状态管理
  updatePhase: (fileId: string, phase: ProgressPhase, update: Partial<PhaseProgress>) => void;
  setWorkflow: (fileId: string, workflow: WorkflowType) => void;

  // Getters
  getFile: (fileId: string) => SubtitleFileMetadata | undefined;
  getAllFiles: () => SubtitleFileMetadata[];
  getTranslationProgress: (fileId: string) => { completed: number; total: number };
  getFileEntries: (fileId: string) => SubtitleEntry[];
  updateEntrySplitStatus: (fileId: string, entryId: number, status: SplitAlignStatus) => void;
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
    // persist 中间件自动处理 localforage 写入，无需 flushAll
  });
}

function checkOngoingTasks(): boolean {
  const tasks = useSubtitleStore.getState().tasks;
  return tasks.some(t =>
    t.phases?.converting?.status === 'active' ||
    t.phases?.transcribing?.status === 'active' ||
    t.phases?.translating?.status === 'active' ||
    t.phases?.splitting?.status === 'active'
  );
}

function isTaskCompleted(file: SubtitleFileMetadata): boolean {
  return file.phases.translating.status === 'completed'
    && file.phases.splitting.status !== 'failed'
    && (file.fileType === 'srt' || file.phases.transcribing.status === 'completed');
}

// ============================================
// Store 创建（persist 中间件包裹）
// ============================================

export const useSubtitleStore = create<SubtitleStore>()(
  persist(
    (set, get) => ({
      // Initial State
      tasks: [],
      selectedFileId: null,
      taskQueue: [],
      activeTaskId: null,

      // ========================================
      // 文件操作
      // ========================================

      addFile: async (file: File) => {
        try {
          const result = await loadFromFileOriginal(file, { existingFilesCount: get().tasks.length });
          // fileRef 存在 task 上（内存中，JSON.stringify 序列化时 File 会丢失，页面刷新后靠 MP3 fallback 恢复）
          const taskWithRef = { ...result.task, fileRef: file };
          set((state) => ({ tasks: [...state.tasks, taskWithRef] }));
          return result.metadata.id;
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

        get().dequeueTask(fileId);

        const translationStore = useTranslationConfigStore.getState();
        if (translationStore.isTranslating && translationStore.currentTaskId === file.taskId) {
          translationStore.stopTranslation();
        }

        try {
          set((state) => ({
            tasks: state.tasks.filter(t => t.taskId !== file.taskId),
            selectedFileId: state.selectedFileId === fileId ? null : state.selectedFileId
          }));
          await removeMp3Data(file.taskId);
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
          const tasksToClean = get().tasks;
          set({ tasks: [], selectedFileId: null, taskQueue: [], activeTaskId: null });
          for (const task of tasksToClean) {
            await removeMp3Data(task.taskId);
          }
          window.dispatchEvent(new CustomEvent('taskCleared'));
        } catch (error) {
          const appError = toAppError(error, '清空数据失败');
          console.error('[subtitleStore]', appError.message, appError);
          toast.error('清空数据失败');
        }
      },

      // ========================================
      // Queue actions
      // ========================================

      enqueueTask: (fileId: string) => {
        const state = get();
        if (state.taskQueue.includes(fileId) || state.activeTaskId === fileId) return;
        const file = state.getFile(fileId);
        if (!file) return;
        if (isTaskCompleted(file)) return;

        set((s) => ({ taskQueue: [...s.taskQueue, fileId] }));
        if (get().activeTaskId === null) {
          get().processNext().catch(err => console.error('[subtitleStore] processNext failed:', err));
        }
      },

      dequeueTask: (fileId: string) => {
        set((s) => ({
          taskQueue: s.taskQueue.filter(id => id !== fileId),
        }));
        if (get().activeTaskId === fileId) {
          const translationStore = useTranslationConfigStore.getState();
          if (translationStore.isTranslating) {
            translationStore.stopTranslation();
          }
          // Note: transcription has no abort mechanism (pre-existing limitation).
          // The finally guard in processNext prevents interference with the next task.
          set({ activeTaskId: null });
          get().processNext().catch(err => console.error('[subtitleStore] processNext failed:', err));
        }
      },

      processNext: async () => {
        const state = get();
        if (state.taskQueue.length === 0) {
          set({ activeTaskId: null });
          return;
        }

        const fileId = state.taskQueue[0];
        set((s) => ({
          taskQueue: s.taskQueue.slice(1),
          activeTaskId: fileId,
        }));

        const file = get().getFile(fileId);
        if (!file) {
          get().processNext().catch(err => console.error('[subtitleStore] processNext failed:', err));
          return;
        }

        try {
          const isAudioVideo = file.fileType === 'audio' || file.fileType === 'video';
          const needsTranscription = isAudioVideo && file.phases.transcribing.status !== 'completed';

          if (needsTranscription) {
            get().setWorkflow(fileId, 'full');
            await get().startTranscription(fileId);

            const afterTranscribe = get().getFile(fileId);
            if (!afterTranscribe || afterTranscribe.phases.transcribing.status !== 'completed') {
              return;
            }
          }

          if (file.fileType === 'srt') {
            get().setWorkflow(fileId, 'translate');
          }
          const result = await get().startTranslation(fileId);
          if (result) {
            await saveTranslationHistory(
              file.taskId,
              file.name,
              result.tokens,
              useHistoryStore.getState().addHistory
            );
          }
        } catch (error) {
          console.error('[subtitleStore] processNext task failed:', error);
        } finally {
          // Only clear if this invocation is still the active one.
          // If dequeueTask was called, activeTaskId is already null and a new processNext is running.
          if (get().activeTaskId === fileId) {
            set({ activeTaskId: null });
            get().processNext().catch(err => console.error('[subtitleStore] processNext failed:', err));
          }
        }
      },

      enqueueAllUncompleted: () => {
        const files = get().getAllFiles();
        for (const file of files) {
          if (!isTaskCompleted(file)) {
            get().enqueueTask(file.id);
          }
        }
      },

      // ========================================
      // 字幕操作（纯内存）
      // ========================================

      updateEntry: (fileId: string, entryId: number, text: string, translatedText?: string, status?: TranslationStatus, startTime?: string, endTime?: string, words?: SubtitleEntry['words']) => {
        const file = get().getFile(fileId);
        if (!file) return;

        set((state) => {
          const newTasks = state.tasks.map(t => {
            if (t.taskId !== file.taskId) return t;
            return {
              ...t,
              subtitle_entries: (t.subtitle_entries || []).map(e => {
                if (e.id !== entryId) return e;
                return {
                  ...e,
                  text,
                  translatedText: translatedText ?? e.translatedText,
                  translationStatus: status ?? e.translationStatus,
                  startTime: startTime ?? e.startTime,
                  endTime: endTime ?? e.endTime,
                  words: words ?? e.words,
                };
              })
            };
          });
          return { tasks: newTasks };
        });
      },

      deleteEntry: (fileId: string, entryId: number) => {
        const file = get().getFile(fileId);
        if (!file) return;

        set((state) => {
          const newTasks = state.tasks.map(t => {
            if (t.taskId !== file.taskId) return t;
            return {
              ...t,
              subtitle_entries: (t.subtitle_entries || []).filter(e => e.id !== entryId)
            };
          });
          return { tasks: newTasks };
        });
      },

      batchUpdateEntries: (fileId: string, updates: Array<{id: number, text: string, translatedText?: string}>) => {
        const file = get().getFile(fileId);
        if (!file) return;

        set((state) => {
          const newTasks = state.tasks.map(t => {
            if (t.taskId !== file.taskId) return t;
            const entries = [...(t.subtitle_entries || [])];
            for (const update of updates) {
              const idx = entries.findIndex(e => e.id === update.id);
              if (idx !== -1) {
                entries[idx] = {
                  ...entries[idx],
                  text: update.text,
                  translatedText: update.translatedText ?? entries[idx].translatedText,
                };
              }
            }
            return { ...t, subtitle_entries: entries };
          });
          return { tasks: newTasks };
        });
      },

      updateEntrySplitStatus: (fileId: string, entryId: number, status: SplitAlignStatus) => {
        const file = get().getFile(fileId);
        if (!file) return;

        set((state) => {
          const newTasks = state.tasks.map(t => {
            if (t.taskId !== file.taskId) return t;
            return {
              ...t,
              subtitle_entries: (t.subtitle_entries || []).map(e =>
                e.id === entryId ? { ...e, splitAlignStatus: status } : e
              )
            };
          });
          return { tasks: newTasks };
        });
      },

      // ========================================
      // 转录操作
      // ========================================

      startTranscription: async (fileId: string) => {
        const file = get().getFile(fileId);
        if (!file || file.fileType === 'srt') return;

        // 如果已经转录完成，跳过
        if (file.phases.transcribing.status === 'completed') {
          console.log('[subtitleStore] 转录已完成，跳过');
          return;
        }

        try {
          // fileRef 在内存中的 task 上（不持久化到 localforage）
          let mediaFile: File | undefined = file.fileRef;

          // 如果没有 fileRef，尝试从 IndexedDB 加载保存的 MP3（MP3 保持独立 localforage 管理）
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

          let mp3Blob: Blob;

          // 如果已转码完成，使用保存的 MP3；否则转码并保存
          if (file.phases.converting.status === 'completed') {
            console.log('[subtitleStore] 转码已完成，使用已保存的 MP3');
            mp3Blob = await localforage.getItem<Blob>(`mp3_data:${file.taskId}`);
            if (!mp3Blob) {
              toast.error('MP3 数据丢失，请重新上传');
              return;
            }
          } else {
            // 需要转码
            get().updatePhase(fileId, 'converting', { status: 'active', progress: -1, tokens: 0 });

            try {
              mp3Blob = await convertToMP3(mediaFile);
            } catch (error) {
              const appError = toAppError(error, '音频转码失败');
              console.error('[subtitleStore]', appError.message, appError);
              toast.error(`转码失败: ${appError.message}`);
              get().updatePhase(fileId, 'converting', { status: 'failed', progress: 0 });
              return;
            }
            // MP3 保存到 localforage（独立管理，不走 persist）
            await localforage.setItem(`mp3_data:${file.taskId}`, mp3Blob);
            console.log('[subtitleStore] 已保存 MP3 到 IndexedDB');
          }

          // 使用转换后的 MP3 文件进行转录
          const mp3File = new File([mp3Blob], 'audio.mp3', { type: 'audio/mpeg' });

          const result = await runTranscriptionPipeline(
            mp3File,
            allKeyterms,
            {
              onConverting: () => {
                const currentPhases = get().getFile(fileId)?.phases;
                if (currentPhases?.converting.status !== 'completed') {
                  get().updatePhase(fileId, 'converting', { status: 'active', progress: -1 });
                }
              },
              onUploading: () => {
                const currentPhases = get().getFile(fileId)?.phases;
                if (currentPhases?.converting.status !== 'completed') {
                  get().updatePhase(fileId, 'converting', { status: 'active', progress: -1 });
                }
              },
              onTranscribing: () => {
                const currentPhases = get().getFile(fileId)?.phases;
                if (currentPhases?.converting.status !== 'completed') {
                  get().updatePhase(fileId, 'converting', { status: 'completed', progress: 100 });
                }
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

          // 直接更新 tasks（内存操作，persist 自动持久化）
          set((state) => {
            const newTasks = state.tasks.map(t =>
              t.taskId === file.taskId
                ? {
                    ...t,
                    subtitle_entries: result.entries,
                    phases: {
                      ...t.phases,
                      converting: { status: 'completed', progress: 100, tokens: 0 } as PhaseProgress,
                      transcribing: { status: 'completed', progress: 100, tokens: 0, language: result.language, entryCount: result.entries.length, totalEntries: result.entries.length } as PhaseProgress,
                    }
                  }
                : t
            );
            return { tasks: newTasks };
          });

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

      // ========================================
      // 阶段状态管理（同步更新 tasks + files）
      // ========================================

      updatePhase: (fileId: string, phase: ProgressPhase, update: Partial<PhaseProgress>) => {
        const file = get().getFile(fileId);
        if (!file) return;

        // 完成时清除错误信息
        if (update.status === 'completed') {
          update.errorMessage = undefined;
        }

        set((state) => ({
          tasks: state.tasks.map(t =>
            t.taskId === file.taskId
              ? { ...t, phases: { ...t.phases, [phase]: { ...t.phases[phase], ...update } } }
              : t
          )
        }));
      },

      setWorkflow: (fileId: string, workflow: WorkflowType) => {
        const file = get().getFile(fileId);
        if (!file) return;

        set((state) => ({
          tasks: state.tasks.map(t =>
            t.taskId === file.taskId ? { ...t, phases: { ...t.phases, workflow } } : t
          )
        }));
      },

      // ========================================
      // 翻译操作
      // ========================================

      startTranslation: async (fileId: string): Promise<{ tokens: number; entries: SubtitleEntry[]; phases: FilePhases } | null> => {
        const file = get().getFile(fileId);
        if (!file) return null;

        // 如果翻译已完成，跳过
        if (file.phases.translating.status === 'completed' && file.phases.splitting.status === 'completed') {
          console.log('[subtitleStore] 翻译和断句对齐都已完成，跳过');
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
          const task = get().tasks.find(t => t.taskId === file.taskId);
          const entries = task?.subtitle_entries || [];

          // 恢复翻译进度（断点续跑时保持已有进度）
          const restoredProgress = file.phases.translating.progress > 0 ? file.phases.translating.progress : 0;
          const restoredTokens = file.phases.translating.tokens || 0;

          // 只有未完成才设置 active 状态，但保留已有进度和 tokens
          if (file.phases.translating.status !== 'completed') {
            get().updatePhase(fileId, 'translating', { status: 'active', progress: restoredProgress, tokens: restoredTokens });
          }
          if (file.phases.splitting.status !== 'completed') {
            get().updatePhase(fileId, 'splitting', { status: 'upcoming', progress: 0, tokens: 0 });
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
                get().updateEntry(fileId, id, text, translatedText, status);
              },
              updateProgress: async (current: number, total: number, phase: 'direct' | 'splitting' | 'completed', status: string, taskId: string, newTokens?: number) => {
                await translationConfigStore.updateProgress(current, total, phase, status, taskId);

                if (newTokens !== undefined && newTokens > 0) {
                  const prevTokens = get().getFile(fileId)?.tokensUsed || 0;
                  const currentTokens = prevTokens + newTokens;
                  get().updatePhase(fileId, 'translating', {
                    progress: total > 0 ? Math.round((current / total) * 100) : 0,
                    tokens: currentTokens
                  });
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

          // 完成翻译 — 更新 tasks（内存操作）
          const tokensAfterTranslate = get().getFile(fileId)?.tokensUsed || 0;
          get().updatePhase(fileId, 'translating', { status: 'completed', progress: 100, tokens: tokensAfterTranslate });

          const aiSegmentationEnabled = useTranscriptionStore.getState().aiSegmentationEnabled;
          if (!aiSegmentationEnabled) {
            console.log('[subtitleStore] AI 断句对齐已关闭，跳过');
            toast.success(`${file.name} 翻译完成`);
            const tokens = get().getFile(fileId)?.tokensUsed || 0;
            const finalTask = get().tasks.find(t => t.taskId === file.taskId);
            const finalFile = get().getFile(fileId);
            return { tokens, entries: finalTask?.subtitle_entries || entries, phases: finalFile!.phases };
          }

          let splitSucceeded = false;
          try {
            const preset = useTranscriptionStore.getState().subtitleLengthPreset;
            let postSplitEntries = get().tasks.find(t => t.taskId === file.taskId)?.subtitle_entries || [];

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

                  get().updateEntry(fileId, parentId, mergedText, mergedTranslation, undefined, restoredStartTime, restoredEndTime, mergedWords.length > 0 ? mergedWords : undefined);
                }
              }
              for (const ce of compositeEntries) {
                get().deleteEntry(fileId, ce.id);
              }
              postSplitEntries = get().tasks.find(t => t.taskId === file.taskId)?.subtitle_entries || [];
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

              // 恢复断句对齐进度（断点续跑时保持已有进度）
              const restoredSplitProgress = file.phases.splitting.progress > 0 ? file.phases.splitting.progress : 0;
              get().updatePhase(fileId, 'splitting', { status: 'active', progress: restoredSplitProgress, tokens: file.phases.splitting.tokens || 0 });

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
                const entries = get().tasks.find(t => t.taskId === file.taskId)?.subtitle_entries || [];
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
                    console.warn(`[subtitleStore] 对齐结果数量不匹配，跳过条目 ${entry.id}`);
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
                    get().updateEntry(fileId, entry.id, parsed.sourceParts[0], translations[0]?.text || '', undefined, formatTime(firstStart), formatTime(firstEnd), firstWords);

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
                      set((state) => {
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
                    get().updateEntry(fileId, entry.id, parsed.sourceParts[0], translations[0]?.text || '', undefined, formatTime(partTimestamps[0].start), formatTime(partTimestamps[0].end));

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
                      set((state) => {
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
                  console.warn(`[subtitleStore] 原子 split+align 失败，条目 ${entry.id}:`, error);
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
                    get().updateEntrySplitStatus(fileId, entry.id, 'in_progress');

                    if (!needsSplit(entry, sourceLimit, targetLimit)) {
                      get().updateEntrySplitStatus(fileId, entry.id, 'completed');
                      return { success: true, tokens: 0 };
                    }

                    const result = await performSplitAlignAtomic(entry, sourceLimit, targetLimit);
                    if (result.success) {
                      get().updateEntrySplitStatus(fileId, entry.id, 'completed');
                    } else {
                      get().updateEntrySplitStatus(fileId, entry.id, 'pending');
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

              get().updatePhase(fileId, 'splitting', {
                status: 'completed',
                progress: 100,
                tokens: totalTokens,
              });
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
          const finalTask = get().tasks.find(t => t.taskId === file.taskId);
          const lastEntries = finalTask?.subtitle_entries || entries;
          const finalPhases = get().getFile(fileId)?.phases;
          console.log(`[subtitleStore] 任务完成，总消耗 ${finalTokens} tokens`);
          return { tokens: finalTokens, entries: lastEntries, phases: finalPhases! };
        } catch (error) {
          const appError = toAppError(error, '翻译失败');
          console.error('[subtitleStore]', appError.message, appError);
          toast.error(`翻译失败: ${appError.message}`);

          const phases = get().getFile(fileId)?.phases;
          if (phases?.translating.status === 'active') {
            get().updatePhase(fileId, 'translating', {
              status: 'failed',
              errorMessage: error instanceof Error ? error.message : String(error),
            });
          }
          if (phases?.splitting.status === 'active') {
            get().updatePhase(fileId, 'splitting', {
              status: 'failed',
              errorMessage: error instanceof Error ? error.message : String(error),
            });
          }
        } finally {
          translationConfigStore.stopTranslation();
        }
        return null;
      },

      // ========================================
      // Getters（从 tasks 实时计算）
      // ========================================

      getFile: (fileId: string) => {
        const task = get().tasks.find(t => generateStableFileId(t.taskId) === fileId);
        return task ? convertTaskToMetadata(task) : undefined;
      },

      getAllFiles: () => {
        return get().tasks.map(t => convertTaskToMetadata(t));
      },

      getTranslationProgress: (fileId: string) => {
        const file = get().getFile(fileId);
        if (!file) return { completed: 0, total: 0 };
        return { completed: file.translatedCount || 0, total: file.entryCount || 0 };
      },

      // ========================================
      // 元数据管理方法（同步，从 tasks 派生）
      // ========================================

      getFileEntries: (fileId: string) => {
        const file = get().getFile(fileId);
        if (!file) return [];
        const task = get().tasks.find(t => t.taskId === file.taskId);
        return task?.subtitle_entries || [];
      },
    }),
    {
      name: 'batch_tasks',
      storage: createJSONStorage(() => localforage),
      partialize: (state) => ({
        tasks: state.tasks.map(({ fileRef, ...task }) => task),
      }),
      version: 1,
      migrate: (persistedState: unknown, version: number) => {
        // 旧格式：{ tasks: [...] }（来自 localforage batch_tasks）
        // 新格式：{ tasks: [...] }（persist 中间件格式）
        if (
          persistedState &&
          typeof persistedState === 'object' &&
          Array.isArray((persistedState as { tasks?: unknown }).tasks)
        ) {
          return persistedState as { tasks: SingleTask[] };
        }
        // 兜底：空数据
        return { tasks: [] };
      },
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) return;
        // 检测中断：active → failed
        let mutated = false;
        for (const task of state.tasks) {
          if (task.phases) {
            for (const phase of ['converting', 'transcribing', 'translating', 'splitting'] as const) {
              if (task.phases[phase]?.status === 'active') {
                task.phases[phase] = {
                  status: 'failed',
                  progress: task.phases[phase].progress || 0,
                  tokens: task.phases[phase].tokens || 0
                } as PhaseProgress;
                mutated = true;
              }
            }
          }
        }
        if (mutated) {
          useSubtitleStore.setState({ tasks: [...state.tasks] });
        }
      },
    }
  )
);

// ============================================
// 导出辅助 hooks
// ============================================

export const useFiles = () => {
  const tasks = useSubtitleStore(useShallow((state) => state.tasks));
  return useMemo(() => tasks.map(convertTaskToMetadata), [tasks]);
};

export const useSelectedFile = () => {
  const selectedFileId = useSubtitleStore((state) => state.selectedFileId);
  const tasks = useSubtitleStore(useShallow((state) => state.tasks));
  return useMemo(() => {
    if (!selectedFileId) return null;
    const task = tasks.find(t => generateStableFileId(t.taskId) === selectedFileId);
    return task ? convertTaskToMetadata(task) : null;
  }, [tasks, selectedFileId]);
};

export const useFile = (fileId: string) => {
  const tasks = useSubtitleStore(useShallow((state) => state.tasks));
  return useMemo(() => {
    const task = tasks.find(t => generateStableFileId(t.taskId) === fileId);
    return task ? convertTaskToMetadata(task) : undefined;
  }, [tasks, fileId]);
};

export const useQueueState = () => {
  const taskQueue = useSubtitleStore(useShallow((state) => state.taskQueue));
  const activeTaskId = useSubtitleStore((state) => state.activeTaskId);
  return useMemo(() => ({ taskQueue, activeTaskId }), [taskQueue, activeTaskId]);
};
