/**
 * 移动端任务详情底栏：常驻操作坞。
 * 主按钮始终可见；进度与桌面阶段 chip 同一套 n/m。
 */

import { useMemo, useCallback } from 'react';
import { Play, Square, Mic, Loader2 } from 'lucide-react';
import type { SubtitleFileMetadata } from '@/types';
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
import { formatTaskPhaseChipLabel } from '@/utils/badgeHelper';
import { resolveTaskPrimary } from '@/utils/taskPrimary';
import { useTaskDisplayModel } from '@/hooks/useTaskDisplayModel';
import type { ExportFormat } from '@/utils/fileExport';
import toast from 'react-hot-toast';
import { useErrorHandler } from '@/hooks/useErrorHandler';

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

  const { allPhasesDone, isBusy, translateCounts, badge } = useTaskDisplayModel(file, {
    isQueued,
    queuePosition,
    isActive,
  });

  const isAudioVideo = file.fileType === 'audio' || file.fileType === 'video';
  const canTranscribe = isAudioVideo && !isBusy && canRetranscribe(file) && !allPhasesDone;
  const isTranscribeFailed = file.phases.transcribing.status === 'failed';
  const transcribeLabel = isTranscribeFailed ? '重新转录' : '转录';

  const primary = useMemo(
    () => resolveTaskPrimary(file, { isQueued, isBusy }),
    [file, isQueued, isBusy]
  );
  const canRun = primary.enabled;
  const primaryLabel = primary.label;

  const handlePrimary = useCallback(() => {
    if (primary.action === 'cancel') {
      dequeueTask(file.id);
      return;
    }
    startPrimaryForFile(file);
  }, [primary.action, file]);

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

  const statusText = useMemo(() => {
    if (file.phases.transcribing.status === 'active') return '转录中…';
    if (file.phases.segmenting?.status === 'active') {
      return formatTaskPhaseChipLabel('segmenting', {
        status: 'active',
        segmenting: file.phases.segmenting,
        translated: translateCounts.translated,
        total: translateCounts.total,
      });
    }
    if (isQueued) return badge.text;
    if ((file.entryCount ?? 0) > 0) {
      return formatTaskPhaseChipLabel('translating', {
        translated: translateCounts.translated,
        total: translateCounts.total,
      });
    }
    if (isBusy) return '处理中…';
    return '暂无字幕';
  }, [
    file.phases.transcribing.status,
    file.phases.segmenting,
    file.entryCount,
    translateCounts.translated,
    translateCounts.total,
    isBusy,
    isQueued,
    badge.text,
  ]);

  return (
    <div className="m-detail-bar">
      <div className="m-detail-status" data-testid="mobile-detail-status">
        {statusText}
      </div>

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
          data-testid="mobile-detail-primary"
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
