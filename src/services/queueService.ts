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

function isTaskCompleted(file: SubtitleFileMetadata): boolean {
  const isSrt = file.fileType === 'srt' || !file.fileType;
  return (
    file.phases.translating.status === 'completed' &&
    file.phases.splitting.status !== 'failed' &&
    (isSrt || file.phases.transcribing.status === 'completed')
  );
}

export function enqueueTask(fileId: string): void {
  const queue = useQueueStore.getState();
  if (queue.taskQueue.includes(fileId) || queue.activeTaskId === fileId) return;
  const file = useFilesStore.getState().getFile(fileId);
  if (!file) return;
  if (isTaskCompleted(file)) return;

  useQueueStore.getState().setTaskQueue([...queue.taskQueue, fileId]);
  if (useQueueStore.getState().activeTaskId === null) {
    // Defer to microtask so synchronous callers can observe the enqueued item
    // before processing starts and removes it from the head of the queue.
    queueMicrotask(() => {
      processNext().catch((err) => console.error('[queueService] processNext failed:', err));
    });
  }
}

export function dequeueTask(fileId: string): void {
  const queue = useQueueStore.getState();
  useQueueStore.getState().setTaskQueue(queue.taskQueue.filter((id) => id !== fileId));

  if (queue.activeTaskId === fileId) {
    useQueueStore.getState().setActiveTaskId(null);
    processNext().catch((err) => console.error('[queueService] processNext failed:', err));
  }
}

export function enqueueAllUncompleted(): void {
  const files = useFilesStore.getState().getAllFiles();
  for (const file of files) {
    if (!isTaskCompleted(file)) {
      enqueueTask(file.id);
    }
  }
}

export async function processNext(): Promise<void> {
  const queue = useQueueStore.getState();
  if (queue.taskQueue.length === 0) {
    useQueueStore.getState().setActiveTaskId(null);
    return;
  }

  const fileId = queue.taskQueue[0];
  useQueueStore.getState().setTaskQueue(queue.taskQueue.slice(1));
  useQueueStore.getState().setActiveTaskId(fileId);

  const file = useFilesStore.getState().getFile(fileId);
  if (!file) {
    processNext().catch((err) => console.error('[queueService] processNext failed:', err));
    return;
  }

  try {
    const isAudioVideo = file.fileType === 'audio' || file.fileType === 'video';
    const needsTranscription = isAudioVideo && file.phases.transcribing.status !== 'completed';

    if (needsTranscription) {
      useFilesStore.getState().setWorkflow(fileId, 'full');
      await startTranscription(fileId);

      const afterTranscribe = useFilesStore.getState().getFile(fileId);
      if (!afterTranscribe || afterTranscribe.phases.transcribing.status !== 'completed') {
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
  } catch (error) {
    console.error('[queueService] processNext task failed:', error);
  } finally {
    if (useQueueStore.getState().activeTaskId === fileId) {
      useQueueStore.getState().setActiveTaskId(null);
      processNext().catch((err) => console.error('[queueService] processNext failed:', err));
    }
  }
}
