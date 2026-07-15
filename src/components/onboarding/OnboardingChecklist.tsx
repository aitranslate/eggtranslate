/**
 * 可关闭上手 Checklist（L2）
 * 含翻译 + 可选转录配置步骤
 */

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useIsTranslationConfigured } from '@/stores/translationConfigStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { useFileCount, useFilesStore } from '@/stores/filesStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  deriveChecklistSteps,
  hasFinishedOnceEvidence,
  isChecklistComplete,
  isTranscriptionApiConfigured,
  shouldShowChecklist,
} from '@/utils/onboarding';

/** 稳定布尔对：仅当完成态变化时触发 re-render（useShallow） */
function usePhaseCompletionFlags(): {
  anyTranslationCompleted: boolean;
  anyTranscriptionCompleted: boolean;
} {
  return useFilesStore(
    useShallow((s) => {
      let anyTranslationCompleted = false;
      let anyTranscriptionCompleted = false;
      for (const t of s.tasks) {
        if (t.phases.translating.status === 'completed') anyTranslationCompleted = true;
        if (t.phases.transcribing.status === 'completed') anyTranscriptionCompleted = true;
        if (anyTranslationCompleted && anyTranscriptionCompleted) break;
      }
      return { anyTranslationCompleted, anyTranscriptionCompleted };
    })
  );
}

export const OnboardingChecklist: React.FC = () => {
  const dismissed = useOnboardingStore((s) => s.dismissed);
  const forceShowChecklist = useOnboardingStore((s) => s.forceShowChecklist);
  const hasExported = useOnboardingStore((s) => s.hasExported);
  const dismissChecklist = useOnboardingStore((s) => s.dismissChecklist);
  const isConfigured = useIsTranslationConfigured();
  const apiKeys = useTranscriptionStore((s) => s.apiKeys);
  const fileCount = useFileCount();
  const historyCount = useHistoryStore((s) => s.history.length);
  const { anyTranslationCompleted, anyTranscriptionCompleted } = usePhaseCompletionFlags();
  const openSettings = useWorkspaceStore((s) => s.openSettings);
  const settingsOpen = useWorkspaceStore((s) => s.settingsOpen);

  const steps = useMemo(
    () =>
      deriveChecklistSteps({
        isConfigured,
        isTranscriptionConfigured: isTranscriptionApiConfigured(apiKeys),
        fileCount,
        hasFinishedOnce: hasFinishedOnceEvidence({
          historyCount,
          hasExported,
          anyTranslationCompleted,
          anyTranscriptionCompleted,
        }),
      }),
    [
      isConfigured,
      apiKeys,
      fileCount,
      historyCount,
      hasExported,
      anyTranslationCompleted,
      anyTranscriptionCompleted,
    ]
  );

  // 设置打开时隐藏，避免压住抽屉 / 焦点逃逸
  const visible =
    !settingsOpen &&
    shouldShowChecklist({ dismissed, steps, forceShow: forceShowChecklist });
  const allDone = isChecklistComplete(steps);
  const required = steps.filter((s) => !s.optional);
  const doneCount = required.filter((s) => s.done).length;

  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          className="ob-checklist"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          aria-label="上手引导"
          data-testid="onboarding-checklist"
        >
          <header className="ob-checklist-head">
            <div>
              <h3 className="ob-checklist-title">开始使用</h3>
              <p className="ob-checklist-sub">
                {doneCount}/{required.length} 步
                {allDone ? ' · 已完成' : ''}
              </p>
            </div>
            <button
              type="button"
              className="ob-checklist-close"
              onClick={dismissChecklist}
              aria-label="关闭上手引导"
              title="关闭"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </header>
          <ul className="ob-checklist-list">
            {steps.map((step) => (
              <li key={step.id} className={`ob-checklist-item${step.done ? ' is-done' : ''}`}>
                <span className="ob-checklist-check" aria-hidden>
                  {step.done ? <Check className="h-3 w-3" strokeWidth={2.5} /> : null}
                </span>
                <span className="ob-checklist-label">
                  {step.settingsFocus && !step.done ? (
                    <button
                      type="button"
                      className="ob-checklist-action"
                      onClick={() => openSettings(step.settingsFocus)}
                    >
                      {step.label}
                    </button>
                  ) : (
                    <span>{step.label}</span>
                  )}
                  {step.optional ? <span className="ob-checklist-optional">可选</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};
