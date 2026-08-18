/**
 * 工作台路由
 * - stage：主舞台（项目 / 术语 / 历史）
 * - settingsOpen：设置抽屉，不占用主舞台
 * - settingsFocus：打开设置时滚动到的区块（一次性）
 * - mobileEditorOpen：仅手机。选中任务 ≠ 打开字幕编辑器。
 *   桌面仍用 selectedFileId 在主栏打开编辑器；刷新不持久化此字段，回列表。
 */

import { create } from 'zustand';

export type StageMode = 'editor' | 'terms' | 'history';
type SettingsFocus = 'translation' | 'transcription' | null;

interface WorkspaceState {
  stage: StageMode;
  settingsOpen: boolean;
  settingsFocus: SettingsFocus;
  mobileEditorOpen: boolean;
  setStage: (stage: StageMode) => void;
  openEditor: () => void;
  openMobileEditor: () => void;
  closeMobileEditor: () => void;
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
  mobileEditorOpen: false,
  setStage: (stage) =>
    set({ stage, settingsOpen: false, settingsFocus: null, mobileEditorOpen: false }),
  openEditor: () =>
    set({ stage: 'editor', settingsOpen: false, settingsFocus: null, mobileEditorOpen: false }),
  openMobileEditor: () =>
    set({ stage: 'editor', settingsOpen: false, settingsFocus: null, mobileEditorOpen: true }),
  closeMobileEditor: () => set({ mobileEditorOpen: false }),
  openSettings: (focus = null) => set({ settingsOpen: true, settingsFocus: focus }),
  closeSettings: () => set({ settingsOpen: false, settingsFocus: null }),
  clearSettingsFocus: () => set({ settingsFocus: null }),
  openTerms: () =>
    set({ stage: 'terms', settingsOpen: false, settingsFocus: null, mobileEditorOpen: false }),
  openHistory: () =>
    set({ stage: 'history', settingsOpen: false, settingsFocus: null, mobileEditorOpen: false }),
}));
