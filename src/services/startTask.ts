/**
 * 统一「开始任务」入口：
 * - 翻译相关 intent 未配置 LLM → 翻译 SetupGuard
 * - 转录 / 转译 未配置 AssemblyAI → 转录 SetupGuard
 * UI 一律经此模块，避免只挡某一个按钮。
 */

import { useFilesStore } from '@/stores/filesStore';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { enqueueTask, enqueueAllUncompleted } from '@/services/queueService';
import {
  resolveFullPathGuard,
  shouldGuardTranscriptionStart,
  shouldGuardTranslationStart,
} from '@/utils/onboarding';
import type { SubtitleFileMetadata } from '@/types';

function openGuard(kind: 'translation' | 'transcription'): false {
  useOnboardingStore.getState().openSetupGuard(kind);
  return false;
}

export function startTranslateTask(fileId: string): boolean {
  const isConfigured = useTranslationConfigStore.getState().isConfigured;
  if (shouldGuardTranslationStart(isConfigured, 'translate')) {
    return openGuard('translation');
  }
  useFilesStore.getState().setWorkflow(fileId, 'translate');
  enqueueTask(fileId);
  return true;
}

export function startFullTask(fileId: string): boolean {
  const guard = resolveFullPathGuard({
    isTranslationConfigured: useTranslationConfigStore.getState().isConfigured,
    transcriptionApiKeys: useTranscriptionStore.getState().apiKeys,
  });
  if (guard) return openGuard(guard);

  useFilesStore.getState().setWorkflow(fileId, 'full');
  enqueueTask(fileId);
  return true;
}

export function startTranscribeTask(fileId: string): boolean {
  const apiKeys = useTranscriptionStore.getState().apiKeys;
  if (shouldGuardTranscriptionStart(apiKeys, 'transcribe')) {
    return openGuard('transcription');
  }
  useFilesStore.getState().setWorkflow(fileId, 'transcribe');
  enqueueTask(fileId);
  return true;
}

/**
 * 全部开始：若队列里存在需要翻译的任务且未配置翻译 → 守卫；
 * 若存在音视频且未转录完且未配置转录 → 守卫。
 */
export function startAllUncompleted(): boolean {
  const files = useFilesStore.getState().getAllFiles();
  const isTranslationConfigured = useTranslationConfigStore.getState().isConfigured;
  const apiKeys = useTranscriptionStore.getState().apiKeys;

  const needsTranscription = files.some((f) => {
    const isAv = f.fileType === 'audio' || f.fileType === 'video';
    if (!isAv) return false;
    if (f.phases.transcribing.status === 'completed') return false;
    // 未完成的音视频会走 transcribe 或 full
    return true;
  });

  if (needsTranscription && shouldGuardTranscriptionStart(apiKeys, 'transcribe')) {
    return openGuard('transcription');
  }

  const needsTranslation = files.some((f) => {
    if (f.phases.translating.status === 'completed') return false;
    const isAv = f.fileType === 'audio' || f.fileType === 'video';
    // 纯转录完成且用户只转写的情况较少见；batch 默认仍会尝试翻译未完成项
    if (isAv && f.phases.transcribing.status !== 'completed') {
      // full 路径也需要翻译配置
      return true;
    }
    return f.fileType === 'srt' || !f.fileType || f.phases.transcribing.status === 'completed';
  });

  if (needsTranslation && shouldGuardTranslationStart(isTranslationConfigured, 'batch')) {
    return openGuard('translation');
  }

  enqueueAllUncompleted();
  return true;
}

/**
 * 移动端主按钮：音视频未转录完走 full，否则 translate
 */
export function startPrimaryForFile(file: SubtitleFileMetadata): boolean {
  const isAv = file.fileType === 'audio' || file.fileType === 'video';
  const transcribed = file.phases.transcribing.status === 'completed';
  if (isAv && !transcribed) return startFullTask(file.id);
  return startTranslateTask(file.id);
}
