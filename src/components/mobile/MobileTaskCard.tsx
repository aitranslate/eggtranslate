/**
 * 移动端项目行：轻量列表，操作放详情页底栏
 */

import { memo, useMemo } from 'react';
import { ChevronRight, FileText, Music, Video, Loader2 } from 'lucide-react';
import type { SubtitleFileMetadata } from '@/types';
import { ALL_PHASES } from '@/types';
import { getCardBadge } from '@/utils/badgeHelper';
import { formatFileSize, formatDuration } from '@/components/SubtitleFileList/utils/fileHelpers';

interface MobileTaskCardProps {
  file: SubtitleFileMetadata;
  isQueued: boolean;
  queuePosition: number;
  isActive: boolean;
  onOpen: (file: SubtitleFileMetadata) => void;
}

function TypeIcon({ type }: { type?: SubtitleFileMetadata['fileType'] }) {
  if (type === 'audio') return <Music className="h-4 w-4" strokeWidth={1.75} />;
  if (type === 'video') return <Video className="h-4 w-4" strokeWidth={1.75} />;
  return <FileText className="h-4 w-4" strokeWidth={1.75} />;
}

export const MobileTaskCard = memo(function MobileTaskCard({
  file,
  isQueued,
  queuePosition,
  isActive,
  onOpen,
}: MobileTaskCardProps) {
  const displayPhases = useMemo(() => {
    return file.fileType === 'srt'
      ? ALL_PHASES.filter((p) => p !== 'converting' && p !== 'transcribing')
      : ALL_PHASES.filter((p) => p !== 'converting');
  }, [file.fileType]);

  const badge = getCardBadge(file.phases, displayPhases, isQueued, queuePosition);
  const pct =
    (file.entryCount ?? 0) > 0
      ? Math.round(((file.translatedCount ?? 0) / (file.entryCount ?? 1)) * 100)
      : 0;

  const isFailed = badge.color === 'red';
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
    if (pct > 0) parts.push(`${pct}%`);
    return parts.join(' · ');
  }, [file, pct]);

  return (
    <button
      type="button"
      className={`m-task tone-${tone}`}
      onClick={() => onOpen(file)}
    >
      <div className={`m-task-ico type-${file.fileType || 'srt'}`} aria-hidden>
        {isRunning ? (
          <Loader2 className="h-4 w-4 m-spin" />
        ) : (
          <TypeIcon type={file.fileType} />
        )}
      </div>
      <div className="m-task-body">
        <div className="m-task-title">{file.name}</div>
        <div className="m-task-sub">
          <span className={`m-task-dot tone-${tone}`} aria-hidden />
          <span className={`m-task-state tone-${tone}`}>{badge.text}</span>
          {meta ? <span className="m-task-meta">· {meta}</span> : null}
        </div>
        {(isRunning || isQueued || (pct > 0 && pct < 100) || isFailed) && (
          <div className={`m-task-rail ${isFailed ? 'fail' : ''}`}>
            <i
              style={{
                width: `${isFailed ? 100 : Math.max(pct, isRunning || isQueued ? 12 : 0)}%`,
              }}
            />
          </div>
        )}
      </div>
      <ChevronRight className="m-task-chevron" aria-hidden />
    </button>
  );
});
