/**
 * 统一「开始任务」入口：
 * - 未配置 API 时 toast 提示并打开设置
 * - 不依赖新手引导 / SetupGuard
 */

import toast from 'react-hot-toast';
import { useFilesStore } from '@/stores/filesStore';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { enqueueTask, enqueueAllUncompleted } from '@/services/queueService';
import {
  resolveFullPathGuard,
  shouldGuardTranscriptionStart,
  shouldGuardTranslationStart,
} from '@/utils/taskGuards';
import type { SubtitleFileMetadata } from '@/types';

function openTranslationSetup(): false {
  toast.error('请先配置翻译 API');
  useWorkspaceStore.getState().openSettings('translation');
  return false;
}

function openTranscriptionSetup(): false {
  toast.error('请先配置转录 API（AssemblyAI）');
  useWorkspaceStore.getState().openSettings('transcription');
  return false;
}

export function startTranslateTask(fileId: string): boolean {
  const isConfigured = useTranslationConfigStore.getState().isConfigured;
  if (shouldGuardTranslationStart(isConfigured, 'translate')) {
    return openTranslationSetup();
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
  if (guard === 'transcription') return openTranscriptionSetup();
  if (guard === 'translation') return openTranslationSetup();

  useFilesStore.getState().setWorkflow(fileId, 'full');
  enqueueTask(fileId);
  return true;
}

export function startTranscribeTask(fileId: string): boolean {
  const apiKeys = useTranscriptionStore.getState().apiKeys;
  if (shouldGuardTranscriptionStart(apiKeys, 'transcribe')) {
    return openTranscriptionSetup();
  }
  useFilesStore.getState().setWorkflow(fileId, 'transcribe');
  enqueueTask(fileId);
  return true;
}

/**
 * 全部开始：缺配置则 toast + 打开设置
 */
export function startAllUncompleted(): boolean {
  const files = useFilesStore.getState().getAllFiles();
  const isTranslationConfigured = useTranslationConfigStore.getState().isConfigured;
  const apiKeys = useTranscriptionStore.getState().apiKeys;

  const needsTranscription = files.some((f) => {
    const isAv = f.fileType === 'audio' || f.fileType === 'video';
    if (!isAv) return false;
    if (f.phases.transcribing.status === 'completed') return false;
    return true;
  });

  if (needsTranscription && shouldGuardTranscriptionStart(apiKeys, 'transcribe')) {
    return openTranscriptionSetup();
  }

  const needsTranslation = files.some((f) => {
    if (f.phases.translating.status === 'completed') return false;
    const isAv = f.fileType === 'audio' || f.fileType === 'video';
    if (isAv && f.phases.transcribing.status !== 'completed') {
      return true;
    }
    return f.fileType === 'srt' || !f.fileType || f.phases.transcribing.status === 'completed';
  });

  if (needsTranslation && shouldGuardTranslationStart(isTranslationConfigured, 'batch')) {
    return openTranslationSetup();
  }

  enqueueAllUncompleted();
  return true;
}

/** 移动端主按钮：音视频未转录完走 full，否则 translate */
export function startPrimaryForFile(file: SubtitleFileMetadata): boolean {
  const isAv = file.fileType === 'audio' || file.fileType === 'video';
  const transcribed = file.phases.transcribing.status === 'completed';
  if (isAv && !transcribed) return startFullTask(file.id);
  return startTranslateTask(file.id);
}
