/**
 * 字幕条目 IDB 存储 + 会话生命周期
 *
 * 设计（源头约束，而不是 flush 时再打补丁）：
 * 1. 内存 entries 仅在 task「已 hydrate」时才是权威数据。
 * 2. 落盘只写 dirty ∩ hydrated；未打开任务绝不会被空数组覆盖。
 * 3. 持久化边界统一去掉 word 级时间戳（断句后无消费方）。
 *
 * key: egg_task_entries:{taskId}
 */
import localforage from 'localforage';
import type { SubtitleEntry } from '@/types';

const PREFIX = 'egg_task_entries:';

function key(taskId: string): string {
  return `${PREFIX}${taskId}`;
}

// ---------- lifecycle (session memory, not persisted) ----------

/** 内存中的 entries 已与权威数据对齐（load / add / replace） */
const hydratedTaskIds = new Set<string>();
/** 相对上次成功 IDB 写入有变更，需要落盘 */
const dirtyTaskIds = new Set<string>();
/** 正在从 IDB 拉取 */
const loadingTaskIds = new Set<string>();

const lifecycleListeners = new Set<() => void>();

function notifyLifecycle(): void {
  for (const cb of lifecycleListeners) {
    try {
      cb();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

/** React / 测试订阅 hydrate·loading 变化 */
export function subscribeEntriesLifecycle(onStoreChange: () => void): () => void {
  lifecycleListeners.add(onStoreChange);
  return () => {
    lifecycleListeners.delete(onStoreChange);
  };
}

export function isEntriesHydrated(taskId: string): boolean {
  return hydratedTaskIds.has(taskId);
}

export function isEntriesLoading(taskId: string): boolean {
  return loadingTaskIds.has(taskId);
}

export function markEntriesHydrated(taskId: string, options?: { dirty?: boolean }): void {
  hydratedTaskIds.add(taskId);
  if (options?.dirty) dirtyTaskIds.add(taskId);
  else dirtyTaskIds.delete(taskId);
  notifyLifecycle();
}

export function markEntriesDirty(taskId: string): void {
  if (!hydratedTaskIds.has(taskId)) {
    // 未 hydrate 的脏写没有权威内存，忽略（避免误把空壳标 dirty）
    return;
  }
  dirtyTaskIds.add(taskId);
}

export function forgetTaskEntriesLifecycle(taskId: string): void {
  hydratedTaskIds.delete(taskId);
  dirtyTaskIds.delete(taskId);
  loadingTaskIds.delete(taskId);
  notifyLifecycle();
}

export function clearEntriesLifecycle(): void {
  hydratedTaskIds.clear();
  dirtyTaskIds.clear();
  loadingTaskIds.clear();
  notifyLifecycle();
}

/** 测试辅助 */
export function getEntriesLifecycleSnapshotForTests(): {
  hydrated: string[];
  dirty: string[];
  loading: string[];
} {
  return {
    hydrated: [...hydratedTaskIds],
    dirty: [...dirtyTaskIds],
    loading: [...loadingTaskIds],
  };
}

export function markEntriesLoading(taskId: string, loading: boolean): void {
  if (loading) loadingTaskIds.add(taskId);
  else loadingTaskIds.delete(taskId);
  notifyLifecycle();
}

// ---------- pure helpers ----------

/** 去掉词级时间戳（持久化 / 历史 / 导出体积） */
export function stripSubtitleWords(entries: SubtitleEntry[]): SubtitleEntry[] {
  let changed = false;
  const out = entries.map((e) => {
    if (e.words === undefined) return e;
    changed = true;
    const { words: _w, ...rest } = e;
    return rest;
  });
  return changed ? out : entries;
}

// ---------- IDB ----------

export async function saveTaskEntries(
  taskId: string,
  entries: SubtitleEntry[]
): Promise<void> {
  await localforage.setItem(key(taskId), stripSubtitleWords(entries));
}

export async function loadTaskEntries(
  taskId: string
): Promise<SubtitleEntry[] | null> {
  const v = await localforage.getItem<SubtitleEntry[]>(key(taskId));
  return v ?? null;
}

export async function removeTaskEntries(taskId: string): Promise<void> {
  forgetTaskEntriesLifecycle(taskId);
  await localforage.removeItem(key(taskId));
}

export async function clearAllTaskEntries(): Promise<void> {
  clearEntriesLifecycle();
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

type TaskEntriesSlice = {
  taskId: string;
  subtitle_entries?: SubtitleEntry[];
  entryCount?: number;
};

/**
 * 只落盘 dirty ∩ hydrated。
 * 未打开（未 hydrate）任务：跳过 —— 这是防止空数组覆盖 IDB 的源头规则。
 * 兼容：setState 直接塞了非空 entries 但未走 lifecycle 时，按「内存权威」写一次并 hydrate。
 */
export async function flushDirtyTaskEntries(
  tasks: TaskEntriesSlice[]
): Promise<void> {
  const writes: Promise<void>[] = [];

  for (const t of tasks) {
    const entries = Array.isArray(t.subtitle_entries) ? t.subtitle_entries : [];
    const hydrated = hydratedTaskIds.has(t.taskId);
    const dirty = dirtyTaskIds.has(t.taskId);

    if (hydrated && dirty) {
      writes.push(
        saveTaskEntries(t.taskId, entries).then(() => {
          dirtyTaskIds.delete(t.taskId);
        })
      );
      continue;
    }

    // 测试 / 旁路 setState：内存已有全文但未登记 hydrate
    if (!hydrated && entries.length > 0) {
      writes.push(
        saveTaskEntries(t.taskId, entries).then(() => {
          hydratedTaskIds.add(t.taskId);
          dirtyTaskIds.delete(t.taskId);
        })
      );
    }
    // !hydrated && entries.length === 0 → 永不写（即使 entryCount > 0）
  }

  if (writes.length > 0) {
    await Promise.all(writes);
    notifyLifecycle();
  }
}

/**
 * 迁移 / rehydrate 拆分：强制把内存中的 entries 写入 IDB（一次性）。
 * 写完后若调用方会清空内存，应 clearEntriesLifecycle 或 forget。
 */
export async function forcePersistTaskEntriesFromTasks(
  tasks: TaskEntriesSlice[]
): Promise<void> {
  await Promise.all(
    tasks.map((t) =>
      saveTaskEntries(t.taskId, Array.isArray(t.subtitle_entries) ? t.subtitle_entries : [])
    )
  );
}

/** @deprecated 使用 forcePersistTaskEntriesFromTasks；保留别名避免旧引用 */
export const persistEntriesFromTasks = forcePersistTaskEntriesFromTasks;
