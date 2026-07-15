/**
 * 工作台侧栏 · 客户端式项目行
 * 列表导航感（VS Code / Linear），不是 Web 任务卡片。
 */

import { useCallback, useMemo, memo } from 'react';
import toast from 'react-hot-toast';
import {
  FileText,
  Music,
  Video,
  Play,
  Square,
  Mic,
  Trash2,
  Loader2,
  Copy,
} from 'lucide-react';
import type { SubtitleFileMetadata } from '@/types';
import { ALL_PHASES } from '@/types';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { useFilesStore } from '@/stores/filesStore';
import { getCardBadge } from '@/utils/badgeHelper';
import {
  calcDisplayTranslationProgress,
  countStreamingLines,
  EMPTY_STREAMING_OVERLAY,
  useStreamingOverlayStore,
} from '@/stores/streamingOverlayStore';
import { canRetranscribe } from '@/utils/fileUtils';
import type { ExportFormat } from '@/utils/fileExport';
import { ExportButton } from '@/components/common/ExportButton';
import { copyToClipboard } from '@/utils/appToast';
import { getFailedPhaseError } from '@/utils/uxHelpers';
import { formatFileSize, formatDuration } from '../utils/fileHelpers';

interface SidebarTaskRowProps {
  file: SubtitleFileMetadata;
  selected: boolean;
  isQueued: boolean;
  queuePosition: number;
  isActive: boolean;
  onSelect: (file: SubtitleFileMetadata) => void;
  onStartTranslation: (file: SubtitleFileMetadata) => Promise<void>;
  onExportFormat: (file: SubtitleFileMetadata, format: ExportFormat) => void;
  onDelete: (file: SubtitleFileMetadata) => Promise<void>;
  onTranscribeAndTranslate: (file: SubtitleFileMetadata) => Promise<void>;
  onTranscribe: (fileId: string) => Promise<void>;
  onDequeue: (fileId: string) => void;
}

function TypeIcon({ type }: { type?: SubtitleFileMetadata['fileType'] }) {
  if (type === 'audio') return <Music className="wb-proj-type-svg" strokeWidth={1.75} />;
  if (type === 'video') return <Video className="wb-proj-type-svg" strokeWidth={1.75} />;
  return <FileText className="wb-proj-type-svg" strokeWidth={1.75} />;
}

export const SidebarTaskRow: React.FC<SidebarTaskRowProps> = ({
  file,
  selected,
  isQueued,
  queuePosition,
  isActive,
  onSelect,
  onStartTranslation,
  onExportFormat,
  onDelete,
  onTranscribeAndTranslate,
  onTranscribe,
  onDequeue,
}) => {
  const keytermGroups = useTranscriptionStore((s) => s.keytermGroups);
  const setSelectedKeytermGroupId = useFilesStore((s) => s.setSelectedKeytermGroupId);

  const displayPhases = useMemo(() => {
    return file.fileType === 'srt'
      ? ALL_PHASES.filter((p) => p !== 'converting' && p !== 'transcribing')
      : ALL_PHASES.filter((p) => p !== 'converting');
  }, [file.fileType]);

  const allPhasesDone = useMemo(
    () => displayPhases.every((p) => file.phases[p]?.status === 'completed'),
    [displayPhases, file.phases]
  );

  const badge = getCardBadge(file.phases, displayPhases, isQueued, queuePosition);
  // 侧栏进度轨与流式可见行同步（不写 filesStore）
  const streamOverlay = useStreamingOverlayStore(
    (s) => s.overlays[file.id] ?? EMPTY_STREAMING_OVERLAY
  );
  const pct = useMemo(() => {
    const { percentage } = calcDisplayTranslationProgress(
      file.translatedCount ?? 0,
      file.entryCount ?? 0,
      countStreamingLines(streamOverlay)
    );
    return percentage;
  }, [file.translatedCount, file.entryCount, streamOverlay]);

  const isFailed = badge.color === 'red';
  const failedInfo = useMemo(() => getFailedPhaseError(file.phases), [file.phases]);
  const isDone = badge.color === 'green';
  const isRunning = badge.color === 'blue' || isActive;
  const isWaiting = badge.color === 'yellow' || isQueued;

  const handleCopyError = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!failedInfo?.message) return;
      const ok = await copyToClipboard(failedInfo.message);
      if (ok) toast.success('已复制错误信息', { duration: 1200 });
    },
    [failedInfo]
  );

  const statusTone = isFailed
    ? 'fail'
    : isRunning
      ? 'run'
      : isDone
        ? 'done'
        : isWaiting
          ? 'wait'
          : 'idle';

  const isAudioVideo = file.fileType === 'audio' || file.fileType === 'video';
  const isTranscriptionDone = file.phases.transcribing.status === 'completed';
  const isBusy =
    isActive ||
    isQueued ||
    file.phases.converting.status === 'active' ||
    file.phases.transcribing.status === 'active' ||
    file.phases.translating.status === 'active';

  const canTranscribe = isAudioVideo && !isBusy && canRetranscribe(file) && !allPhasesDone;
  const canRun = useMemo(() => {
    if (isQueued) return true; // becomes cancel
    if (isBusy || allPhasesDone) return false;
    if (isAudioVideo && !isTranscriptionDone) return true; // full pipeline
    if (pct >= 100) return false;
    if (isAudioVideo && !isTranscriptionDone) return false;
    return true;
  }, [isQueued, isBusy, allPhasesDone, isAudioVideo, isTranscriptionDone, pct]);

  const primaryLabel = isQueued
    ? '取消排队'
    : isBusy
      ? '处理中'
      : isFailed
        ? '重试'
        : allPhasesDone
          ? '已完成'
          : isAudioVideo && !isTranscriptionDone
            ? '转译'
            : '翻译';

  const metaLine = useMemo(() => {
    const parts: string[] = [];
    if (file.fileType === 'srt') {
      parts.push(`${file.entryCount ?? 0} 条`);
    } else {
      parts.push(formatFileSize(file.fileSize ?? 0));
      if (file.duration != null && file.duration > 0) {
        parts.push(formatDuration(file.duration));
      }
      if ((file.entryCount ?? 0) > 0) {
        parts.push(`${file.entryCount} 条`);
      }
    }
    if (pct > 0 && pct < 100) parts.push(`${pct}%`);
    return parts.join(' · ');
  }, [file, pct]);

  const handlePrimary = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isQueued) {
        onDequeue(file.id);
        return;
      }
      if (isAudioVideo && !isTranscriptionDone) {
        void onTranscribeAndTranslate(file);
      } else {
        void onStartTranslation(file);
      }
    },
    [
      isQueued,
      isAudioVideo,
      isTranscriptionDone,
      onDequeue,
      onTranscribeAndTranslate,
      onStartTranslation,
      file,
    ]
  );

  const showRail = isRunning || isQueued || (pct > 0 && pct < 100) || isFailed;

  return (
    <div
      role="button"
      tabIndex={0}
      className={`wb-proj ${selected ? 'is-selected' : ''} ${isRunning ? 'is-active' : ''} tone-${statusTone}`}
      onClick={() => onSelect(file)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(file);
        }
      }}
    >
      <div className="wb-proj-row">
        <div className={`wb-proj-ico type-${file.fileType || 'srt'}`} aria-hidden>
          <TypeIcon type={file.fileType} />
        </div>

        <div className="wb-proj-body">
          <div className="wb-proj-title" title={file.name}>
            {file.name}
          </div>
          <div className="wb-proj-sub">
            <span className={`wb-proj-dot tone-${statusTone}`} aria-hidden />
            <span className={`wb-proj-state tone-${statusTone}`}>{badge.text}</span>
            {metaLine ? <span className="wb-proj-meta">· {metaLine}</span> : null}
          </div>
        </div>

        <div className="wb-proj-trail" onClick={(e) => e.stopPropagation()}>
          {/* 进行中指示只放在阶段 chip / 进度条，避免与下方重复转圈 */}
          <div className="wb-proj-hover-acts">
            <ExportButton
              variant="icon"
              disabled={(file.entryCount ?? 0) === 0 || isBusy}
              hasTranslation={(file.translatedCount ?? 0) > 0}
              onSelect={(fmt) => onExportFormat(file, fmt)}
            />
            <button
              type="button"
              className="wb-proj-icon-btn danger"
              title="删除"
              onClick={() => void onDelete(file)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {showRail && (
        <div className={`wb-proj-rail ${isFailed ? 'fail' : ''}`} title={`${pct}%`}>
          <i
            style={{
              width: `${isFailed ? 100 : Math.max(pct, isRunning || isQueued ? 12 : 0)}%`,
            }}
          />
        </div>
      )}

      {/* 失败原因常驻可见（不依赖 hover） */}
      {isFailed && failedInfo && (
        <div
          className="wb-proj-error"
          data-testid="task-error-banner"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="wb-proj-error-text" title={failedInfo.message}>
            {failedInfo.message}
          </span>
          <button
            type="button"
            className="wb-proj-error-copy"
            onClick={(e) => void handleCopyError(e)}
            title="复制错误信息"
            aria-label="复制错误信息"
          >
            <Copy className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* 选中展开：客户端工具条，非 Web 大按钮区 */}
      <div className="wb-proj-panel" onClick={(e) => e.stopPropagation()}>
        <div className="wb-proj-panel-inner">
          <div className="wb-proj-phases">
            {displayPhases.map((phase) => {
              const st = file.phases[phase]?.status;
              const err = file.phases[phase]?.errorMessage;
              const label = phase === 'transcribing' ? '识别' : '翻译';
              return (
                <span
                  key={phase}
                  className={`wb-proj-phase st-${st || 'upcoming'}`}
                  title={
                    st === 'active'
                      ? `${label}中`
                      : st === 'completed'
                        ? `${label}完成`
                        : st === 'failed'
                          ? err?.trim()
                            ? `${label}失败：${err}`
                            : `${label}失败`
                          : label
                  }
                >
                  {st === 'completed' ? (
                    '✓'
                  ) : st === 'failed' ? (
                    '!'
                  ) : st === 'active' ? (
                    <Loader2 className="wb-proj-phase-spin" aria-hidden />
                  ) : (
                    '·'
                  )}
                  <span>{label}</span>
                </span>
              );
            })}
          </div>

          <div className="wb-proj-toolbar">
            {isAudioVideo && keytermGroups.length > 0 && (
              <label className="wb-proj-keyterm">
                <span>热词</span>
                <select
                  value={file.selectedKeytermGroupId ?? ''}
                  onChange={(e) =>
                    setSelectedKeytermGroupId(file.id, e.target.value || null)
                  }
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

            <div className="wb-proj-toolbar-spacer" />

            {isAudioVideo && (
              <button
                type="button"
                className="wb-proj-tool"
                disabled={!canTranscribe}
                title="仅转录"
                onClick={() => void onTranscribe(file.id)}
              >
                <Mic className="w-3.5 h-3.5" />
                <span>转录</span>
              </button>
            )}

            <button
              type="button"
              className={`wb-proj-tool primary ${isQueued ? 'muted' : ''}`}
              disabled={!canRun && !isQueued}
              title={primaryLabel}
              onClick={handlePrimary}
            >
              {/* 忙时不再转圈：阶段 chip 上已有唯一 spinner */}
              {isBusy && !isQueued ? null : isQueued ? (
                <Square className="w-3 h-3" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              <span>{primaryLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const SidebarTaskRowMemo = memo(SidebarTaskRow, (prev, next) => {
  const keys: (keyof SubtitleFileMetadata)[] = [
    'id',
    'name',
    'fileSize',
    'duration',
    'entryCount',
    'translatedCount',
    'tokensUsed',
    'selectedKeytermGroupId',
    'fileType',
  ];
  for (const k of keys) {
    if (prev.file[k] !== next.file[k]) return false;
  }
  if (prev.file.phases !== next.file.phases) return false;
  if (prev.selected !== next.selected) return false;
  if (prev.isQueued !== next.isQueued) return false;
  if (prev.queuePosition !== next.queuePosition) return false;
  if (prev.isActive !== next.isActive) return false;
  return true;
});
