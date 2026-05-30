import localforage from 'localforage';
import type { ProgressPhase, FilePhases } from '@/types';

const FLUSH_DELAY_MS = 1000;
const BATCH_TASKS_KEY = 'batch_tasks';

interface DirtyState {
  taskId: string;
  phases: FilePhases;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

const dirtyMap = new Map<string, DirtyState>();

/**
 * 标记需要 flush 的阶段
 * 脏写逻辑：标记后延迟 1 秒再写入 localforage
 */
export function markDirty(taskId: string, phase: ProgressPhase, allPhases: FilePhases): void {
  if (!dirtyMap.has(taskId)) {
    dirtyMap.set(taskId, { taskId, phases: allPhases, flushTimer: null });
  } else {
    dirtyMap.get(taskId)!.phases = allPhases;
  }

  const state = dirtyMap.get(taskId)!;

  if (state.flushTimer !== null) {
    clearTimeout(state.flushTimer);
  }
  state.flushTimer = setTimeout(() => flushTask(taskId), FLUSH_DELAY_MS);
}

// 兼容性别名
export { markDirty as markDirtyPhase };

/**
 * 立即标记并 flush（用于失败等紧急情况）
 */
export async function markDirtyAndFlush(taskId: string, phase: ProgressPhase, allPhases: FilePhases): Promise<void> {
  const state = dirtyMap.get(taskId);
  if (state) {
    if (state.flushTimer !== null) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
  }
  markDirty(taskId, phase, allPhases);
  await flushTask(taskId);
}

async function flushTask(taskId: string): Promise<void> {
  const state = dirtyMap.get(taskId);
  if (!state) return;

  state.flushTimer = null;
  const phases = state.phases;

  try {
    const batchTasks = await localforage.getItem<{ tasks: any[] }>(BATCH_TASKS_KEY);
    if (!batchTasks) {
      dirtyMap.delete(taskId);
      return;
    }

    const taskIndex = batchTasks.tasks.findIndex(t => t.taskId === taskId);
    if (taskIndex === -1) {
      dirtyMap.delete(taskId);
      return;
    }

    batchTasks.tasks[taskIndex] = {
      ...batchTasks.tasks[taskIndex],
      phases
    };

    await localforage.setItem(BATCH_TASKS_KEY, batchTasks);
  } catch (err) {
    console.error('[PhasePersistence] flushTask failed, will retry on next markDirty', err);
    return;
  }

  dirtyMap.delete(taskId);
}

/**
 * 应用关闭时 flush 所有
 */
export async function flushAll(): Promise<void> {
  for (const taskId of dirtyMap.keys()) {
    await flushTask(taskId);
  }
}