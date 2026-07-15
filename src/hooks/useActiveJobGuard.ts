/**
 * 任务进行中时拦截刷新/关闭标签页
 */

import { useEffect } from 'react';
import { useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { useIsTranslating } from '@/stores/translationConfigStore';
import { hasActivePhase, shouldPromptBeforeUnload } from '@/utils/uxHelpers';

export function useIsActiveJob(): boolean {
  const isTranslating = useIsTranslating();
  const activeTaskId = useQueueStore((s) => s.activeTaskId);
  const anyPhaseActive = useFilesStore((s) => s.tasks.some((t) => hasActivePhase(t.phases)));
  return Boolean(isTranslating || activeTaskId || anyPhaseActive);
}

/** 在 App / MainApp 挂载一次即可 */
export function useActiveJobBeforeUnload(enabled = true): void {
  const activeJob = useIsActiveJob();

  useEffect(() => {
    if (!enabled) return;
    if (!shouldPromptBeforeUnload(activeJob)) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Chromium 需要 returnValue
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [enabled, activeJob]);
}
