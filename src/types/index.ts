// 翻译状态类型
export type TranslationStatus = 'pending' | 'completed';

// 文件类型（从 transcription.ts 导出）
export type { FileType } from './transcription';

// 单词级时间戳
export interface SubtitleWord {
  text: string;
  start: number; // 秒
  end: number;   // 秒
}

// 字幕条目类型
export interface SubtitleEntry {
  id: number;
  startTime: string;
  endTime: string;
  text: string;
  translatedText: string;
  translationStatus: TranslationStatus;
  words?: SubtitleWord[];  // 单词级时间戳（转录产生，SRT 导入为空）
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
  phase: 'direct' | 'splitting' | 'completed';
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

  // REPLACED: translation_progress → phases.translating
  phases: FilePhases;  // all 4 phase states

  index: number; // 在列表中的位置

  // Legacy file size (for backward compatibility with SubtitleFile)
  size?: number;  // Legacy: File size in bytes - use fileSize in new code

  // NEW: Audio-video transcription cache fields
  fileType?: FileType;   // Unified file type
  fileSize?: number;                  // File size in bytes
  duration?: number;                  // Audio duration in seconds
}

// 批量任务列表类型
export interface BatchTasks {
  tasks: SingleTask[];
}

// 翻译历史记录
export interface TranslationHistoryEntry {
  taskId: string;
  filename: string;
  completedCount: number;
  totalTokens: number;
  timestamp: number;
  // phases 直接内联，避免冗余嵌套
  phases: FilePhases;
  subtitle_entries: SubtitleEntry[];
}

// ============================================
// PhaseProgress: 新结构（current/total）
// 用于 Task 3 迁移，暂与旧结构共存
// ============================================

// PhaseProgress: 阶段进度数据结构
// 与 src/types/progress.ts 的 PhaseState 保持一致
export interface PhaseProgress {
  status: 'upcoming' | 'active' | 'completed' | 'failed';
  progress: number;  // 0-100, -1 = indeterminate
  tokens: number;
}

// ProgressPhase: 阶段名称类型
export type ProgressPhase = 'converting' | 'transcribing' | 'translating' | 'splitting';

// ALL_PHASES: 所有阶段列表
export const ALL_PHASES: ProgressPhase[] = ['converting', 'transcribing', 'translating', 'splitting'];

// FilePhases: 工作流类型
export type WorkflowType = 'transcribe' | 'translate' | 'full';

export interface FilePhases {
  workflow: WorkflowType;  // 工作流类型
  converting: PhaseProgress;
  transcribing: PhaseProgress;
  translating: PhaseProgress;
  splitting: PhaseProgress;
}

// 导出转录相关类型
export * from './transcription';
