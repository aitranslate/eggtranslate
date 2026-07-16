/**
 * 任务启动前的配置守卫（纯函数，不依赖 onboarding UI）
 */

export type StartIntent = 'translate' | 'full' | 'transcribe' | 'batch';
export type SetupGuardKind = 'translation' | 'transcription';

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

const MEDIA_EXT = /\.(mp3|wav|m4a|ogg|flac|mp4|webm|mkv|avi|mov)$/i;

/** 是否为音视频导入（非 SRT） */
export function isMediaImportFileName(name: string): boolean {
  return MEDIA_EXT.test(name || '');
}
