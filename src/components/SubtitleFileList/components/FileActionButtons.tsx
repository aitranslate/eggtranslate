import { useMemo } from 'react';
import { Wand2, Edit3, Trash2, Square } from 'lucide-react';
import { SubtitleFileMetadata } from '@/types';
import { canRetranscribe } from '@/utils/fileUtils';
import { ExportButton } from '@/components/common/ExportButton';
import type { ExportFormat } from '@/utils/fileExport';

interface FileActionButtonsProps {
  file: SubtitleFileMetadata;
  isTranslating: boolean;
  translationStats: {
    percentage: number;
  };
  isQueued: boolean;
  isActive: boolean;
  allPhasesDone: boolean;
  onTranscribeAndTranslate: () => void;
  onTranscribe: () => void;
  onDequeue?: () => void;
  onStartTranslation: () => void;
  onEdit: () => void;
  onExportFormat: (format: ExportFormat) => void;
  onDelete: () => void;
  keytermDropdown?: React.ReactNode;
}

export const FileActionButtons: React.FC<FileActionButtonsProps> = ({
  file,
  isTranslating,
  translationStats,
  isQueued,
  isActive,
  allPhasesDone,
  onTranscribeAndTranslate,
  onTranscribe,
  onDequeue,
  onStartTranslation,
  onEdit,
  onExportFormat,
  onDelete,
  keytermDropdown,
}) => {
  const isTranscribing = useMemo(() =>
    file.phases.converting.status === 'active' ||
    file.phases.transcribing.status === 'active',
    [file.phases.converting.status, file.phases.transcribing.status]
  );

  const isBusy = isTranscribing || isTranslating || isActive || isQueued;
  const isAudioVideo = file.fileType === 'audio' || file.fileType === 'video';
  const isTranscriptionDone = file.phases.transcribing.status === 'completed';

  const canTranscribeAndTranslate = useMemo(() => {
    if (isBusy) return false;
    if (translationStats.percentage === 100) return false;
    if (file.fileType === 'srt') return translationStats.percentage < 100;
    return canRetranscribe(file) || isTranscriptionDone;
  }, [isBusy, translationStats.percentage, file, isTranscriptionDone]);

  const canTranscribe = useMemo(() => {
    if (isBusy) return false;
    if (!isAudioVideo) return false;
    return canRetranscribe(file);
  }, [isBusy, isAudioVideo, file]);

  const canTranslate = useMemo(() => {
    if (isBusy) return false;
    if (isAudioVideo && !isTranscriptionDone) return false;
    if (translationStats.percentage === 100) return false;
    return true;
  }, [isBusy, translationStats.percentage, isAudioVideo, isTranscriptionDone]);

  // Determine primary action button
  // "仅转录" 按钮：audio/video 始终显示（终态置灰，不消失）
  const showTranscribeButton = isAudioVideo;
  // 主按钮：始终显示（终态置灰）
  const showTranslateButton = true;

  // 仅转录按钮的禁用条件：忙、全部完成、不可重新转录
  const transcribeButtonDisabled = !canTranscribe || allPhasesDone;

  // 主按钮的禁用条件：忙以外 + 都完成 + 都不可操作
  const primaryButtonDisabled = isQueued
    ? false
    : isBusy
      ? true
      : allPhasesDone
        ? true
        : !canTranscribeAndTranslate && !canTranslate;

  // 主按钮文案：忙时不写「处理中」（阶段 stepper 已转圈）
  const primaryLabel = isQueued
    ? '取消排队'
    : allPhasesDone
      ? '一键转译'
      : isAudioVideo && !isTranscriptionDone
        ? '一键转译'
        : '开始翻译';

  const padY = 'pt-3 md:pt-4';
  const btnPad = 'px-4 py-2 text-sm';
  const iconBtn = 'w-8 h-8';

  return (
    <div
      className={`flex flex-col gap-2 border-t ${padY} md:flex-row md:items-center md:justify-between md:gap-0`}
      style={{ borderColor: '#E5E5EA' }}
    >
      {/* Secondary actions: keyterm dropdown, edit, export, delete */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {keytermDropdown}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className={`flex items-center justify-center ${iconBtn} rounded-md transition-all duration-200 hover:bg-gray-100 text-gray-500 hover:text-gray-900`}
          title="在编辑器中打开"
        >
          <Edit3 className="w-3.5 h-3.5" />
        </button>
        <ExportButton
          variant="icon"
          disabled={(file.entryCount ?? 0) === 0 || isBusy}
          hasTranslation={(file.translatedCount ?? 0) > 0}
          onSelect={onExportFormat}
        />
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className={`flex items-center justify-center ${iconBtn} rounded-md hover:bg-red-50 text-red-500 hover:text-red-600 transition-transform hover:scale-105 active:scale-95`}
          title="删除"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Primary actions */}
      <div className="flex items-stretch gap-2 flex-col md:flex-row md:items-center md:gap-3">
        {showTranscribeButton && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onTranscribe(); }}
            disabled={transcribeButtonDisabled}
            className={`flex items-center gap-1.5 ${btnPad} rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-transform ${transcribeButtonDisabled ? '' : 'hover:scale-[1.03] active:scale-[0.96]'}`}
            style={{
              background: transcribeButtonDisabled ? 'var(--apple-bg-secondary)' : 'var(--apple-blue-soft)',
              color: transcribeButtonDisabled ? 'var(--apple-text-secondary)' : 'var(--apple-blue)',
              borderRadius: 'var(--apple-radius-control)',
            }}
            onMouseEnter={(e) => {
              if (!transcribeButtonDisabled) {
                e.currentTarget.style.background = 'var(--apple-blue-soft-strong)';
              }
            }}
            onMouseLeave={(e) => {
              if (!transcribeButtonDisabled) {
                e.currentTarget.style.background = 'var(--apple-blue-soft)';
              }
            }}
          >
            仅转录
          </button>
        )}

        {showTranslateButton && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (isQueued) {
                onDequeue?.();
              } else if (isAudioVideo && !isTranscriptionDone) {
                onTranscribeAndTranslate();
              } else {
                onStartTranslation();
              }
            }}
            disabled={primaryButtonDisabled}
            className={`flex items-center justify-center gap-1.5 ${btnPad} font-medium text-white transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed w-full md:w-auto`}
            style={{
              borderRadius: 'var(--apple-radius-button)',
              background: isQueued
                ? 'var(--apple-text-tertiary)'
                : primaryButtonDisabled
                  ? 'var(--apple-border-light)'
                  : canTranscribeAndTranslate || canTranslate
                    ? 'var(--apple-blue)'
                    : 'var(--apple-border-light)',
            }}
            onMouseEnter={(e) => {
              if (!isQueued && !primaryButtonDisabled) {
                e.currentTarget.style.background = 'var(--apple-blue-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isQueued && !primaryButtonDisabled) {
                e.currentTarget.style.background = 'var(--apple-blue)';
              }
            }}
          >
            {isQueued ? (
              <>
                <Square className="w-3.5 h-3.5" fill="currentColor" />
                取消排队
              </>
            ) : (
              <>
                <Wand2 className="w-3.5 h-3.5" />
                {primaryLabel}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};
