/**
 * 队列 Service
 * 管理任务队列和 processNext 调度逻辑
 *
 * 默认接线全局 store / 兄弟 service；可通过 setQueueServiceDeps 注入（测试用）。
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

export type QueueServiceDeps = {
  getFile: (fileId: string) => SubtitleFileMetadata | undefined;
  getAllFiles: () => SubtitleFileMetadata[];
  setWorkflow: (fileId: string, workflow: SubtitleFileMetadata['phases']['workflow']) => void;
  getTaskQueue: () => string[];
  setTaskQueue: (queue: string[]) => void;
  getActiveTaskId: () => string | null;
  setActiveTaskId: (id: string | null) => void;
  startTranscription: (fileId: string) => Promise<void>;
  startTranslation: (fileId: string) => ReturnType<typeof startTranslation>;
  addHistory: (entry: Parameters<ReturnType<typeof useHistoryStore.getState>['addHistory']>[0]) => Promise<void>;
  playSound: typeof playAppSound;
};

function createDefaultQueueDeps(): QueueServiceDeps {
  return {
    getFile: (fileId) => useFilesStore.getState().getFile(fileId),
    getAllFiles: () => useFilesStore.getState().getAllFiles(),
    setWorkflow: (fileId, workflow) => useFilesStore.getState().setWorkflow(fileId, workflow),
    getTaskQueue: () => useQueueStore.getState().taskQueue,
    setTaskQueue: (queue) => useQueueStore.getState().setTaskQueue(queue),
    getActiveTaskId: () => useQueueStore.getState().activeTaskId,
    setActiveTaskId: (id) => useQueueStore.getState().setActiveTaskId(id),
    startTranscription,
    startTranslation,
    addHistory: (entry) => useHistoryStore.getState().addHistory(entry),
    playSound: playAppSound,
  };
}

/** 模块级可覆盖 deps（测试 beforeEach 注入 / afterEach 重置） */
let queueDeps: QueueServiceDeps = createDefaultQueueDeps();

/** 合并到当前 deps（可链式 partial）；测完请 resetQueueServiceDeps */
export function setQueueServiceDeps(partial: Partial<QueueServiceDeps>): void {
  queueDeps = { ...queueDeps, ...partial };
}

export function resetQueueServiceDeps(): void {
  queueDeps = createDefaultQueueDeps();
}

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
  const file = queueDeps.getFile(fileId);
  if (!file) return;

  const { workflow, transcribing, translating } = file.phases;

  if (transcribing.status === 'failed' || translating.status === 'failed') {
    queueDeps.playSound('error');
    return;
  }

  if (workflow === 'transcribe') {
    if (transcribing.status === 'completed') queueDeps.playSound('success');
    return;
  }

  // translate / full：以翻译完成作为任务终点
  if (translating.status === 'completed') {
    queueDeps.playSound('success');
  }
}

let isProcessNextScheduled = false;

export function enqueueTask(fileId: string): void {
  const queue = queueDeps.getTaskQueue();
  if (queue.includes(fileId) || queueDeps.getActiveTaskId() === fileId) return;
  const file = queueDeps.getFile(fileId);
  if (!file) return;
  if (isTaskCompleted(file)) return;

  queueDeps.setTaskQueue([...queue, fileId]);
  // 开始 / 全部开始：真正入队时轻确认（批量入队由 confirm 去抖压成一声）
  queueDeps.playSound('confirm');
  if (queueDeps.getActiveTaskId() === null && !isProcessNextScheduled) {
    isProcessNextScheduled = true;
    // Defer to microtask so synchronous callers can observe the enqueued item
    // before processing starts and removes it from the head of the queue.
    queueMicrotask(() => {
      processNext()
        .catch((err) => logger.error('processNext failed:', err))
        .finally(() => {
          isProcessNextScheduled = false;
        });
    });
  }
}

export function dequeueTask(fileId: string): void {
  const queue = queueDeps.getTaskQueue();
  queueDeps.setTaskQueue(queue.filter((id) => id !== fileId));

  if (queueDeps.getActiveTaskId() === fileId) {
    queueDeps.setActiveTaskId(null);
    processNext().catch((err) => logger.error('processNext failed:', err));
  }
}

export function enqueueAllUncompleted(): void {
  const files = queueDeps.getAllFiles();
  for (const file of files) {
    if (isTaskCompleted(file)) continue;

    const isAudioVideo = file.fileType === 'audio' || file.fileType === 'video';
    const needsTranscription = isAudioVideo && file.phases.transcribing.status !== 'completed';

    // 音视频未转录 → 转录+翻译全流程；已转录 / SRT → 仅翻译
    queueDeps.setWorkflow(file.id, needsTranscription ? 'full' : 'translate');

    enqueueTask(file.id);
  }
}

export async function processNext(): Promise<void> {
  const fileId = await startTask();
  if (!fileId) return;
  try {
    const file = queueDeps.getFile(fileId);
    if (file) await runTask(file);
    notifyTaskOutcome(fileId);
  } catch (error) {
    logger.error('processNext task failed:', error);
    queueDeps.playSound('error');
  } finally {
    await finishTask(fileId);
  }
}

async function startTask(): Promise<string | null> {
  const queue = queueDeps.getTaskQueue();
  if (queue.length === 0) {
    queueDeps.setActiveTaskId(null);
    return null;
  }
  const fileId = queue[0];
  queueDeps.setTaskQueue(queue.slice(1));
  queueDeps.setActiveTaskId(fileId);
  return fileId;
}

async function runTask(file: SubtitleFileMetadata): Promise<void> {
  const fileId = file.id;
  const isAudioVideo = file.fileType === 'audio' || file.fileType === 'video';
  const needsTranscription = isAudioVideo && file.phases.transcribing.status !== 'completed';

  if (needsTranscription) {
    // workflow 由按钮在 enqueueTask 前设置，runTask 据此决定是否继续翻译
    await queueDeps.startTranscription(fileId);

    const afterTranscribe = queueDeps.getFile(fileId);
    if (!afterTranscribe || afterTranscribe.phases.transcribing.status !== 'completed') {
      return;
    }
    // 仅转录：转录完成即结束，不继续翻译
    if (afterTranscribe.phases.workflow === 'transcribe') {
      return;
    }
  }

  if (file.fileType === 'srt') {
    queueDeps.setWorkflow(fileId, 'translate');
  }
  const result = await queueDeps.startTranslation(fileId);
  if (result) {
    await saveTranslationHistory(
      file.taskId,
      file.name,
      result.tokens,
      queueDeps.addHistory
    );
  }
}

async function finishTask(fileId: string): Promise<void> {
  if (queueDeps.getActiveTaskId() === fileId) {
    queueDeps.setActiveTaskId(null);
    await processNext();
  }
}
