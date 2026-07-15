/**
 * 一次性情境 tip（同时最多 1 个）
 */

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb, X } from 'lucide-react';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { tipCopy, type OnboardingTipId } from '@/utils/onboarding';

export const FeatureTip: React.FC = () => {
  const activeTip = useOnboardingStore((s) => s.activeTip);
  const clearActiveTip = useOnboardingStore((s) => s.clearActiveTip);
  const openSettings = useWorkspaceStore((s) => s.openSettings);
  const settingsOpen = useWorkspaceStore((s) => s.settingsOpen);

  const copy = activeTip && !settingsOpen ? tipCopy(activeTip as OnboardingTipId) : null;
  const show = Boolean(activeTip && copy && !settingsOpen);

  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        clearActiveTip();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [show, clearActiveTip]);

  return (
    <AnimatePresence>
      {show && copy && (
        <motion.div
          className="ob-tip"
          role="status"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          data-testid="onboarding-feature-tip"
        >
          <div className="ob-tip-icon" aria-hidden>
            <Lightbulb className="h-4 w-4" />
          </div>
          <div className="ob-tip-body">
            <h4 className="ob-tip-title">{copy.title}</h4>
            <p className="ob-tip-text">{copy.body}</p>
            <div className="ob-tip-actions">
              {copy.actionFocus && copy.actionLabel && (
                <button
                  type="button"
                  className="ob-tip-btn primary"
                  onClick={() => {
                    openSettings(copy.actionFocus);
                    clearActiveTip();
                  }}
                >
                  {copy.actionLabel}
                </button>
              )}
              <button type="button" className="ob-tip-btn" onClick={clearActiveTip}>
                知道了
              </button>
            </div>
          </div>
          <button
            type="button"
            className="ob-tip-close"
            onClick={clearActiveTip}
            aria-label="关闭提示"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
