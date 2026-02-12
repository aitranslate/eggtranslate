import localforage from 'localforage';
import {
  TranslationConfig,
  SubtitleEntry,
  Term,
  TranslationHistoryEntry,
  CurrentTranslationTask,
  SingleTask,
  BatchTasks,
} from '@/types';
import TaskManager from './modules/TaskManager';
import TermsManager from './modules/TermsManager';
import ConfigManager from './modules/ConfigManager';
import HistoryManager from './modules/HistoryManager';
import TranscriptionConfigManager from './modules/TranscriptionConfigManager';
import { toAppError } from '@/utils/errors';

// 转录配置类型（本地定义，从 TranscriptionConfigManager 导入）
interface TranscriptionConfig {
  keytermGroups?: import('@/types/transcription').KeytermGroup[];
}

/**
 * 数据管理器 - 内存数据存储与异步持久化
 *
 * 设计原则：
 * 1. 所有数据操作优先在内存中进行，提高性能
 * 2. 在特定时机异步同步到 localforage 进行持久化
 * 3. 持久化时机：
 *    - batch_tasks：导入文件时
 *    - terms_list：术语列表改动时
 *    - translation_config：保存设置时
 *    - translation_history：添加历史记录时
 */
class DataManager {
  // 内存中的数据存储
  private memoryStore: {
    batch_tasks: BatchTasks;
    terms_list: Term[];
    translation_config: TranslationConfig;
    transcription_config?: TranscriptionConfig;
    translation_history: TranslationHistoryEntry[];
    current_translation_task?: CurrentTranslationTask;
  };

  // 子管理器
  private taskManager: TaskManager;
  private termsManager: TermsManager;
  private configManager: ConfigManager;
  private historyManager: HistoryManager;
  private transcriptionConfigManager: TranscriptionConfigManager;

  constructor() {
    // 初始化内存存储
    this.memoryStore = {
      batch_tasks: { tasks: [] },
      terms_list: [],
      translation_config: {} as TranslationConfig, // 将在 configManager 初始化时设置
      translation_history: [],
      current_translation_task: undefined
    };

    // 初始化子管理器
    this.configManager = new ConfigManager(this.memoryStore);
    this.memoryStore.translation_config = this.configManager.getDefaultConfig();

    this.taskManager = new TaskManager(this.memoryStore);
    this.termsManager = new TermsManager(this.memoryStore);
    this.historyManager = new HistoryManager(this.memoryStore);
    this.transcriptionConfigManager = new TranscriptionConfigManager(this.memoryStore);
  }

  /**
   * 初始化数据管理器
   * 从 localforage 加载数据到内存中
   */
  async initialize(): Promise<void> {
    try {
      const KEYS = {
        BATCH_TASKS: 'batch_tasks',
        TERMS: 'terms_list',
        CONFIG: 'translation_config',
        TRANSCRIPTION_CONFIG: 'transcription_config',
        HISTORY: 'translation_history'
      };

      // 并行加载所有数据
      const [batchTasks, terms, config, transcriptionConfig, history] = await Promise.all([
        localforage.getItem<BatchTasks>(KEYS.BATCH_TASKS),
        localforage.getItem<Term[]>(KEYS.TERMS),
        localforage.getItem<TranslationConfig>(KEYS.CONFIG),
        localforage.getItem<TranscriptionConfig>(KEYS.TRANSCRIPTION_CONFIG),
        localforage.getItem<TranslationHistoryEntry[]>(KEYS.HISTORY)
      ]);

      // 更新内存存储
      this.memoryStore.batch_tasks = batchTasks || { tasks: [] };
      this.memoryStore.terms_list = terms || [];
      this.memoryStore.translation_config = config || this.configManager.getDefaultConfig();
      this.memoryStore.transcription_config = transcriptionConfig;
      this.memoryStore.translation_history = history || [];
    } catch (error) {
      const appError = toAppError(error, '数据管理器初始化失败');
      console.error('[DataManager]', appError.message, appError);
      throw appError;
    }
  }

  // ===== 当前翻译任务模块 =====

  /**
   * 获取当前翻译任务（从内存中）
   */
  getCurrentTask(): CurrentTranslationTask | null {
    return this.memoryStore.current_translation_task || null;
  }

  /**
   * 清空当前翻译任务
   */
  async clearCurrentTask(): Promise<void> {
    try {
      this.memoryStore.current_translation_task = undefined;
    } catch (error) {
      const appError = toAppError(error, '清空当前翻译任务失败');
      console.error('[DataManager]', appError.message, appError);
      throw appError;
    }
  }

  // ===== 批量任务模块 (委托给 TaskManager) =====

  getBatchTasks(): BatchTasks {
    return this.taskManager.getBatchTasks();
  }

  getTaskById(taskId: string): SingleTask | undefined {
    return this.taskManager.getTaskById(taskId);
  }

  async createNewTask(
    filename: string,
    entries: SubtitleEntry[],
    index: number,
    options?: {
      fileType?: 'srt' | 'audio-video';
      fileSize?: number;
      duration?: number;
    }
  ): Promise<string> {
    return this.taskManager.createNewTask(filename, entries, index, () => this.generateTaskId(), options);
  }

  async updateTaskSubtitleEntry(taskId: string, entryId: number, text: string, translatedText?: string, status?: 'pending' | 'completed'): Promise<void> {
    return this.taskManager.updateTaskSubtitleEntry(taskId, entryId, text, translatedText, status);
  }

  updateTaskSubtitleEntryInMemory(taskId: string, entryId: number, text: string, translatedText?: string, status?: 'pending' | 'completed'): void {
    return this.taskManager.updateTaskSubtitleEntryInMemory(taskId, entryId, text, translatedText, status);
  }

  deleteTaskSubtitleEntryInMemory(taskId: string, entryId: number): void {
    return this.taskManager.deleteTaskSubtitleEntryInMemory(taskId, entryId);
  }

  async batchUpdateTaskSubtitleEntries(taskId: string, updates: {id: number, text: string, translatedText?: string, status?: 'pending' | 'completed'}[]): Promise<void> {
    return this.taskManager.batchUpdateTaskSubtitleEntries(taskId, updates);
  }

  async updateTaskTranslationProgress(taskId: string, updates: Partial<SingleTask['translation_progress']>): Promise<void> {
    return this.taskManager.updateTaskTranslationProgress(taskId, updates);
  }

  updateTaskTranslationProgressInMemory(taskId: string, updates: Partial<SingleTask['translation_progress']>): void {
    return this.taskManager.updateTaskTranslationProgressInMemory(taskId, updates);
  }

  async completeTask(taskId: string, finalTokens: number): Promise<void> {
    return this.taskManager.completeTask(taskId, finalTokens);
  }

  async clearBatchTasks(): Promise<void> {
    return this.taskManager.clearBatchTasks();
  }

  async removeTask(taskId: string): Promise<void> {
    return this.taskManager.removeTask(taskId);
  }

  async updateTaskWithTranscription(taskId: string, entries: SubtitleEntry[], duration: number, tokensUsed?: number): Promise<void> {
    return this.taskManager.updateTaskWithTranscription(taskId, entries, duration, tokensUsed);
  }

  // ===== 术语管理模块 (委托给 TermsManager) =====

  getTerms(): Term[] {
    return this.termsManager.getTerms();
  }

  async saveTerms(terms: Term[]): Promise<void> {
    return this.termsManager.saveTerms(terms);
  }

  async addTerm(term: Term): Promise<void> {
    return this.termsManager.addTerm(term);
  }

  async removeTerm(index: number): Promise<void> {
    return this.termsManager.removeTerm(index);
  }

  async updateTerm(index: number, original: string, translation: string): Promise<void> {
    return this.termsManager.updateTerm(index, original, translation);
  }

  async clearTerms(): Promise<void> {
    return this.termsManager.clearTerms();
  }

  // ===== 配置管理模块 (委托给 ConfigManager) =====

  getConfig(): TranslationConfig {
    return this.configManager.getConfig();
  }

  async saveConfig(config: TranslationConfig): Promise<void> {
    return this.configManager.saveConfig(config);
  }

  async updateConfig(updates: Partial<TranslationConfig>): Promise<TranslationConfig> {
    return this.configManager.updateConfig(updates);
  }

  // ===== 历史记录模块 (委托给 HistoryManager) =====

  getHistory(): TranslationHistoryEntry[] {
    return this.historyManager.getHistory();
  }

  async saveHistory(history: TranslationHistoryEntry[]): Promise<void> {
    return this.historyManager.saveHistory(history);
  }

  async addHistoryEntry(entry: Omit<TranslationHistoryEntry, 'timestamp'>): Promise<void> {
    return this.historyManager.addHistoryEntry(entry);
  }

  async deleteHistoryEntry(taskId: string): Promise<void> {
    return this.historyManager.deleteHistoryEntry(taskId);
  }

  async clearHistory(): Promise<void> {
    return this.historyManager.clearHistory();
  }

  // ===== 转录配置模块 (委托给 TranscriptionConfigManager) =====

  getTranscriptionConfig(): TranscriptionConfig | null {
    return this.transcriptionConfigManager.getTranscriptionConfig();
  }

  async saveTranscriptionConfig(config: TranscriptionConfig): Promise<void> {
    return this.transcriptionConfigManager.saveTranscriptionConfig(config);
  }

  // ===== 全局操作 =====

  /**
   * 清空所有数据
   */
  async clearAllData(): Promise<void> {
    try {
      // 只清空批处理任务的内存数据和持久化
      this.memoryStore.batch_tasks = { tasks: [] };

      // 只清空批处理任务的持久化存储
      await localforage.setItem('batch_tasks', { tasks: [] });
    } catch (error) {
      const appError = toAppError(error, '清空数据失败');
      console.error('[DataManager]', appError.message, appError);
      throw appError;
    }
  }

  /**
   * 获取数据统计信息
   */
  getDataStats(): {
    hasBatchTasks: boolean;
    termsCount: number;
    historyCount: number;
    isConfigured: boolean;
  } {
    return {
      hasBatchTasks: this.memoryStore.batch_tasks.tasks.length > 0,
      termsCount: this.memoryStore.terms_list.length,
      historyCount: this.memoryStore.translation_history.length,
      isConfigured: (this.memoryStore.translation_config.apiKey?.length || 0) > 0
    };
  }

  /**
   * 强制持久化所有数据
   * 用于特殊情况下的数据保存，如页面关闭前
   */
  async forcePersistAllData(): Promise<void> {
    try {
      const KEYS = {
        BATCH_TASKS: 'batch_tasks',
        TERMS: 'terms_list',
        CONFIG: 'translation_config',
        TRANSCRIPTION_CONFIG: 'transcription_config',
        HISTORY: 'translation_history'
      };

      await Promise.all([
        localforage.setItem(KEYS.BATCH_TASKS, this.memoryStore.batch_tasks),
        localforage.setItem(KEYS.TERMS, this.memoryStore.terms_list),
        localforage.setItem(KEYS.CONFIG, this.memoryStore.translation_config),
        localforage.setItem(KEYS.TRANSCRIPTION_CONFIG, this.memoryStore.transcription_config),
        localforage.setItem(KEYS.HISTORY, this.memoryStore.translation_history)
      ]);
    } catch (error) {
      const appError = toAppError(error, '强制持久化数据失败');
      console.error('[DataManager]', appError.message, appError);
      throw appError;
    }
  }

  // ===== 工具方法 =====

  /**
   * 生成任务ID
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// 创建单例实例
const dataManager = new DataManager();

export default dataManager;
