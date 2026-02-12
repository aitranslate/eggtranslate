// 翻译状态类型
export type TranslationStatus = 'pending' | 'completed';

// 字幕条目类型
export interface SubtitleEntry {
  id: number;
  startTime: string;
  endTime: string;
  text: string;
  translatedText: string;
  translationStatus: TranslationStatus;
}

// LLM API 基础配置类型
export interface LLMConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  rpm?: number;
}

// 翻译配置类型（继承 LLM 基础配置）
export interface TranslationConfig extends LLMConfig {
  sourceLanguage: string;
  targetLanguage: string;
  contextBefore: number;
  contextAfter: number;
  batchSize: number;
  threadCount: number;
}

// 翻译进度类型
export interface TranslationProgress {
  current: number;
  total: number;
  phase: 'direct' | 'completed';
  status: string;
  taskId?: string; // 当前任务ID
}

// 术语类型
export interface Term {
  original: string;
  translation: string;
  notes?: string;  // 新增：可选的说明字段
}

// 翻译任务状态类型
export interface TranslationTask {
  taskId: string;
  filename: string;
  status: 'preparing' | 'translating' | 'completed' | 'failed';
  progress: TranslationProgress;
  createdAt: string;
  lastUpdated: string;
}

// 单个翻译任务状态类型 (用于批处理任务列表)
export interface SingleTask {
  taskId: string;
  subtitle_entries: SubtitleEntry[];
  subtitle_filename: string;
  translation_progress: {
    completed: number;
    total: number;
    tokens: number;
    status: 'idle' | 'translating' | 'completed';
    current_index?: number;
  };
  index: number; // 在列表中的位置

  // Legacy file size (for backward compatibility with SubtitleFile)
  size?: number;  // Legacy: File size in bytes - use fileSize in new code

  // NEW: Audio-video transcription cache fields
  fileType?: 'srt' | 'audio-video';   // Unified file type
  fileSize?: number;                  // File size in bytes
  duration?: number;                  // Audio duration in seconds
}

// 批量任务列表类型
export interface BatchTasks {
  tasks: SingleTask[];
}

// 当前翻译任务状态类型
export interface CurrentTranslationTask {
  taskId: string;
  subtitle_entries: SubtitleEntry[];
  subtitle_filename: string;
  translation_progress: {
    completed: number;
    total: number;
    tokens: number;
    status: 'idle' | 'translating' | 'completed';
    current_index?: number;
  };
}

// 增强的翻译历史记录类型
export interface TranslationHistoryEntry {
  taskId: string; // 唯一标识符
  filename: string;
  completedCount: number; // 完成的字幕数
  totalTokens: number; // 总消耗Token数
  timestamp: number; // 完成时间戳
  current_translation_task: CurrentTranslationTask; // 保存完整任务数据
}

// 导出转录相关类型
export * from './transcription';
