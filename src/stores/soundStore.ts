/**
 * 界面音效开关（与主题同级的感官偏好，即时生效）
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SoundState {
  /** 默认开启：长任务完成/失败时轻提示 */
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  toggleSound: () => void;
}

export const useSoundStore = create<SoundState>()(
  persist(
    (set, get) => ({
      soundEnabled: true,
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      toggleSound: () => set({ soundEnabled: !get().soundEnabled }),
    }),
    {
      name: 'egg-sound',
      skipHydration: true,
    }
  )
);

/** 启动时预读，避免 rehydrate 前短暂用默认值 */
export function initSoundFromStorage() {
  try {
    const raw = localStorage.getItem('egg-sound');
    if (!raw) return;
    const parsed = JSON.parse(raw) as { state?: { soundEnabled?: unknown } };
    if (typeof parsed?.state?.soundEnabled === 'boolean') {
      useSoundStore.setState({ soundEnabled: parsed.state.soundEnabled });
    }
  } catch {
    /* ignore */
  }
}
