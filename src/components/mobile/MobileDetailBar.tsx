/**
 * 移动端任务详情底栏：默认收起为把手，展开后显示热词 / 导出 / 转录 / 转译。
 * 忙碌时自动展开；列表滚动时收起（非忙碌）。
 */

import { useMemo, useCallback, useState, useEffect } from 'react';
import { Play, Square, Mic, Loader2, ChevronUp, ChevronDown } from 'lucide-react';
import type { SubtitleFileMetadata } from '@/types';
import { ALL_PHASES } from '@/types';
import { useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { dequeueTask } from '@/services/queueService';
import {
  startPrimaryForFile,
  startTranscribeTask,
} from '@/services/startTask';
import { exportFile } from '@/services/SubtitleExporter';
import { ExportButton } from '@/components/common/ExportButton';
import { canRetranscribe } from '@/utils/fileUtils';
import { formatAiSegmentProgress } from '@/utils/uxHelpers';
import type { ExportFormat } from '@/utils/fileExport';
import toast from 'react-hot-toast';
import { useErrorHandler } from '@/hooks/useErrorHandler';

/** 编辑器列表滚动时派发，底栏非忙碌则收起 */
export const MOBILE_DETAIL_SCROLL_EVENT = 'egg-mobile-detail-scroll';

interface MobileDetailBarProps {
  file: SubtitleFileMetadata;
}

export function MobileDetailBar({ file }: MobileDetailBarProps) {
  const taskQueue = useQueueStore((s) => s.taskQueue);
  const activeTaskId = useQueueStore((s) => s.activeTaskId);
  const keytermGroups = useTranscriptionStore((s) => s.keytermGroups);
  const setSelectedKeytermGroupId = useFilesStore((s) => s.setSelectedKeytermGroupId);
  const { handleError } = useErrorHandler();

  const queuePosition = taskQueue.indexOf(file.id) + 1;
  const isActive = activeTaskId === file.id;
  const isQueued = queuePosition > 0 && !isActive;

  const displayPhases = useMemo(() => {
    const base =
      file.fileType === 'srt'
        ? ALL_PHASES.filter(
            (p) => p !== 'converting' && p !== 'transcribing' && p !== 'segmenting'
          )
        : ALL_PHASES.filter((p) => p !== 'converting');
    return base.filter((p) => p !== 'segmenting' || Boolean(file.phases.segmenting));
  }, [file.fileType, file.phases.segmenting]);

  const allPhasesDone = useMemo(
    () => displayPhases.every((p) => file.phases[p]?.status === 'completed'),
    [displayPhases, file.phases]
  );

  const pct =
    (file.entryCount ?? 0) > 0
      ? Math.round(((file.translatedCount ?? 0) / (file.entryCount ?? 1)) * 100)
      : 0;

  const isAudioVideo = file.fileType === 'audio' || file.fileType === 'video';
  const isTranscriptionDone = file.phases.transcribing.status === 'completed';
  const isBusy =
    isActive ||
    isQueued ||
    file.phases.converting.status === 'active' ||
    file.phases.transcribing.status === 'active' ||
    file.phases.segmenting?.status === 'active' ||
    file.phases.translating.status === 'active';

  const canTranscribe = isAudioVideo && !isBusy && canRetranscribe(file) && !allPhasesDone;
  const isTranscribeFailed = file.phases.transcribing.status === 'failed';
  const transcribeLabel = isTranscribeFailed ? '重新转录' : '转录';

  const canRun = useMemo(() => {
    if (isQueued) return true;
    if (isBusy || allPhasesDone) return false;
    if (isAudioVideo && !isTranscriptionDone && !isTranscribeFailed) return true;
    if (isAudioVideo && isTranscribeFailed && (file.entryCount ?? 0) === 0) return false;
    if (pct >= 100) return false;
    return true;
  }, [
    isQueued,
    isBusy,
    allPhasesDone,
    isAudioVideo,
    isTranscriptionDone,
    isTranscribeFailed,
    file.entryCount,
    pct,
  ]);

  const idlePrimary = allPhasesDone
    ? '已完成'
    : isAudioVideo && isTranscribeFailed && (file.entryCount ?? 0) === 0
      ? '重试'
      : isAudioVideo && !isTranscriptionDone && !isTranscribeFailed
        ? '转译'
        : '翻译';
  const primaryLabel = isQueued
    ? '取消排队'
    : isBusy
      ? idlePrimary === '已完成'
        ? '翻译'
        : idlePrimary
      : idlePrimary;

  const [expanded, setExpanded] = useState(false);

  // 忙碌时自动展开，便于取消/看状态
  useEffect(() => {
    if (isBusy) setExpanded(true);
  }, [isBusy]);

  // 列表滚动：非忙碌则收起
  useEffect(() => {
    const onScroll = () => {
      if (!isBusy) setExpanded(false);
    };
    window.addEventListener(MOBILE_DETAIL_SCROLL_EVENT, onScroll);
    return () => window.removeEventListener(MOBILE_DETAIL_SCROLL_EVENT, onScroll);
  }, [isBusy]);

  const handlePrimary = useCallback(() => {
    if (isQueued) {
      dequeueTask(file.id);
      return;
    }
    startPrimaryForFile(file);
  }, [isQueued, file]);

  const handleTranscribe = useCallback(() => {
    startTranscribeTask(file.id);
  }, [file.id]);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      try {
        await exportFile(file.taskId, file.name, format);
        toast.success('导出成功');
      } catch (error) {
        handleError(error, { context: { operation: '导出', fileName: file.name } });
      }
    },
    [file.taskId, file.name, handleError]
  );

  const summaryLeft = useMemo(() => {
    const total = file.entryCount ?? 0;
    const done = file.translatedCount ?? 0;
    if (isBusy) {
      if (file.phases.transcribing.status === 'active') return '转录中…';
      if (file.phases.segmenting?.status === 'active') {
        return formatAiSegmentProgress(file.phases.segmenting) ?? 'AI断句中…';
      }
      if (file.phases.translating.status === 'active') return '翻译中…';
      if (isQueued) return `排队 #${queuePosition}`;
      return '处理中…';
    }
    if (total <= 0) return '暂无字幕';
    return `${done}/${total} 已译 · ${pct}%`;
  }, [
    file.entryCount,
    file.translatedCount,
    file.phases.transcribing.status,
    file.phases.segmenting,
    file.phases.translating.status,
    isBusy,
    isQueued,
    queuePosition,
    pct,
  ]);

  if (!expanded) {
    return (
      <div className="m-detail-bar is-collapsed">
        <button
          type="button"
          className="m-detail-bar-summary"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          aria-label="展开操作：热词、导出、转录、翻译"
        >
          <span className="m-detail-bar-grip" aria-hidden />
          <span className="m-detail-bar-summary-text">{summaryLeft}</span>
          <span className="m-detail-bar-summary-hint">
            操作
            <ChevronUp className="h-3.5 w-3.5" />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="m-detail-bar is-expanded">
      <button
        type="button"
        className="m-detail-bar-collapse"
        onClick={() => setExpanded(false)}
        aria-expanded
        aria-label="收起操作栏"
      >
        <span className="m-detail-bar-grip" aria-hidden />
        <span>收起</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {isAudioVideo && keytermGroups.length > 0 && (
        <label className="m-detail-keyterm">
          <span>热词</span>
          <select
            value={file.selectedKeytermGroupId ?? ''}
            onChange={(e) => setSelectedKeytermGroupId(file.id, e.target.value || null)}
            aria-label="热词分组"
          >
            <option value="">无</option>
            {keytermGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className={`m-detail-actions${isAudioVideo ? ' has-transcribe' : ''}`}>
        <div className="m-export-wrap">
          <ExportButton
            variant="icon"
            disabled={(file.entryCount ?? 0) === 0 || isBusy}
            hasTranslation={(file.translatedCount ?? 0) > 0}
            onSelect={(fmt) => void handleExport(fmt)}
          />
        </div>

        {isAudioVideo && (
          <button
            type="button"
            className="m-btn secondary"
            disabled={!canTranscribe}
            onClick={handleTranscribe}
          >
            <Mic className="h-4 w-4 shrink-0" />
            <span className="m-btn-label">{transcribeLabel}</span>
          </button>
        )}

        <button
          type="button"
          className={`m-btn primary ${isQueued ? 'muted' : ''}`}
          disabled={!canRun && !isQueued}
          onClick={handlePrimary}
        >
          {isBusy && !isQueued ? (
            <Loader2 className="h-4 w-4 m-spin shrink-0" />
          ) : isQueued ? (
            <Square className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Play className="h-4 w-4 shrink-0" />
          )}
          <span className="m-btn-label">{primaryLabel}</span>
        </button>
      </div>
    </div>
  );
}
