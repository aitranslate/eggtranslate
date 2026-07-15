/**
 * 挂载引导层：Checklist + FeatureTip + SetupGuard
 * 监听「首次翻译 / 转录完成」以触发导出 tip（逻辑在 utils/onboarding）
 */

import React, { useEffect, useRef } from 'react';
import { OnboardingChecklist } from './OnboardingChecklist';
import { FeatureTip } from './FeatureTip';
import { SetupGuardDialog } from './SetupGuardDialog';
import { useFilesStore } from '@/stores/filesStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import {
  collectExportEligibleTaskIds,
  pruneAcknowledgedTaskIds,
  seedAcknowledgedExportTaskIds,
  tryShowExportFormatsTip,
} from '@/utils/onboarding';

export const OnboardingHost: React.FC = () => {
  const acknowledgedRef = useRef<Set<string>>(new Set());
  const bootstrapped = useRef(false);

  useEffect(() => {
    const run = () => {
      const tasks = useFilesStore.getState().tasks;
      const eligibleIds = collectExportEligibleTaskIds(tasks);
      const existing = new Set(tasks.map((t) => t.taskId));
      acknowledgedRef.current = pruneAcknowledgedTaskIds(acknowledgedRef.current, existing);

      const { completedTips, showTipIfNew } = useOnboardingStore.getState();
      const result = tryShowExportFormatsTip({
        eligibleIds,
        acknowledged: acknowledgedRef.current,
        completedTips,
        showTipIfNew: (id) => showTipIfNew(id),
      });
      acknowledgedRef.current = result.acknowledged;
    };

    if (!bootstrapped.current) {
      bootstrapped.current = true;
      // 与监听谓词一致：译/转完成都 seed，回访不误弹
      acknowledgedRef.current = seedAcknowledgedExportTaskIds(useFilesStore.getState().tasks);
    }

    const unsubFiles = useFilesStore.subscribe(() => {
      run();
    });

    // tip 关闭后重试被占用的 export tip
    let prevActive = useOnboardingStore.getState().activeTip;
    const unsubTips = useOnboardingStore.subscribe((state) => {
      const next = state.activeTip;
      if (prevActive != null && next == null) {
        prevActive = next;
        run();
        return;
      }
      prevActive = next;
    });

    return () => {
      unsubFiles();
      unsubTips();
    };
  }, []);

  return (
    <>
      <OnboardingChecklist />
      <FeatureTip />
      <SetupGuardDialog />
    </>
  );
};
