/**
 * 字幕条目独立 IDB 存储：主任务表 hydrate 时不带大数组，打开任务再加载。
 * key: egg_task_entries:{taskId}
 */
import localforage from 'localforage';
import type { SubtitleEntry } from '@/types';

const PREFIX = 'egg_task_entries:';

function key(taskId: string): string {
  return `${PREFIX}${taskId}`;
}

export async function saveTaskEntries(
  taskId: string,
  entries: SubtitleEntry[]
): Promise<void> {
  await localforage.setItem(key(taskId), entries);
}

export async function loadTaskEntries(
  taskId: string
): Promise<SubtitleEntry[] | null> {
  const v = await localforage.getItem<SubtitleEntry[]>(key(taskId));
  return v ?? null;
}

export async function removeTaskEntries(taskId: string): Promise<void> {
  await localforage.removeItem(key(taskId));
}

export async function clearAllTaskEntries(): Promise<void> {
  try {
    if (typeof localforage.keys !== 'function') return;
    const keys = await localforage.keys();
    await Promise.all(
      keys.filter((k) => typeof k === 'string' && k.startsWith(PREFIX)).map((k) => localforage.removeItem(k))
    );
  } catch {
    /* mock / 私有模式 best-effort */
  }
}

/** 将仍嵌在任务里的 entries 拆到独立 key（升级迁移 / flush 前） */
export async function persistEntriesFromTasks(
  tasks: Array<{ taskId: string; subtitle_entries?: SubtitleEntry[] }>
): Promise<void> {
  await Promise.all(
    tasks.map((t) =>
      saveTaskEntries(t.taskId, Array.isArray(t.subtitle_entries) ? t.subtitle_entries : [])
    )
  );
}
