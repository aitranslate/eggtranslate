/**
 * 任务卡展示模型：阶段列表、翻译 n/m（含流式可见行）、忙碌态。
 * 桌面侧栏与移动列表/底栏共用，避免各写一套计数。
 */

import { useMemo } from 'react';
import type { SubtitleFileMetadata } from '@/types';
import { getCardBadge, getDisplayPhases } from '@/utils/badgeHelper';
import { hasActivePhase } from '@/utils/uxHelpers';
import {
  calcDisplayTranslationProgress,
  countStreamingLines,
  EMPTY_STREAMING_OVERLAY,
  useStreamingOverlayStore,
} from '@/stores/streamingOverlayStore';

export function useTaskDisplayModel(
  file: SubtitleFileMetadata,
  queue: { isQueued: boolean; queuePosition: number; isActive: boolean }
) {
  const streamOverlay = useStreamingOverlayStore(
    (s) => s.overlays[file.id] ?? EMPTY_STREAMING_OVERLAY
  );

  const displayPhases = getDisplayPhases(file);

  const translateCounts = useMemo(
    () =>
      calcDisplayTranslationProgress(
        file.translatedCount ?? 0,
        file.entryCount ?? 0,
        countStreamingLines(streamOverlay)
      ),
    [file.translatedCount, file.entryCount, streamOverlay]
  );

  const badge = useMemo(
    () => getCardBadge(file.phases, displayPhases, queue.isQueued, queue.queuePosition),
    [file.phases, displayPhases, queue.isQueued, queue.queuePosition]
  );

  const allPhasesDone = useMemo(
    () => displayPhases.every((p) => file.phases[p]?.status === 'completed'),
    [displayPhases, file.phases]
  );

  const isBusy = queue.isActive || queue.isQueued || hasActivePhase(file.phases);

  return {
    displayPhases,
    translateCounts,
    badge,
    allPhasesDone,
    isBusy,
    pct: translateCounts.percentage,
  };
}
