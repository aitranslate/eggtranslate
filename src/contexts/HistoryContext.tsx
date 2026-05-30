import React, { createContext, useContext, useReducer, useCallback, useMemo } from 'react';
import { TranslationHistoryEntry } from '@/types';
import { useHistoryStore } from '@/stores/historyStore';
import { useErrorHandler } from '@/hooks/useErrorHandler';

interface HistoryState {
  history: TranslationHistoryEntry[];
  isLoading: boolean;
  error: string | null;
}

interface HistoryContextValue extends HistoryState {
  addHistoryEntry: (entry: Omit<TranslationHistoryEntry, 'timestamp'>) => Promise<void>;
  deleteHistoryEntry: (taskId: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  loadHistoryEntry: (taskId: string) => TranslationHistoryEntry | null;
  getHistoryStats: () => { total: number; totalTokens: number };
  refreshHistory: () => Promise<void>;
}

type HistoryAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_HISTORY'; payload: TranslationHistoryEntry[] }
  | { type: 'ADD_HISTORY_ENTRY'; payload: TranslationHistoryEntry }
  | { type: 'DELETE_HISTORY_ENTRY'; payload: string }
  | { type: 'CLEAR_HISTORY' };

const initialState: HistoryState = {
  history: [],
  isLoading: false,
  error: null
};

const historyReducer = (state: HistoryState, action: HistoryAction): HistoryState => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_HISTORY':
      return { ...state, history: action.payload };
    case 'ADD_HISTORY_ENTRY':
      return { ...state, history: [action.payload, ...state.history] };
    case 'DELETE_HISTORY_ENTRY':
      return {
        ...state,
        history: state.history.filter(entry => entry.taskId !== action.payload)
      };
    case 'CLEAR_HISTORY':
      return { ...state, history: [] };
    default:
      return state;
  }
};

const HistoryContext = createContext<HistoryContextValue | null>(null);

export const HistoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(historyReducer, initialState);

  // 使用统一错误处理
  const { handleError } = useErrorHandler();

  const addHistoryEntry = useCallback(async (entry: Omit<TranslationHistoryEntry, 'timestamp'>) => {
    try {
      const fullEntry: TranslationHistoryEntry = {
        ...entry,
        timestamp: Date.now()
      };
      await useHistoryStore.getState().addHistory(fullEntry);
      const updatedHistory = useHistoryStore.getState().history;
      dispatch({ type: 'SET_HISTORY', payload: updatedHistory });
    } catch (error) {
      handleError(error, {
        context: { operation: '保存历史记录' },
        showToast: false
      });
      dispatch({ type: 'SET_ERROR', payload: '保存历史记录失败' });
    }
  }, [handleError]);

  const deleteHistoryEntry = useCallback(async (taskId: string) => {
    dispatch({ type: 'DELETE_HISTORY_ENTRY', payload: taskId });
    // historyStore doesn't have delete, so we need to rebuild history without this entry
    const currentHistory = useHistoryStore.getState().history;
    const filteredHistory = currentHistory.filter(entry => entry.taskId !== taskId);
    await useHistoryStore.getState().clearHistory();
    // Re-add all entries except the deleted one
    for (const entry of filteredHistory) {
      await useHistoryStore.getState().addHistory(entry);
    }
  }, []);

  const clearHistory = useCallback(async () => {
    dispatch({ type: 'CLEAR_HISTORY' });
    await useHistoryStore.getState().clearHistory();
  }, []);

  const loadHistoryEntry = useCallback((taskId: string): TranslationHistoryEntry | null => {
    return state.history.find(entry => entry.taskId === taskId) || null;
  }, [state.history]);

  const getHistoryStats = useCallback(() => {
    const total = state.history.length;
    const totalTokens = state.history.reduce((sum, entry) => sum + entry.totalTokens, 0);
    return { total, totalTokens };
  }, [state.history]);

  const refreshHistory = useCallback(async () => {
    try {
      dispatch({ type: 'SET_LOADING', payload: true });
      await useHistoryStore.getState().loadHistory();
      const savedHistory = useHistoryStore.getState().history;
      dispatch({ type: 'SET_HISTORY', payload: savedHistory });
    } catch (error) {
      handleError(error, {
        context: { operation: '刷新历史记录' },
        showToast: false
      });
      dispatch({ type: 'SET_ERROR', payload: '刷新历史记录失败' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [handleError]);

  React.useEffect(() => {
    const loadSavedData = async () => {
      try {
        dispatch({ type: 'SET_LOADING', payload: true });
        await useHistoryStore.getState().loadHistory();
        const savedHistory = useHistoryStore.getState().history;
        dispatch({ type: 'SET_HISTORY', payload: savedHistory });
      } catch (error) {
        handleError(error, {
          context: { operation: '加载历史记录' },
          showToast: false
        });
        dispatch({ type: 'SET_ERROR', payload: '加载历史记录失败' });
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    };

    loadSavedData();
  }, [handleError]);

  // 使用 useMemo 优化 Context value，避免不必要的重渲染
  const value: HistoryContextValue = useMemo(() => ({
    ...state,
    addHistoryEntry,
    deleteHistoryEntry,
    clearHistory,
    loadHistoryEntry,
    getHistoryStats,
    refreshHistory
  }), [
    state,
    addHistoryEntry,
    deleteHistoryEntry,
    clearHistory,
    loadHistoryEntry,
    getHistoryStats,
    refreshHistory
  ]);

  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
};

export const useHistory = () => {
  const context = useContext(HistoryContext);
  if (!context) {
    throw new Error('useHistory must be used within a HistoryProvider');
  }
  return context;
};