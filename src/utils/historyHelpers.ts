/**
 * 翻译历史相关工具函数
 * 提供历史记录查询、统计等纯函数
 */

import type { TranslationHistoryEntry } from '@/types';

export interface HistoryStats {
  total: number;
  totalTokens: number;
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
