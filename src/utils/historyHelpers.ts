/**
 * 翻译历史相关工具函数
 * 提供历史记录查询、统计等纯函数
 */

import type { TranslationHistoryEntry } from '@/types';

/** 本地历史条数上限（含全文条目）；超出时丢弃最旧记录 */
export const HISTORY_MAX_ENTRIES = 50;

interface HistoryStats {
  total: number;
  totalTokens: number;
}

/**
 * 将历史列表裁剪到 max 条。
 * 约定输入为「新在前」顺序（与 historyStore.addHistory 一致）；保留最前 max 条。
 */
export function capHistoryEntries<T>(
  entries: T[],
  max: number = HISTORY_MAX_ENTRIES
): T[] {
  if (max < 0) return [];
  if (entries.length <= max) return entries;
  return entries.slice(0, max);
}

/**
 * 根据 taskId 查找历史记录
 * O(n) 查找，如果频繁使用请在外层建立 Map 索引
 */
export function findHistoryEntry(
  history: TranslationHistoryEntry[],
  taskId: string
): TranslationHistoryEntry | null {
  return history.find(e => e.taskId === taskId) ?? null;
}

/**
 * 计算历史记录统计信息
 */
export function calculateHistoryStats(history: TranslationHistoryEntry[]): HistoryStats {
  return {
    total: history.length,
    totalTokens: history.reduce((sum, e) => sum + e.totalTokens, 0)
  };
}

type HistoryStatusKind = 'translated' | 'transcribed';

interface HistoryStatus {
  label: string;
  kind: HistoryStatusKind;
}

/** 只看 phases：翻译阶段完成 → 翻译完成；否则转录完成。 */
export function resolveHistoryStatus(
  entry: Pick<TranslationHistoryEntry, 'phases'>
): HistoryStatus {
  if (entry.phases.translating.status === 'completed') {
    return { label: '翻译完成', kind: 'translated' };
  }
  return { label: '转录完成', kind: 'transcribed' };
}
