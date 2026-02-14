// 导入 SubtitleEntry 类型以避免循环依赖
import type { SubtitleEntry } from './index';

// 热词分组
export interface KeytermGroup {
  id: string;
  name: string;
  keyterms: string[];
}

// 文件类型
export type FileType = 'srt' | 'audio' | 'video';

// 转录状态（极简流程）
export type TranscriptionStatus =
  | 'idle'          // 未开始
  | 'converting'    // 转码中
  | 'uploading'     // 上传音频中
  | 'transcribing'  // API 转录中
  | 'completed'     // 已完成
  | 'failed';       // 失败

// 转录进度详情（极简版）
export interface TranscriptionProgressDetail {
  status: TranscriptionStatus;
  currentChunk?: number;    // 当前处理块（如适用）
  totalChunks?: number;     // 总块数（如适用）
}


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

// 转录进度详情（百分比形式）
export interface TranscriptionProgressInfo {
  percent: number;           // 总体进度百分比
  currentChunk?: number;     // 当前处理块（如适用）
  totalChunks?: number;      // 总块数（如适用）
  tokens?: number;           // Token 使用量（如适用）
}

/**
 * 字幕文件元数据（轻量级，用于 subtitleStore）
 * 不包含完整的 entries 数组，仅存储统计信息和状态
 */
export interface SubtitleFileMetadata {
  id: string;
  taskId: string;                      // 链接到 DataManager 的 taskId
  name: string;
  fileType: 'srt' | 'audio-video';
  fileSize: number;
  lastModified: number;
  duration?: number;

  // 缓存的统计信息（从 DataManager 计算后缓存）
  entryCount: number;                  // 字幕条目总数
  translatedCount: number;             // 已翻译数量

  // 转录状态和进度
  transcriptionStatus: TranscriptionStatus;
  transcriptionProgress?: TranscriptionProgressInfo;

  // 全局 tokens（转录 + 翻译）
  tokensUsed: number;
}

/**
 * 字幕文件类型（用于文件管理，包含完整数据）
 * @deprecated DataManager 层使用 SingleTask，Store 层使用 SubtitleFileMetadata
 */
export interface SubtitleFile {
  id: string;
  name: string;
  size: number;                       // Legacy: File size in bytes - use fileSize in new code
  lastModified: number;
  entries: SubtitleEntry[];
  filename: string;
  currentTaskId: string;
  taskId?: string;                    // 兼容 SubtitleFileMetadata
  type?: FileType;                    // Legacy: 'srt' | 'audio' | 'video' - TODO: migrate to fileType
  fileType?: 'srt' | 'audio-video';   // Unified type: use this field in new code
  fileSize?: number;                  // Unified size (bytes): use this field in new code
  fileRef?: File;                     // 原始文件引用（用于音视频转录）
  duration?: number;                  // 音视频时长（秒）
  transcriptionStatus?: TranscriptionStatus;
  transcriptionProgress?: TranscriptionProgressInfo;

  // 渐进式迁移：添加缓存的统计信息（Phase 2）
  // Phase 3 会移除 entries 数组，只保留这些统计信息
  entryCount?: number;                // 字幕条目总数（缓存）
  translatedCount?: number;           // 已翻译数量（缓存）
  tokensUsed?: number;                // Token 使用量（缓存）
}
