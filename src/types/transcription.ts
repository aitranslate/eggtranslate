// 导入 SubtitleEntry 类型以避免循环依赖
import type { SubtitleEntry } from './index';
import type { FilePhases } from './index';

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

// 转录结果
export interface TranscriptionResult {
  utterance_text: string;
  words: TranscriptionWord[];
  confidence_scores?: {
    overall_log_prob: number;
    word_avg: number;
  };
  metrics?: {
    rtf: number;
    total_ms: number;
  };
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

  // 音视频原始文件引用（不持久化，仅内存）
  fileRef?: File;
}

// 断句模式
export type SegmentationMode = 'transcribe' | 'transcribe_translate';

// 字幕长度预设
export type SubtitleLengthPreset = 'short' | 'standard' | 'loose';

// 单词 token（规范化后）
export interface NormalizedWordToken {
  text: string;
  start: number; // 秒
  end: number;   // 秒
}

// 语义断句结果
export interface SemanticSegment {
  text: string;
  start: number; // 秒
  end: number;   // 秒
  wordStart: number; // 起始词索引
  wordEnd: number;   // 结束词索引
}

// LLM 拆分结果
export interface LLMSourceSplitResult {
  sourceParts: string[];
}

// LLM 对齐结果
export interface LLMAlignResult {
  translations: { id: number; text: string }[];
}
