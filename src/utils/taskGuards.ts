/**
 * 任务启动前的配置守卫（纯函数，不依赖 onboarding UI）
 */

import type { FilePhases } from '@/types';

type StartIntent = 'translate' | 'full' | 'transcribe' | 'batch';
type SetupGuardKind = 'translation' | 'transcription';

type TranscriptionWorkFile = {
  fileType?: string;
  entryCount?: number;
  phases: FilePhases;
};

/**
 * 音视频是否还要跑识别 / 断句（含续跑）。
 *
 * 识别已完成但一条字幕都没有时，只要还有可续跑的凭据（云端 transcript.id 或
 * 本地词表）就要放行：这是「重新断句」唯一的入口——重新跑不用重新上传音频，
 * 直接吃检查点里的词表。两个凭据都没有（空音频 / 旧数据）才视为完成，
 * 避免用户点了没反应。
 */
export function needsTranscriptionWork(file: TranscriptionWorkFile): boolean {
  const isAv = file.fileType === 'audio' || file.fileType === 'video';
  if (!isAv) return false;
  const tr = file.phases.transcribing;
  if (!tr || tr.status !== 'completed') return true;
  if ((file.entryCount ?? 0) > 0) return false;
  return Boolean(tr.transcriptId || tr.asrReady);
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
