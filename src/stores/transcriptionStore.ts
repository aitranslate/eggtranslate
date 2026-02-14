/**
 * 转录配置 Store
 * 简化版本：只管理热词分组 + SRT 字符数
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { KeytermGroup } from '@/types/transcription';
import dataManager from '@/services/dataManager';

interface TranscriptionStore {
  apiKeys: string;
  keytermGroups: KeytermGroup[];
  keytermsEnabled: boolean;
  srtCharsPerCaption: number;
  updateKeytermGroups: (groups: KeytermGroup[]) => Promise<void>;
  setKeytermsEnabled: (enabled: boolean) => void;
  setApiKeys: (keys: string) => void;
  setSrtCharsPerCaption: (value: number) => void;
}

const DEFAULT_GROUPS: KeytermGroup[] = [
  { id: 'default', name: '通用', keyterms: [] }
];

const DEFAULT_SRT_CHARS = 32;

export const useTranscriptionStore = create<TranscriptionStore>()(
  persist(
    (set) => ({
      apiKeys: '',
      keytermGroups: DEFAULT_GROUPS,
      keytermsEnabled: true,
      srtCharsPerCaption: DEFAULT_SRT_CHARS,

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

      setSrtCharsPerCaption: (value) => {
        const numValue = typeof value === 'number' ? value : parseInt(String(value)) || DEFAULT_SRT_CHARS;
        set({ srtCharsPerCaption: numValue });
      },
    }),
    {
      name: 'transcription-storage',
      partialize: (state) => ({
        apiKeys: state.apiKeys,
        keytermGroups: state.keytermGroups,
        keytermsEnabled: state.keytermsEnabled,
        srtCharsPerCaption: state.srtCharsPerCaption
      }),
    }
  )
);

export const useKeytermGroups = () => useTranscriptionStore((state) => state.keytermGroups);
export const useUpdateKeytermGroups = () => useTranscriptionStore((state) => state.updateKeytermGroups);
export const useKeytermsEnabled = () => useTranscriptionStore((state) => state.keytermsEnabled);
export const useSetKeytermsEnabled = () => useTranscriptionStore((state) => state.setKeytermsEnabled);
export const useApiKeys = () => useTranscriptionStore((state) => state.apiKeys);
export const useSetApiKeys = () => useTranscriptionStore((state) => state.setApiKeys);
export const useSrtCharsPerCaption = () => useTranscriptionStore((state) => state.srtCharsPerCaption);
export const useSetSrtCharsPerCaption = () => useTranscriptionStore((state) => state.setSrtCharsPerCaption);
