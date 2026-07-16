import type { AgentRunSnapshot, FilePhases, TranslationPath } from './index';

// 热词分组
export interface KeytermGroup {
  id: string;
  name: string;
  keyterms: string[];
}

// 文件类型
export type FileType = 'srt' | 'audio' | 'video';

// 转录单词（AssemblyAI 输出）
export interface TranscriptionWord {
  text: string;
  start: number;           // 毫秒
  end: number;             // 毫秒
  confidence: number;
}

// AssemblyAI Sentence 类型（极简流程使用）
export interface AssemblyAISentence {
  text: string;
  start: number;           // 毫秒
  end: number;             // 毫秒
  confidence?: number;
  words?: TranscriptionWord[];  // 可选的单词级别时间戳
}

/**
 * 字幕文件元数据（轻量级，用于 subtitleStore）
 * 不包含完整的 entries 数组，仅存储统计信息和状态
 */
export interface SubtitleFileMetadata {
  id: string;
  taskId: string;                      // 链接到 DataManager 的 taskId
  name: string;
  fileType: FileType;
  fileSize: number;
  lastModified: number;
  duration?: number;

  // 缓存的统计信息（从 DataManager 计算后缓存）
  entryCount: number;                  // 字幕条目总数
  translatedCount: number;             // 已翻译数量

  // 阶段状态（唯一的进度数据源）
  phases: FilePhases;

  // 全局 tokens（转录 + 翻译）
  tokensUsed: number;

  // entries 数据版本号（DataManager entries 变更时递增，用于触发 UI 刷新）
  entriesVersion: number;

  /** 该文件要使用的热词分组 ID；null 表示不使用热词 */
  selectedKeytermGroupId: string | null;

  /** 最近一次翻译路径（agent / batch），与设置开关解耦 */
  translationPath?: TranslationPath;
  /** Agent 终态快照（持久化在任务上） */
  agentSnapshot?: AgentRunSnapshot | null;

  // 音视频原始文件引用（不持久化，仅内存）
  fileRef?: File;
}

// 字幕长度预设
export type SubtitleLengthPreset = 'short' | 'standard' | 'loose';
