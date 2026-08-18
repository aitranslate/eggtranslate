/**
 * 移动端项目行：点主体选中，点箭头进编辑器。命令在列表底坞。
 */

import { memo, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { ChevronRight, Copy, FileText, Music, Video } from 'lucide-react';
import type { SubtitleFileMetadata } from '@/types';
import { getFailedPhaseError, shouldShowTaskErrorDetail } from '@/utils/uxHelpers';
import { copyToClipboard } from '@/utils/appToast';
import { formatFileSize, formatDuration } from '@/components/SubtitleFileList/utils/fileHelpers';
import { TaskPhaseChips } from '@/components/common/TaskPhaseChips';
import { useTaskDisplayModel } from '@/hooks/useTaskDisplayModel';

interface MobileTaskCardProps {
  file: SubtitleFileMetadata;
  selected: boolean;
  isQueued: boolean;
  queuePosition: number;
  isActive: boolean;
  onSelect: (file: SubtitleFileMetadata) => void;
  onOpen: (file: SubtitleFileMetadata) => void;
}

function TypeIcon({ type }: { type?: SubtitleFileMetadata['fileType'] }) {
  if (type === 'audio') return <Music className="h-4 w-4" strokeWidth={1.75} />;
  if (type === 'video') return <Video className="h-4 w-4" strokeWidth={1.75} />;
  return <FileText className="h-4 w-4" strokeWidth={1.75} />;
}

export const MobileTaskCard = memo(function MobileTaskCard({
  file,
  selected,
  isQueued,
  queuePosition,
  isActive,
  onSelect,
  onOpen,
}: MobileTaskCardProps) {
  const { displayPhases, translateCounts, badge, isBusy, pct } = useTaskDisplayModel(
    file,
    { isQueued, queuePosition, isActive }
  );

  const isFailed = badge.color === 'red';
  const failedInfo = useMemo(() => getFailedPhaseError(file.phases), [file.phases]);
  const isDone = badge.color === 'green';
  const isRunning = badge.color === 'blue' || isActive;
  const isWaiting = badge.color === 'yellow' || isQueued;

  const tone = isFailed
    ? 'fail'
    : isRunning
      ? 'run'
      : isDone
        ? 'done'
        : isWaiting
          ? 'wait'
          : 'idle';

  const meta = useMemo(() => {
    const parts: string[] = [];
    if (file.fileType === 'srt') {
      parts.push(`${file.entryCount ?? 0} 条`);
    } else {
      parts.push(formatFileSize(file.fileSize ?? 0));
      if (file.duration != null && file.duration > 0) {
        parts.push(formatDuration(file.duration));
      }
      if ((file.entryCount ?? 0) > 0) parts.push(`${file.entryCount} 条`);
    }
    return parts.join(' · ');
  }, [file]);

  const handleCopyError = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!failedInfo?.message) return;
      const ok = await copyToClipboard(failedInfo.message);
      if (ok) toast.success('已复制错误信息', { duration: 1200 });
    },
    [failedInfo]
  );

  const handleOpen = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onOpen(file);
    },
    [onOpen, file]
  );

  const showRail = !isFailed && (isRunning || isQueued || (pct > 0 && pct < 100));
  const showBadgeText = isQueued || isFailed || (isBusy && badge.text !== '处理中');

  return (
    <div
      className={`m-task tone-${tone}${selected ? ' is-selected' : ''}`}
      data-testid="mobile-task-card"
      data-selected={selected ? 'true' : 'false'}
      onClick={() => onSelect(file)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(file);
        }
      }}
      tabIndex={0}
    >
      <div className={`m-task-ico type-${file.fileType || 'srt'}`} aria-hidden>
        <TypeIcon type={file.fileType} />
      </div>
      <div className="m-task-body">
        <div className="m-task-title">{file.name}</div>
        <div className="m-task-sub">
          <span className={`m-task-dot tone-${tone}`} aria-hidden />
          {meta ? <span className="m-task-meta">{meta}</span> : null}
          {showBadgeText ? <span className="m-task-badge">{badge.text}</span> : null}
        </div>
        {displayPhases.length > 0 && (
          <TaskPhaseChips
            className="m-task-phases"
            phases={displayPhases}
            filePhases={file.phases}
            translated={translateCounts.translated}
            total={translateCounts.total}
          />
        )}
        {isFailed && shouldShowTaskErrorDetail(failedInfo) && failedInfo && (
          <div
            className="m-task-error"
            data-testid="task-error-banner"
            title={failedInfo.message}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="m-task-error-text">{failedInfo.message}</span>
            <button
              type="button"
              className="m-task-error-copy"
              data-testid="task-error-copy"
              onClick={(e) => void handleCopyError(e)}
              title="复制错误信息"
              aria-label="复制错误信息"
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
        )}
        {showRail && (
          <div className="m-task-rail">
            <i
              style={{
                width: `${Math.max(pct, isRunning || isQueued ? 12 : 0)}%`,
              }}
            />
          </div>
        )}
      </div>
      <button
        type="button"
        className="m-task-open"
        aria-label="打开字幕"
        data-testid="mobile-task-open"
        onClick={handleOpen}
      >
        <ChevronRight className="m-task-chevron" aria-hidden />
      </button>
    </div>
  );
});
