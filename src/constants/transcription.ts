/**
 * 转录相关常量
 */

/**
 * 音频处理常量
 */
export const AUDIO_CONSTANTS = {
  /** 采样率 */
  SAMPLE_RATE: 16000,

  /** 帧步长 */
  FRAME_STRIDE: 1,
} as const;

/**
 * 转录进度常量
 */
export const TRANSCRIPTION_PROGRESS_CONSTANTS = {
  /** 进度下载上限 */
  DOWNLOAD_CAP: 90,

  /** 最小静音时长（毫秒） */
  MIN_SILENCE_MS: 500,

  /** 默认分片时长（秒） */
  DEFAULT_CHUNK_DURATION: 30,
} as const;

/**
 * 静音检测常量
 */
export const SILENCE_DETECTION_CONSTANTS = {
  /** 分析窗口大小（秒） */
  ANALYSIS_WINDOW_SIZE: 0.01,

  /** 最小静音持续时间（秒） */
  MIN_SILENCE_DURATION: 0.4,

  /** 静音阈值比例 */
  SILENCE_THRESHOLD_RATIO: 0.15,

  /** 分片时长（秒） */
  CHUNK_DURATION: 60,

  /** 静音点搜索窗口（秒） */
  SEARCH_WINDOW: 20,
} as const;

/**
 * 转录批次处理常量
 */
export const TRANSCRIPTION_BATCH_CONSTANTS = {
  /** 停顿阈值（秒） */
  PAUSE_THRESHOLD: 1.0,

  /** 极短片段词数上限 */
  VERY_SHORT_WORD_COUNT: 2,

  /** 完整句子词数上限 */
  COMPLETE_SENTENCE_WORD_COUNT: 20,

  /** 短片段词数上限 */
  SHORT_WORD_COUNT: 10,

  /** 默认批次大小 */
  DEFAULT_BATCH_SIZE: 100,

  /** LLM 句子分割最大词数 */
  LLM_MAX_WORDS: 20,
} as const;

/**
 * 转录进度常量
 */
export const TRANSCRIPTION_PROGRESS = {
  /** 短音频转录进度起始百分比 */
  SHORT_AUDIO_PROGRESS: 20,

  /** 长音频转录进度起始百分比 */
  LONG_AUDIO_PROGRESS_START: 10,

  /** 长音频转录进度范围 */
  LONG_AUDIO_PROGRESS_RANGE: 40,

  /** LLM 合并进度起始百分比 */
  LLM_PROGRESS_START: 50,

  /** LLM 合并进度范围 */
  LLM_PROGRESS_RANGE: 50,
} as const;

/**
 * ID 生成常量
 */
export const ID_GENERATION_CONSTANTS = {
  /** 任务 ID 前缀 */
  TASK_PREFIX: 'task_',

  /** 文件 ID 前缀 */
  FILE_PREFIX: 'file_',

  /** 随机字符串长度 */
  RANDOM_LENGTH: 9,
} as const;

/**
 * WebGPU 常量
 */
export const WEBGPU_CONSTANTS = {
  /** 释放模型后的延迟（毫秒），确保 WebGPU 完成所有待处理的释放操作 */
  RELEASE_DELAY_MS: 100,
} as const;
