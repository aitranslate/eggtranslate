/**
 * 上手引导会话 / 持久化偏好
 * - dismissed：用户关闭 Checklist 后不再自动出现
 * - completedTips：一次性 tip（关闭 tip 时由 clearActiveTip 写入）
 * - hasExported：导出成功里程碑（与 history / phase 共同判定「完成一次」）
 * - setupGuardKind / activeTip / forceShowChecklist：会话 UI 态（不持久化）
 *
 * schema 变更：bump ONBOARDING_STORAGE_KEY 后缀（v2…），不必在 state 里再挂 version。
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { OnboardingTipId, SetupGuardKind } from '@/utils/onboarding';
import { ONBOARDING_STORAGE_KEY, isTipCompleted } from '@/utils/onboarding';

interface OnboardingState {
  dismissed: boolean;
  completedTips: string[];
  hasExported: boolean;
  /** 会话态：设置「重新查看」后即使步骤已完成也显示 Checklist */
  forceShowChecklist: boolean;

  setupGuardKind: SetupGuardKind | null;
  activeTip: OnboardingTipId | null;

  dismissChecklist: () => void;
  resetOnboarding: () => void;
  /** 若未看过则激活 tip，返回是否真正激活 */
  showTipIfNew: (tipId: OnboardingTipId) => boolean;
  /** 关闭当前 tip 并记入 completedTips（幂等） */
  clearActiveTip: () => void;
  markExported: () => void;
  openSetupGuard: (kind?: SetupGuardKind) => void;
  closeSetupGuard: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      dismissed: false,
      completedTips: [],
      hasExported: false,
      forceShowChecklist: false,

      setupGuardKind: null,
      activeTip: null,

      dismissChecklist: () => set({ dismissed: true, forceShowChecklist: false }),

      resetOnboarding: () =>
        set({
          dismissed: false,
          completedTips: [],
          hasExported: false,
          forceShowChecklist: true,
          activeTip: null,
          setupGuardKind: null,
        }),

      showTipIfNew: (tipId) => {
        const { completedTips, activeTip } = get();
        if (isTipCompleted(completedTips, tipId)) return false;
        // 同时最多 1 个 tip
        if (activeTip && activeTip !== tipId) return false;
        set({ activeTip: tipId });
        return true;
      },

      clearActiveTip: () => {
        const tip = get().activeTip;
        if (tip) {
          const { completedTips } = get();
          if (!isTipCompleted(completedTips, tip)) {
            set({
              activeTip: null,
              completedTips: [...completedTips, tip],
            });
            return;
          }
        }
        set({ activeTip: null });
      },

      markExported: () => {
        if (get().hasExported) return;
        set({ hasExported: true });
      },

      openSetupGuard: (kind = 'translation') => set({ setupGuardKind: kind }),
      closeSetupGuard: () => set({ setupGuardKind: null }),
    }),
    {
      name: ONBOARDING_STORAGE_KEY,
      skipHydration: true,
      partialize: (state) => ({
        dismissed: state.dismissed,
        completedTips: state.completedTips,
        hasExported: state.hasExported,
      }),
    }
  )
);
