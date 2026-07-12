import { useMemo } from 'react';
import { Wand2, Edit3, Trash2 } from 'lucide-react';
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

  // 主按钮文案
  const primaryLabel = isQueued
    ? '取消排队'
    : isBusy
      ? '处理中...'
      : allPhasesDone
        ? '一键转译'
        : isAudioVideo && !isTranscriptionDone
          ? '一键转译'
          : '开始翻译';

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-0 border-t pt-3 md:pt-4" style={{ borderColor: '#E5E5EA' }}>
      {/* Secondary actions: keyterm dropdown, edit, export, delete */}
      <div className="flex items-center gap-2">
        {keytermDropdown}
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="flex items-center justify-center w-8 h-8 rounded-md transition-all duration-200 hover:bg-gray-100 text-gray-500 hover:text-gray-900"
          title="编辑"
        >
          <Edit3 className="w-4 h-4" />
        </button>
        <ExportButton
          variant="icon"
          disabled={(file.entryCount ?? 0) === 0 || isBusy}
          hasTranslation={(file.translatedCount ?? 0) > 0}
          onSelect={onExportFormat}
        />
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-red-50 text-red-500 hover:text-red-600 transition-transform hover:scale-105 active:scale-95"
          title="删除"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Primary actions */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2 md:gap-3">
        {/* Transcribe only (audio/video, always visible — grey when not actionable) */}
        {showTranscribeButton && (
          <button
            onClick={(e) => { e.stopPropagation(); onTranscribe(); }}
            disabled={transcribeButtonDisabled}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-transform ${transcribeButtonDisabled ? '' : 'hover:scale-[1.03] active:scale-[0.96]'}`}
            style={{
              background: transcribeButtonDisabled ? '#F2F2F7' : '#EBF3FF',
              color: transcribeButtonDisabled ? '#86868B' : '#0066FF',
            }}
            onMouseEnter={(e) => { if (!transcribeButtonDisabled) (e.currentTarget.style.background = '#D9E8FF'); }}
            onMouseLeave={(e) => { if (!transcribeButtonDisabled) (e.currentTarget.style.background = '#EBF3FF'); }}
          >
            仅转录
          </button>
        )}

        {/* Primary button: 取消排队 / 处理中 / 一键转译 / 开始翻译（终态全部完成时显示"一键转译"置灰） */}
        {showTranslateButton && (
          <button
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
            className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed w-full md:w-auto"
            style={{
              background: isQueued
                ? '#8E8E93'
                : primaryButtonDisabled
                  ? '#C4C4C4'
                  : (canTranscribeAndTranslate || canTranslate) ? '#0066FF' : '#C4C4C4',
            }}
            onMouseEnter={(e) => { if (!isQueued && !primaryButtonDisabled) (e.currentTarget.style.background = '#005ce6'); }}
            onMouseLeave={(e) => { if (!isQueued && !primaryButtonDisabled) (e.currentTarget.style.background = '#0066FF'); }}
          >
            {isBusy ? (
              <>
                <div
                  className="rounded-full animate-spin"
                  style={{
                    width: 14, height: 14,
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: 'white',
                  }}
                />
                处理中...
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                {primaryLabel}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};
