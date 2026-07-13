// 翻译状态类型
export type TranslationStatus = 'pending' | 'completed';

// 文件类型（从 transcription.ts 导入并导出）
import type { FileType } from './transcription';
export type { FileType };

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

// LLM API 基础配置类型（调用时用）
export interface LLMConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  rpm?: number;
}

/** 一套可切换的 LLM 接口档案 */
export interface LlmProfile {
  id: string;
  /** 展示名，如 Agnes / 公司中转 */
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  /** 来自哪个厂商预设（仅用于图标/匹配，可选） */
  presetId?: string;
  /** 是否必须填写 API Key */
  requiresKey?: boolean;
}

// 翻译配置：多套 LLM 档案 + 全局翻译参数
export interface TranslationConfig {
  profiles: LlmProfile[];
  activeProfileId: string;
  sourceLanguage: string;
  targetLanguage: string;
  contextBefore: number;
  contextAfter: number;
  batchSize: number;
  threadCount: number;
  rpm?: number;
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

// 单个翻译任务状态类型 (用于批处理任务列表)
export interface SingleTask {
  taskId: string;
  subtitle_entries: SubtitleEntry[];
  subtitle_filename: string;

  // REPLACED: translation_progress → phases.translating
  phases: FilePhases;  // all 4 phase states

  index: number; // 在列表中的位置

  fileType?: FileType;   // Unified file type
  fileSize?: number;                  // File size in bytes
  duration?: number;                  // Audio duration in seconds
  fileRef?: File;                     // 音视频原始文件引用（不持久化）

  /** 该文件要使用的热词分组 ID；null 表示不使用热词 */
  selectedKeytermGroupId: string | null;

  /** 派生状态缓存：避免每次 updateEntry 触发整数组 O(n) filter */
  entryCount: number;
  translatedCount: number;
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
  language?: string;       // 语音识别检测到的语言，如 'en', 'zh'
  errorMessage?: string;   // 失败时的错误信息
  entryCount?: number;    // 该阶段处理的条目数（语音识别/翻译/断句）
  totalEntries?: number;  // 总条目数
  keytermGroupName?: string; // 该阶段使用的热词分组名（仅转录/翻译时记录）
}

// ProgressPhase: 阶段名称类型
export type ProgressPhase = 'converting' | 'transcribing' | 'translating';

// ALL_PHASES: 所有阶段列表
export const ALL_PHASES: ProgressPhase[] = ['converting', 'transcribing', 'translating'];

// FilePhases: 工作流类型
export type WorkflowType = 'transcribe' | 'translate' | 'full';

export interface FilePhases {
  workflow: WorkflowType;  // 工作流类型
  converting: PhaseProgress;
  transcribing: PhaseProgress;
  translating: PhaseProgress;
}

// 导出转录相关类型
export * from './transcription';
