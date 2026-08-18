/**
 * 检查点 IDB：key = egg_checkpoint:{taskId}
 * 所有写操作按 taskId 串行，避免并发 span 落盘互相覆盖。
 */

import localforage from 'localforage';
import {
  CHECKPOINT_VERSION,
  type AiBreakSpanCheckpoint,
  type AsrJobCheckpoint,
  type TaskCheckpoint,
} from './types';

const PREFIX = 'egg_checkpoint:';

function storageKey(taskId: string): string {
  return `${PREFIX}${taskId}`;
}

const writeChains = new Map<string, Promise<unknown>>();

function serialized<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
  const next = (writeChains.get(taskId) ?? Promise.resolve()).then(fn, fn);
  writeChains.set(
    taskId,
    next.then(
      () => undefined,
      () => undefined
    )
  );
  return next;
}

function emptyCheckpoint(taskId: string): TaskCheckpoint {
  return { version: CHECKPOINT_VERSION, taskId };
}

export async function loadTaskCheckpoint(
  taskId: string
): Promise<TaskCheckpoint | null> {
  const v = await localforage.getItem<TaskCheckpoint>(storageKey(taskId));
  if (!v || typeof v !== 'object') return null;
  if (v.taskId && v.taskId !== taskId) return null;
  return v;
}

export async function saveTaskCheckpoint(
  taskId: string,
  patch: Partial<Omit<TaskCheckpoint, 'version' | 'taskId'>>
): Promise<TaskCheckpoint> {
  return serialized(taskId, async () => {
    const prev = (await loadTaskCheckpoint(taskId)) ?? emptyCheckpoint(taskId);
    const next: TaskCheckpoint = {
      ...prev,
      ...patch,
      version: CHECKPOINT_VERSION,
      taskId,
      asr: patch.asr ? { ...prev.asr, ...patch.asr } : prev.asr,
      aiBreaks:
        patch.aiBreaks !== undefined
          ? { ...prev.aiBreaks, ...patch.aiBreaks }
          : prev.aiBreaks,
    };
    await localforage.setItem(storageKey(taskId), next);
    return next;
  });
}

export async function saveAsrJobCheckpoint(
  taskId: string,
  asr: AsrJobCheckpoint
): Promise<TaskCheckpoint> {
  return saveTaskCheckpoint(taskId, { asr });
}

export async function saveAiBreakSpan(
  taskId: string,
  span: AiBreakSpanCheckpoint
): Promise<TaskCheckpoint> {
  return saveTaskCheckpoint(taskId, {
    aiBreaks: { [String(span.spanIdx)]: span },
  });
}

export async function removeTaskCheckpoint(taskId: string): Promise<void> {
  return serialized(taskId, async () => {
    await localforage.removeItem(storageKey(taskId));
  });
}

export async function clearAllTaskCheckpoints(): Promise<void> {
  try {
    if (typeof localforage.keys !== 'function') return;
    const keys = await localforage.keys();
    await Promise.all(
      keys
        .filter((k) => typeof k === 'string' && k.startsWith(PREFIX))
        .map((k) => localforage.removeItem(k))
    );
  } catch {
    /* mock / 私有模式 best-effort */
  }
}

/** 测试用：清空串行队列 */
export function resetCheckpointWriteQueuesForTests(): void {
  writeChains.clear();
}
