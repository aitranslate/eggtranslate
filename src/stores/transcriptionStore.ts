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
import type {
  AsrEngine,
  KeytermGroup,
  LocalAsrBackend,
  LocalAsrModelId,
  SubtitleLengthPreset,
} from '@/types/transcription';

interface TranscriptionStore {
  apiKeys: string;
  keytermGroups: KeytermGroup[];
  /** 新任务的默认热词分组；null = 默认不使用 */
  defaultKeytermGroupId: string | null;
  setDefaultKeytermGroupId: (id: string | null) => void;
  subtitleLengthPreset: SubtitleLengthPreset;
  /** AI 断句兜底：规则断句找不到好切点时交给 LLM（翻译配置的 activeProfile） */
  aiSegmentationEnabled: boolean;
  /** 识别引擎：云端 AssemblyAI / 本地 Bark 3.0（wasm） */
  asrEngine: AsrEngine;
  /** 本地引擎：选中的发布与设备 */
  localAsrModel: LocalAsrModelId;
  localAsrBackend: LocalAsrBackend;
  setAsrEngine: (engine: AsrEngine) => void;
  setLocalAsrModel: (model: LocalAsrModelId) => void;
  setLocalAsrBackend: (backend: LocalAsrBackend) => void;
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
      aiSegmentationEnabled: false,
      asrEngine: 'cloud',
      localAsrModel: 'plus',
      localAsrBackend: 'auto',

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

      setAsrEngine: (engine) => {
        set({ asrEngine: engine });
      },

      setLocalAsrModel: (model) => {
        set({ localAsrModel: model });
      },

      setLocalAsrBackend: (backend) => {
        set({ localAsrBackend: backend });
      },
    }),
    {
      name: 'transcription-storage',
      skipHydration: true,
      partialize: (state) => ({
        apiKeys: state.apiKeys,
        keytermGroups: state.keytermGroups,
        subtitleLengthPreset: state.subtitleLengthPreset,
        defaultKeytermGroupId: state.defaultKeytermGroupId,
        aiSegmentationEnabled: state.aiSegmentationEnabled,
        asrEngine: state.asrEngine,
        localAsrModel: state.localAsrModel,
        localAsrBackend: state.localAsrBackend,
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
export const useAsrEngine = () => useTranscriptionStore((state) => state.asrEngine);
export const useLocalAsrModel = () => useTranscriptionStore((state) => state.localAsrModel);
export const useLocalAsrBackend = () => useTranscriptionStore((state) => state.localAsrBackend);
