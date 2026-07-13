/**
 * 工作台路由
 * - stage：主舞台（工作区编辑器 / 术语 / 历史）
 * - settingsOpen：右侧设置抽屉，不占用主舞台
 */

import { create } from 'zustand';

export type StageMode = 'editor' | 'terms' | 'history';

interface WorkspaceState {
  stage: StageMode;
  settingsOpen: boolean;
  setStage: (stage: StageMode) => void;
  openEditor: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openTerms: () => void;
  openHistory: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  stage: 'editor',
  settingsOpen: false,
  setStage: (stage) => set({ stage, settingsOpen: false }),
  openEditor: () => set({ stage: 'editor', settingsOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openTerms: () => set({ stage: 'terms', settingsOpen: false }),
  openHistory: () => set({ stage: 'history', settingsOpen: false }),
}));
