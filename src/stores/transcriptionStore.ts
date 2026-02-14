/**
 * 转录配置 Store
 * 简化版本：只管理热词分组
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { KeytermGroup } from '@/types/transcription';
import dataManager from '@/services/dataManager';

interface TranscriptionStore {
  apiKeys: string;
  keytermGroups: KeytermGroup[];
  keytermsEnabled: boolean;
  updateKeytermGroups: (groups: KeytermGroup[]) => Promise<void>;
  setKeytermsEnabled: (enabled: boolean) => void;
  setApiKeys: (keys: string) => void;
}

const DEFAULT_GROUPS: KeytermGroup[] = [
  { id: 'default', name: '通用', keyterms: [] }
];

export const useTranscriptionStore = create<TranscriptionStore>()(
  persist(
    (set) => ({
      apiKeys: '',
      keytermGroups: DEFAULT_GROUPS,
      keytermsEnabled: true,

      updateKeytermGroups: async (groups) => {
        set({ keytermGroups: groups });
        await dataManager.saveTranscriptionConfig({ keytermGroups: groups });
      },

      setKeytermsEnabled: (enabled) => {
        set({ keytermsEnabled: enabled });
      },

      setApiKeys: (keys) => {
        set({ apiKeys: keys });
      },
    }),
    {
      name: 'transcription-storage',
      partialize: (state) => ({
        apiKeys: state.apiKeys,
        keytermGroups: state.keytermGroups,
        keytermsEnabled: state.keytermsEnabled
      })
    }
  )
);

export const useKeytermGroups = () => useTranscriptionStore((state) => state.keytermGroups);
export const useUpdateKeytermGroups = () => useTranscriptionStore((state) => state.updateKeytermGroups);
export const useKeytermsEnabled = () => useTranscriptionStore((state) => state.keytermsEnabled);
export const useSetKeytermsEnabled = () => useTranscriptionStore((state) => state.setKeytermsEnabled);
export const useApiKeys = () => useTranscriptionStore((state) => state.apiKeys);
export const useSetApiKeys = () => useTranscriptionStore((state) => state.setApiKeys);
