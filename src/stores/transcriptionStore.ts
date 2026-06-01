/**
 * 转录配置 Store
 * 简化版本：只管理热词分组 + 字幕长度预设
 *
 * 热词使用规则（v2）：
 * - 没有全局开关。任务级 `selectedKeytermGroupId` 是唯一来源
 * - 设置中的"默认热词分组"用于新上传的任务（null = 新任务默认不用热词）
 * - 设置中的默认分组可点击已选项再次点击来取消选中
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { KeytermGroup, SubtitleLengthPreset } from '@/types/transcription';

interface TranscriptionStore {
  apiKeys: string;
  keytermGroups: KeytermGroup[];
  /** 新任务的默认热词分组；null = 默认不使用 */
  defaultKeytermGroupId: string | null;
  setDefaultKeytermGroupId: (id: string | null) => void;
  subtitleLengthPreset: SubtitleLengthPreset;
  aiSegmentationEnabled: boolean;
  updateKeytermGroups: (groups: KeytermGroup[]) => Promise<void>;
  setApiKeys: (keys: string) => void;
  setSubtitleLengthPreset: (preset: SubtitleLengthPreset) => void;
  setAiSegmentationEnabled: (enabled: boolean) => void;
}

const DEFAULT_GROUPS: KeytermGroup[] = [
  { id: 'default', name: '通用', keyterms: [] }
];

export const useTranscriptionStore = create<TranscriptionStore>()(
  persist(
    (set) => ({
      apiKeys: '',
      keytermGroups: DEFAULT_GROUPS,
      defaultKeytermGroupId: null,
      subtitleLengthPreset: 'standard',
      aiSegmentationEnabled: true,

      updateKeytermGroups: async (groups) => {
        set({ keytermGroups: groups });
        // zustand/persist 中间件已自动持久化到 'transcription-storage'
      },

      setDefaultKeytermGroupId: (id) => {
        set({ defaultKeytermGroupId: id });
      },

      setApiKeys: (keys) => {
        set({ apiKeys: keys });
      },

      setSubtitleLengthPreset: (preset) => {
        set({ subtitleLengthPreset: preset });
      },

      setAiSegmentationEnabled: (enabled) => {
        set({ aiSegmentationEnabled: enabled });
      },
    }),
    {
      name: 'transcription-storage',
      // v2 migration: 旧数据可能带 keytermsEnabled，直接丢弃即可
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return { keytermGroups: DEFAULT_GROUPS, defaultKeytermGroupId: null };
        }
        const s = persistedState as Record<string, unknown>;
        return {
          apiKeys: s.apiKeys ?? '',
          keytermGroups: (s.keytermGroups as KeytermGroup[] | undefined) ?? DEFAULT_GROUPS,
          defaultKeytermGroupId: (s.defaultKeytermGroupId as string | null | undefined) ?? null,
          subtitleLengthPreset: (s.subtitleLengthPreset as SubtitleLengthPreset | undefined) ?? 'standard',
          aiSegmentationEnabled: (s.aiSegmentationEnabled as boolean | undefined) ?? true,
        };
      },
      partialize: (state) => ({
        apiKeys: state.apiKeys,
        keytermGroups: state.keytermGroups,
        subtitleLengthPreset: state.subtitleLengthPreset,
        aiSegmentationEnabled: state.aiSegmentationEnabled,
        defaultKeytermGroupId: state.defaultKeytermGroupId,
      }),
    }
  )
);

export const useKeytermGroups = () => useTranscriptionStore((state) => state.keytermGroups);
export const useUpdateKeytermGroups = () => useTranscriptionStore((state) => state.updateKeytermGroups);
export const useApiKeys = () => useTranscriptionStore((state) => state.apiKeys);
export const useSetApiKeys = () => useTranscriptionStore((state) => state.setApiKeys);
export const useSubtitleLengthPreset = () => useTranscriptionStore((state) => state.subtitleLengthPreset);
export const useSetSubtitleLengthPreset = () => useTranscriptionStore((state) => state.setSubtitleLengthPreset);
export const useAiSegmentationEnabled = () => useTranscriptionStore((state) => state.aiSegmentationEnabled);
export const useSetAiSegmentationEnabled = () => useTranscriptionStore((state) => state.setAiSegmentationEnabled);
