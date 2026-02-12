/**
 * 转录配置 Store
 * 简化版本：只管理热词分组
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { KeytermGroup } from '@/types/transcription';
import dataManager from '@/services/dataManager';

interface TranscriptionStore {
  // 热词分组
  keytermGroups: KeytermGroup[];

  // Actions
  updateKeytermGroups: (groups: KeytermGroup[]) => Promise<void>;
}

const DEFAULT_GROUPS: KeytermGroup[] = [
  { id: 'default', name: '通用', keyterms: [] }
];

export const useTranscriptionStore = create<TranscriptionStore>()(
  persist(
    (set, get) => ({
      keytermGroups: DEFAULT_GROUPS,

      updateKeytermGroups: async (groups) => {
        set({ keytermGroups: groups });
        await dataManager.saveTranscriptionConfig({ keytermGroups: groups });
      },
    }),
    {
      name: 'transcription-storage',
      partialize: (state) => ({
        keytermGroups: state.keytermGroups
      })
    }
  )
);

// 初始化：加载保存的配置
if (typeof window !== 'undefined') {
  (async () => {
    try {
      const savedConfig = await dataManager.getTranscriptionConfig();
      if (savedConfig?.keytermGroups) {
        useTranscriptionStore.setState({ keytermGroups: savedConfig.keytermGroups });
      }
    } catch (error) {
      console.error('[transcriptionStore] 初始化失败:', error);
    }
  })();
}

// 导出 hooks
export const useKeytermGroups = () => useTranscriptionStore((state) => state.keytermGroups);
export const useUpdateKeytermGroups = () => useTranscriptionStore((state) => state.updateKeytermGroups);
