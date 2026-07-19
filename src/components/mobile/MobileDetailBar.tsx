/**
 * 移动端任务详情底栏：转录 / 翻译 / 导出
 */

import { useMemo, useCallback } from 'react';
import { Play, Square, Mic, Loader2 } from 'lucide-react';
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

  const displayPhases = useMemo(() => {
    return file.fileType === 'srt'
      ? ALL_PHASES.filter((p) => p !== 'converting' && p !== 'transcribing')
      : ALL_PHASES.filter((p) => p !== 'converting');
  }, [file.fileType]);

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
    file.phases.translating.status === 'active';

  const canTranscribe = isAudioVideo && !isBusy && canRetranscribe(file) && !allPhasesDone;
  const isTranscribeFailed = file.phases.transcribing.status === 'failed';
  /** 失败后文案更长，布局须保证单行不换行 */
  const transcribeLabel = isTranscribeFailed ? '重新转录' : '转录';

  const canRun = useMemo(() => {
    if (isQueued) return true;
    if (isBusy || allPhasesDone) return false;
    // 转录失败：仍可点主按钮走「仅翻译」以外的主路径；有字幕时可译
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
  // 忙时不重复「处理中」：阶段进度/列表状态已表达；按钮灰显保留动作名
  const primaryLabel = isQueued
    ? '取消排队'
    : isBusy
      ? idlePrimary === '已完成'
        ? '翻译'
        : idlePrimary
      : idlePrimary;

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

  return (
    <div className="m-detail-bar">
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

      <div
        className={`m-detail-actions${isAudioVideo ? ' has-transcribe' : ''}`}
      >
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
