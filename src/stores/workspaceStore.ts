/**
 * 工作台路由
 * - stage：主舞台（工作区编辑器 / 术语 / 历史）
 * - settingsOpen：右侧设置抽屉，不占用主舞台
 * - settingsFocus：打开设置时滚动到的区块（一次性）
 */

import { create } from 'zustand';

export type StageMode = 'editor' | 'terms' | 'history';
export type SettingsFocus = 'translation' | 'transcription' | null;

interface WorkspaceState {
  stage: StageMode;
  settingsOpen: boolean;
  settingsFocus: SettingsFocus;
  setStage: (stage: StageMode) => void;
  openEditor: () => void;
  openSettings: (focus?: SettingsFocus) => void;
  closeSettings: () => void;
  clearSettingsFocus: () => void;
  openTerms: () => void;
  openHistory: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  stage: 'editor',
  settingsOpen: false,
  settingsFocus: null,
  setStage: (stage) => set({ stage, settingsOpen: false, settingsFocus: null }),
  openEditor: () => set({ stage: 'editor', settingsOpen: false, settingsFocus: null }),
  openSettings: (focus = null) => set({ settingsOpen: true, settingsFocus: focus }),
  closeSettings: () => set({ settingsOpen: false, settingsFocus: null }),
  clearSettingsFocus: () => set({ settingsFocus: null }),
  openTerms: () => set({ stage: 'terms', settingsOpen: false, settingsFocus: null }),
  openHistory: () => set({ stage: 'history', settingsOpen: false, settingsFocus: null }),
}));
