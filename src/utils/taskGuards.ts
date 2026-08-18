/**
 * 任务启动前的配置守卫（纯函数，不依赖 onboarding UI）
 */

import type { FilePhases } from '@/types';

type StartIntent = 'translate' | 'full' | 'transcribe' | 'batch';
type SetupGuardKind = 'translation' | 'transcription';

type TranscriptionWorkFile = {
  fileType?: string;
  aiSegmentationEnabled?: boolean;
  entryCount?: number;
  phases: FilePhases;
};

/**
 * 音视频是否还要跑识别 / 断句（含续跑）。
 * 识别已 completed 且没有字幕、但有 transcript.id 或本地词表时，仍要再进管线。
 */
export function needsTranscriptionWork(file: TranscriptionWorkFile): boolean {
  const isAv = file.fileType === 'audio' || file.fileType === 'video';
  if (!isAv) return false;
  const tr = file.phases.transcribing;
  if (!tr || tr.status !== 'completed') return true;
  if ((file.entryCount ?? 0) > 0) return false;
  // 识别已完成、没有字幕：
  // - 词表已在本地但 AI 断句未完成 → 只续断句
  // - 只有 transcript.id、词表还没落地 → 继续 poll
  // - 空音频（asrReady 且无词）或旧数据 → 视为完成，避免死循环
  const segmenting = file.phases.segmenting;
  if (
    file.aiSegmentationEnabled &&
    segmenting &&
    segmenting.status !== 'completed'
  ) {
    return Boolean(tr.asrReady || tr.transcriptId);
  }
  return Boolean(tr.transcriptId && !tr.asrReady);
}

/** AssemblyAI Key 是否已配置 */
export function isTranscriptionApiConfigured(apiKeys: string | null | undefined): boolean {
  return Boolean(String(apiKeys ?? '').trim());
}

/** 未配置翻译 API 时，翻译相关启动应拦截（纯转录除外） */
export function shouldGuardTranslationStart(
  isConfigured: boolean,
  intent: StartIntent = 'translate'
): boolean {
  if (intent === 'transcribe') return false;
  return isConfigured !== true;
}

/** 未配置 AssemblyAI 时，转录 / 转译应拦截 */
export function shouldGuardTranscriptionStart(
  apiKeys: string | null | undefined,
  intent: StartIntent = 'transcribe'
): boolean {
  if (intent === 'translate') return false;
  if (intent === 'batch') return false;
  return !isTranscriptionApiConfigured(apiKeys);
}

/** full 路径：先转录 Key，再翻译 API */
export function resolveFullPathGuard(input: {
  isTranslationConfigured: boolean;
  transcriptionApiKeys: string | null | undefined;
}): SetupGuardKind | null {
  if (shouldGuardTranscriptionStart(input.transcriptionApiKeys, 'full')) {
    return 'transcription';
  }
  if (shouldGuardTranslationStart(input.isTranslationConfigured, 'full')) {
    return 'translation';
  }
  return null;
}

/** 常见媒体扩展（辅助识别；真正转码不依赖白名单） */
const MEDIA_EXT =
  /\.(mp3|wav|m4a|aac|ogg|flac|opus|wma|mp4|m4v|webm|mkv|avi|mov|wmv|flv|ts|mts|m2ts|3gp|mpeg|mpg|vob|rmvb|rm)$/i;

/** 是否为音视频导入（非 SRT） */
export function isMediaImportFileName(name: string): boolean {
  const n = name || '';
  if (/\.srt$/i.test(n)) return false;
  return MEDIA_EXT.test(n);
}
