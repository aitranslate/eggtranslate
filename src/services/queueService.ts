/**
 * 队列 Service
 * 管理任务队列和 processNext 调度逻辑
 */

import { useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { useHistoryStore } from '@/stores/historyStore';
import { startTranscription } from './transcriptionService';
import { startTranslation } from './translationService';
import { saveTranslationHistory } from './TranslationOrchestrator';
import type { SubtitleFileMetadata } from '@/types';
import { logger } from '@/utils/logger';
import { playAppSound } from '@/utils/appSound';

function isTaskCompleted(file: SubtitleFileMetadata): boolean {
  const isSrt = file.fileType === 'srt' || !file.fileType;
  return (
    file.phases.translating.status === 'completed' &&
    (isSrt || file.phases.transcribing.status === 'completed')
  );
}

/**
 * 根据 runTask 结束后的 phase 状态播放结果音（完成 / 失败各一种）。
 * 配置缺失等「未真正开跑」的情况不发声。
 */
function notifyTaskOutcome(fileId: string): void {
  const file = useFilesStore.getState().getFile(fileId);
  if (!file) return;

  const { workflow, transcribing, translating } = file.phases;

  if (transcribing.status === 'failed' || translating.status === 'failed') {
    playAppSound('error');
    return;
  }

  if (workflow === 'transcribe') {
    if (transcribing.status === 'completed') playAppSound('success');
    return;
  }

  // translate / full：以翻译完成作为任务终点
  if (translating.status === 'completed') {
    playAppSound('success');
  }
}

let isProcessNextScheduled = false;

export function enqueueTask(fileId: string): void {
  const queue = useQueueStore.getState();
  if (queue.taskQueue.includes(fileId) || queue.activeTaskId === fileId) return;
  const file = useFilesStore.getState().getFile(fileId);
  if (!file) return;
  if (isTaskCompleted(file)) return;

  useQueueStore.getState().setTaskQueue([...queue.taskQueue, fileId]);
  // 开始 / 全部开始：真正入队时轻确认（批量入队由 confirm 去抖压成一声）
  playAppSound('confirm');
  if (useQueueStore.getState().activeTaskId === null && !isProcessNextScheduled) {
    isProcessNextScheduled = true;
    // Defer to microtask so synchronous callers can observe the enqueued item
    // before processing starts and removes it from the head of the queue.
    queueMicrotask(() => {
      processNext()
        .catch((err) => logger.error('processNext failed:', err))
        .finally(() => { isProcessNextScheduled = false; });
    });
  }
}

export function dequeueTask(fileId: string): void {
  const queue = useQueueStore.getState();
  useQueueStore.getState().setTaskQueue(queue.taskQueue.filter((id) => id !== fileId));

  if (queue.activeTaskId === fileId) {
    useQueueStore.getState().setActiveTaskId(null);
    processNext().catch((err) => logger.error('processNext failed:', err));
  }
}

export function enqueueAllUncompleted(): void {
  const files = useFilesStore.getState().getAllFiles();
  for (const file of files) {
    if (isTaskCompleted(file)) continue;

    const isAudioVideo = file.fileType === 'audio' || file.fileType === 'video';
    const needsTranscription = isAudioVideo && file.phases.transcribing.status !== 'completed';

    // 音视频未转录 → 转录+翻译全流程；已转录 / SRT → 仅翻译
    useFilesStore
      .getState()
      .setWorkflow(file.id, needsTranscription ? 'full' : 'translate');

    enqueueTask(file.id);
  }
}

export async function processNext(): Promise<void> {
  const fileId = await startTask();
  if (!fileId) return;
  try {
    const file = useFilesStore.getState().getFile(fileId);
    if (file) await runTask(file);
    notifyTaskOutcome(fileId);
  } catch (error) {
    logger.error('processNext task failed:', error);
    playAppSound('error');
  } finally {
    await finishTask(fileId);
  }
}

async function startTask(): Promise<string | null> {
  const queue = useQueueStore.getState();
  if (queue.taskQueue.length === 0) {
    useQueueStore.getState().setActiveTaskId(null);
    return null;
  }
  const fileId = queue.taskQueue[0];
  useQueueStore.getState().setTaskQueue(queue.taskQueue.slice(1));
  useQueueStore.getState().setActiveTaskId(fileId);
  return fileId;
}

async function runTask(file: SubtitleFileMetadata): Promise<void> {
  const fileId = file.id;
  const isAudioVideo = file.fileType === 'audio' || file.fileType === 'video';
  const needsTranscription = isAudioVideo && file.phases.transcribing.status !== 'completed';

  if (needsTranscription) {
    // workflow 由按钮在 enqueueTask 前设置，runTask 据此决定是否继续翻译
    await startTranscription(fileId);

    const afterTranscribe = useFilesStore.getState().getFile(fileId);
    if (!afterTranscribe || afterTranscribe.phases.transcribing.status !== 'completed') {
      return;
    }
    // 仅转录：转录完成即结束，不继续翻译
    if (afterTranscribe.phases.workflow === 'transcribe') {
      return;
    }
  }

  if (file.fileType === 'srt') {
    useFilesStore.getState().setWorkflow(fileId, 'translate');
  }
  const result = await startTranslation(fileId);
  if (result) {
    await saveTranslationHistory(
      file.taskId,
      file.name,
      result.tokens,
      useHistoryStore.getState().addHistory
    );
  }
}

async function finishTask(fileId: string): Promise<void> {
  if (useQueueStore.getState().activeTaskId === fileId) {
    useQueueStore.getState().setActiveTaskId(null);
    await processNext();
  }
}
