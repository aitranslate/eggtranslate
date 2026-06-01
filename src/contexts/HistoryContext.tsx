import React, { createContext, useContext, useCallback, useEffect, useMemo } from 'react';
import { TranslationHistoryEntry } from '@/types';
import { useHistoryStore } from '@/stores/historyStore';
import { useErrorHandler } from '@/hooks/useErrorHandler';

interface HistoryContextValue {
  history: TranslationHistoryEntry[];
  addHistoryEntry: (entry: Omit<TranslationHistoryEntry, 'timestamp'>) => Promise<void>;
  deleteHistoryEntry: (taskId: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  loadHistoryEntry: (taskId: string) => TranslationHistoryEntry | null;
  getHistoryStats: () => { total: number; totalTokens: number };
}

const HistoryContext = createContext<HistoryContextValue | null>(null);

export const HistoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 单一数据源：直接从 Zustand store 订阅 history，任何路径写入都会自动触发重渲染
  const history = useHistoryStore((state) => state.history);
  const { handleError } = useErrorHandler();

  useEffect(() => {
    useHistoryStore.getState().loadHistory().catch((err) => {
      handleError(err, { context: { operation: '加载历史记录' }, showToast: false });
    });
  }, [handleError]);

  const addHistoryEntry = useCallback(async (entry: Omit<TranslationHistoryEntry, 'timestamp'>) => {
    try {
      await useHistoryStore.getState().addHistory(entry);
    } catch (err) {
      handleError(err, { context: { operation: '保存历史记录' }, showToast: false });
    }
  }, [handleError]);

  const deleteHistoryEntry = useCallback(async (taskId: string) => {
    try {
      await useHistoryStore.getState().removeHistory(taskId);
    } catch (err) {
      handleError(err, { context: { operation: '删除历史记录' }, showToast: false });
    }
  }, [handleError]);

  const clearHistory = useCallback(async () => {
    try {
      await useHistoryStore.getState().clearHistory();
    } catch (err) {
      handleError(err, { context: { operation: '清空历史记录' }, showToast: false });
    }
  }, [handleError]);

  const loadHistoryEntry = useCallback(
    (taskId: string) => history.find((e) => e.taskId === taskId) || null,
    [history]
  );

  const getHistoryStats = useCallback(() => {
    const total = history.length;
    const totalTokens = history.reduce((sum, e) => sum + e.totalTokens, 0);
    return { total, totalTokens };
  }, [history]);

  const value = useMemo<HistoryContextValue>(
    () => ({
      history,
      addHistoryEntry,
      deleteHistoryEntry,
      clearHistory,
      loadHistoryEntry,
      getHistoryStats,
    }),
    [history, addHistoryEntry, deleteHistoryEntry, clearHistory, loadHistoryEntry, getHistoryStats]
  );

  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
};

export const useHistory = () => {
  const context = useContext(HistoryContext);
  if (!context) {
    throw new Error('useHistory must be used within a HistoryProvider');
  }
  return context;
};
