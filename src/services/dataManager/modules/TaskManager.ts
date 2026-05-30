import localforage from 'localforage';
import { SubtitleEntry, SingleTask, BatchTasks, TranslationStatus, FileType } from '@/types';
import { toAppError } from '@/utils/errors';

/**
 * 任务管理器 - 负责翻译任务的 CRUD 操作
 */
class TaskManager {
  private memoryStore: {
    batch_tasks: BatchTasks;
  };

  private readonly BATCH_TASKS_KEY = 'batch_tasks';

  constructor(memoryStore: { batch_tasks: BatchTasks }) {
    this.memoryStore = memoryStore;
  }

  /**
   * 获取批处理任务列表
   */
  getBatchTasks(): BatchTasks {
    return this.memoryStore.batch_tasks;
  }

  /**
   * 根据任务ID获取单个任务
   */
  getTaskById(taskId: string): SingleTask | undefined {
    return this.memoryStore.batch_tasks.tasks.find(task => task.taskId === taskId);
  }

  /**
   * 创建新的翻译任务
   */
  async createNewTask(
    filename: string,
    entries: SubtitleEntry[],
    index: number,
    generateTaskId: () => string,
    options?: {
      fileType?: FileType;
      fileSize?: number;
      duration?: number;
    }
  ): Promise<string> {
    try {
      const taskId = generateTaskId();
      const newTask: SingleTask = {
        taskId,
        subtitle_entries: entries,
        subtitle_filename: filename,
        translation_progress: {
          completed: 0,
          total: entries.length,
          tokens: 0,
          status: 'idle'
        },
        index,
        fileType: options?.fileType,
        fileSize: options?.fileSize,
        duration: options?.duration
      };

      // 更新内存中的数据
      this.memoryStore.batch_tasks.tasks.push(newTask);

      // 持久化到 localforage
      await localforage.setItem(this.BATCH_TASKS_KEY, this.memoryStore.batch_tasks);

      return taskId;
    } catch (error) {
      const appError = toAppError(error, '创建翻译任务失败');
      console.error('[TaskManager]', appError.message, appError);
      throw appError;
    }
  }

  /**
   * 更新指定任务的字幕条目（包含持久化）
   */
  async updateTaskSubtitleEntry(
    taskId: string,
    entryId: number,
    text: string,
    translatedText?: string,
    status?: TranslationStatus,
    startTime?: string,
    endTime?: string
  ): Promise<void> {
    try {
      const task = this.memoryStore.batch_tasks.tasks.find(t => t.taskId === taskId);
      if (!task) return;

      // 更新内存中的数据
      const updatedEntries = task.subtitle_entries.map(entry =>
        entry.id === entryId
          ? {
              ...entry,
              text,
              translatedText: translatedText ?? entry.translatedText,
              ...(status !== undefined && { translationStatus: status }),
              ...(startTime !== undefined && { startTime }),
              ...(endTime !== undefined && { endTime })
            }
          : entry
      );

      // 重新计算完成数量
      const completed = updatedEntries.filter(entry =>
        entry.translatedText && entry.translatedText.trim() !== ''
      ).length;

      // 更新内存中的任务数据
      const updatedTask = {
        ...task,
        subtitle_entries: updatedEntries,
        translation_progress: {
          ...task.translation_progress,
          completed,
          total: task.translation_progress.total || updatedEntries.length
        }
      };

      // 替换任务列表中的任务
      const taskIndex = this.memoryStore.batch_tasks.tasks.findIndex(t => t.taskId === taskId);
      if (taskIndex !== -1) {
        this.memoryStore.batch_tasks.tasks[taskIndex] = updatedTask;
      }

      // 持久化到 localforage
      await localforage.setItem(this.BATCH_TASKS_KEY, this.memoryStore.batch_tasks);
    } catch (error) {
      const appError = toAppError(error, '更新字幕条目失败');
      console.error('[TaskManager]', appError.message, appError);
      throw appError;
    }
  }

  /**
   * 更新指定任务的字幕条目（仅在内存中更新，不持久化）
   */
  updateTaskSubtitleEntryInMemory(
    taskId: string,
    entryId: number,
    text: string,
    translatedText?: string,
    status?: TranslationStatus,
    startTime?: string,
    endTime?: string,
    words?: SubtitleEntry['words']
  ): void {
    try {
      const task = this.memoryStore.batch_tasks.tasks.find(t => t.taskId === taskId);
      if (!task) return;

      // 更新内存中的数据
      const updatedEntries = task.subtitle_entries.map(entry =>
        entry.id === entryId
          ? {
              ...entry,
              text,
              translatedText: translatedText ?? entry.translatedText,
              ...(status !== undefined && { translationStatus: status }),
              ...(startTime !== undefined && { startTime }),
              ...(endTime !== undefined && { endTime }),
              ...(words !== undefined && { words })
            }
          : entry
      );

      // 重新计算完成数量
      const completed = updatedEntries.filter(entry =>
        entry.translatedText && entry.translatedText.trim() !== ''
      ).length;

      // 更新内存中的任务数据
      const updatedTask = {
        ...task,
        subtitle_entries: updatedEntries,
        translation_progress: {
          ...task.translation_progress,
          completed,
          total: task.translation_progress.total || updatedEntries.length
        }
      };

      // 替换任务列表中的任务
      const taskIndex = this.memoryStore.batch_tasks.tasks.findIndex(t => t.taskId === taskId);
      if (taskIndex !== -1) {
        this.memoryStore.batch_tasks.tasks[taskIndex] = updatedTask;
      }
    } catch (error) {
      const appError = toAppError(error, '更新内存中的字幕条目失败');
      console.error('[TaskManager]', appError.message, appError);
    }
  }

  /**
   * 在指定条目之后插入新字幕条目（仅在内存中更新，不持久化）
   */
  addSubtitleEntryAfterInMemory(taskId: string, afterEntryId: number, newEntry: SubtitleEntry): void {
    try {
      const task = this.memoryStore.batch_tasks.tasks.find(t => t.taskId === taskId);
      if (!task) return;

      const insertIndex = task.subtitle_entries.findIndex(e => e.id === afterEntryId);
      if (insertIndex === -1) return;

      task.subtitle_entries.splice(insertIndex + 1, 0, newEntry);

      // 重新计算完成数量
      const completed = task.subtitle_entries.filter(entry =>
        entry.translatedText && entry.translatedText.trim() !== ''
      ).length;

      task.translation_progress = {
        ...task.translation_progress,
        completed,
        total: task.subtitle_entries.length
      };
    } catch (error) {
      const appError = toAppError(error, '插入内存中的字幕条目失败');
      console.error('[TaskManager]', appError.message, appError);
    }
  }

  /**
   * 删除指定任务的字幕条目（仅在内存中更新，不持久化）
   */
  deleteTaskSubtitleEntryInMemory(taskId: string, entryId: number): void {
    try {
      const task = this.memoryStore.batch_tasks.tasks.find(t => t.taskId === taskId);
      if (!task) return;

      // 从内存中删除指定条目
      task.subtitle_entries = task.subtitle_entries.filter(entry => entry.id !== entryId);

      // 重新计算完成数量
      const completed = task.subtitle_entries.filter(entry =>
        entry.translatedText && entry.translatedText.trim() !== ''
      ).length;

      // 更新翻译进度
      task.translation_progress = {
        ...task.translation_progress,
        completed,
        total: task.subtitle_entries.length
      };
    } catch (error) {
      const appError = toAppError(error, '删除内存中的字幕条目失败');
      console.error('[TaskManager]', appError.message, appError);
    }
  }

  /**
   * 批量更新指定任务的字幕条目
   */
  async batchUpdateTaskSubtitleEntries(
    taskId: string,
    updates: { id: number; text: string; translatedText?: string; status?: TranslationStatus }[]
  ): Promise<void> {
    try {
      const task = this.memoryStore.batch_tasks.tasks.find(t => t.taskId === taskId);
      if (!task) return;

      // 一次性处理所有更新
      const updatedEntries = task.subtitle_entries.map(entry => {
        const update = updates.find(u => u.id === entry.id);
        return update ? {
          ...entry,
          text: update.text,
          translatedText: update.translatedText ?? entry.translatedText,
          ...(update.status !== undefined && { translationStatus: update.status })
        } : entry;
      });

      // 重新计算完成数量
      const completed = updatedEntries.filter(entry =>
        entry.translatedText && entry.translatedText.trim() !== ''
      ).length;

      // 更新内存中的任务数据
      const updatedTask = {
        ...task,
        subtitle_entries: updatedEntries,
        translation_progress: {
          ...task.translation_progress,
          completed,
          total: task.translation_progress.total || updatedEntries.length
        }
      };

      // 替换任务列表中的任务
      const taskIndex = this.memoryStore.batch_tasks.tasks.findIndex(t => t.taskId === taskId);
      if (taskIndex !== -1) {
        this.memoryStore.batch_tasks.tasks[taskIndex] = updatedTask;
      }
    } catch (error) {
      const appError = toAppError(error, '批量更新字幕条目失败');
      console.error('[TaskManager]', appError.message, appError);
      throw appError;
    }
  }

  /**
   * 更新指定任务的翻译进度（包含持久化）
   */
  async updateTaskTranslationProgress(
    taskId: string,
    updates: Partial<SingleTask['translation_progress']>
  ): Promise<void> {
    try {
      const task = this.memoryStore.batch_tasks.tasks.find(t => t.taskId === taskId);
      if (!task) return;

      // 更新内存中的任务数据
      const updatedTask = {
        ...task,
        translation_progress: {
          ...task.translation_progress,
          ...updates
        }
      };

      // 替换任务列表中的任务
      const taskIndex = this.memoryStore.batch_tasks.tasks.findIndex(t => t.taskId === taskId);
      if (taskIndex !== -1) {
        this.memoryStore.batch_tasks.tasks[taskIndex] = updatedTask;
      }

      // 持久化到 localforage
      await localforage.setItem(this.BATCH_TASKS_KEY, this.memoryStore.batch_tasks);
    } catch (error) {
      const appError = toAppError(error, '更新翻译进度失败');
      console.error('[TaskManager]', appError.message, appError);
      throw appError;
    }
  }

  /**
   * 更新指定任务的翻译进度（仅在内存中更新，不持久化）
   */
  updateTaskTranslationProgressInMemory(
    taskId: string,
    updates: Partial<SingleTask['translation_progress']>
  ): void {
    try {
      const task = this.memoryStore.batch_tasks.tasks.find(t => t.taskId === taskId);
      if (!task) return;

      // 更新内存中的任务数据
      const updatedTask = {
        ...task,
        translation_progress: {
          ...task.translation_progress,
          ...updates
        }
      };

      // 替换任务列表中的任务
      const taskIndex = this.memoryStore.batch_tasks.tasks.findIndex(t => t.taskId === taskId);
      if (taskIndex !== -1) {
        this.memoryStore.batch_tasks.tasks[taskIndex] = updatedTask;
      }
    } catch (error) {
      const appError = toAppError(error, '更新内存中的翻译进度失败');
      console.error('[TaskManager]', appError.message, appError);
    }
  }

  /**
   * 完成指定任务并持久化
   */
  async completeTask(taskId: string, finalTokens: number): Promise<void> {
    try {
      const task = this.memoryStore.batch_tasks.tasks.find(t => t.taskId === taskId);
      if (!task) return;

      // 获取实际完成的字幕数量
      let completedCount = 0;
      if (task.subtitle_entries && Array.isArray(task.subtitle_entries)) {
        completedCount = task.subtitle_entries.filter((entry) =>
          entry.translatedText && entry.translatedText.trim() !== ''
        ).length;
      }

      // 确保使用较大的Token值和正确的完成数量
      const oldTokens = task.translation_progress?.tokens || 0;
      const tokensToSave = Math.max(finalTokens, oldTokens);
      const totalEntries = task.translation_progress?.total || 0;

      // 更新内存中的任务数据
      const updatedTask = {
        ...task,
        translation_progress: {
          ...task.translation_progress,
          completed: completedCount,
          total: totalEntries,
          tokens: tokensToSave,
          status: 'completed' as const
        }
      };

      // 替换任务列表中的任务
      const taskIndex = this.memoryStore.batch_tasks.tasks.findIndex(t => t.taskId === taskId);
      if (taskIndex !== -1) {
        this.memoryStore.batch_tasks.tasks[taskIndex] = updatedTask;
      }

      // 持久化到 localforage
      await localforage.setItem(this.BATCH_TASKS_KEY, this.memoryStore.batch_tasks);
    } catch (error) {
      const appError = toAppError(error, '完成翻译任务失败');
      console.error('[TaskManager]', appError.message, appError);
      throw appError;
    }
  }

  /**
   * 清空所有批处理任务
   */
  async clearBatchTasks(): Promise<void> {
    try {
      // 清空内存中的数据
      this.memoryStore.batch_tasks = { tasks: [] };

      // 清空持久化存储
      await localforage.setItem(this.BATCH_TASKS_KEY, { tasks: [] });
    } catch (error) {
      const appError = toAppError(error, '清空批处理任务失败');
      console.error('[TaskManager]', appError.message, appError);
      throw appError;
    }
  }

  /**
   * 移除指定任务
   */
  async removeTask(taskId: string): Promise<void> {
    try {
      // 更新内存中的数据
      this.memoryStore.batch_tasks.tasks = this.memoryStore.batch_tasks.tasks.filter(
        t => t.taskId !== taskId
      );

      // 持久化到 localforage
      await localforage.setItem(this.BATCH_TASKS_KEY, this.memoryStore.batch_tasks);
    } catch (error) {
      const appError = toAppError(error, '移除任务失败');
      console.error('[TaskManager]', appError.message, appError);
      throw appError;
    }
  }

  /**
   * 更新指定任务的转录完成数据（包含字幕条目和时长）
   * 用于音视频转录完成后保存结果
   */
  async updateTaskWithTranscription(
    taskId: string,
    entries: SubtitleEntry[],
    duration: number,
    tokensUsed?: number
  ): Promise<void> {
    const task = this.memoryStore.batch_tasks.tasks.find(t => t.taskId === taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    try {
      // 更新内存中的任务数据
      const updatedTask = {
        ...task,
        subtitle_entries: entries,
        duration,
        translation_progress: {
          ...task.translation_progress,
          total: entries.length,
          completed: 0,
          status: 'idle' as const,
          // ✅ 直接使用传入的 tokensUsed，不再累加（已经在回调中累积过了）
          tokens: tokensUsed ?? 0
        }
      };

      // 替换任务列表中的任务
      const taskIndex = this.memoryStore.batch_tasks.tasks.findIndex(t => t.taskId === taskId);
      if (taskIndex !== -1) {
        this.memoryStore.batch_tasks.tasks[taskIndex] = updatedTask;
      }

      // 持久化到 localforage
      await localforage.setItem(this.BATCH_TASKS_KEY, this.memoryStore.batch_tasks);
    } catch (error) {
      const appError = toAppError(error, '更新转录完成数据失败');
      console.error('[TaskManager]', appError.message, appError);
      throw appError;
    }
  }
}

export default TaskManager;
