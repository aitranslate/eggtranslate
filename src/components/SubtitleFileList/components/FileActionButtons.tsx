import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Languages, Mic, Wand2, Edit3, Download, Trash2 } from 'lucide-react';
import { SubtitleFileMetadata } from '@/types';
import { canRetranscribe } from '@/utils/fileUtils';

interface FileActionButtonsProps {
  file: SubtitleFileMetadata;
  isTranslating: boolean;
  translationStats: {
    percentage: number;
  };
  isQueued: boolean;
  queuePosition: number;
  isActive: boolean;
  allPhasesDone: boolean;
  onTranscribeAndTranslate: () => void;
  onTranscribe: () => void;
  onDequeue?: () => void;
  onStartTranslation: () => void;
  onEdit: () => void;
  onExport: () => void;
  onDelete: () => void;
  keytermDropdown?: React.ReactNode;
}

export const FileActionButtons: React.FC<FileActionButtonsProps> = ({
  file,
  isTranslating,
  translationStats,
  isQueued,
  queuePosition,
  isActive,
  allPhasesDone,
  onTranscribeAndTranslate,
  onTranscribe,
  onDequeue,
  onStartTranslation,
  onEdit,
  onExport,
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
  const splittingFailed = file.phases.splitting.status === 'failed';

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
    // 允许重试：断句失败时（翻译可能已100%），仍可重新触发整个流程
    if (splittingFailed) return true;
    if (translationStats.percentage === 100) return false;
    return true;
  }, [isBusy, translationStats.percentage, isAudioVideo, isTranscriptionDone, splittingFailed]);

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
    <div className="flex items-center justify-between border-t pt-4" style={{ borderColor: '#E5E5EA' }}>
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
        <motion.button
          onClick={(e) => { e.stopPropagation(); onExport(); }}
          disabled={(file.entryCount ?? 0) === 0 || isBusy}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
          className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-gray-100 text-gray-500 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed"
          title="导出"
        >
          <Download className="w-4 h-4" />
        </motion.button>
        <motion.button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
          className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-red-50 text-red-500 hover:text-red-600"
          title="删除"
        >
          <Trash2 className="w-4 h-4" />
        </motion.button>
      </div>

      {/* Primary actions */}
      <div className="flex items-center gap-3">
        {/* Transcribe only (audio/video, always visible — grey when not actionable) */}
        {showTranscribeButton && (
          <motion.button
            onClick={(e) => { e.stopPropagation(); onTranscribe(); }}
            disabled={transcribeButtonDisabled}
            whileHover={!transcribeButtonDisabled ? { scale: 1.03 } : undefined}
            whileTap={!transcribeButtonDisabled ? { scale: 0.96 } : undefined}
            transition={{ type: 'spring', stiffness: 400, damping: 18 }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: transcribeButtonDisabled ? '#F2F2F7' : '#EBF3FF',
              color: transcribeButtonDisabled ? '#86868B' : '#0066FF',
            }}
            onMouseEnter={(e) => { if (!transcribeButtonDisabled) (e.currentTarget.style.background = '#D9E8FF'); }}
            onMouseLeave={(e) => { if (!transcribeButtonDisabled) (e.currentTarget.style.background = '#EBF3FF'); }}
          >
            仅转录
          </motion.button>
        )}

        {/* Primary button: 取消排队 / 处理中 / 一键转译 / 开始翻译（终态全部完成时显示"一键转译"置灰） */}
        {showTranslateButton && (
          <motion.button
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
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
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
          </motion.button>
        )}
      </div>
    </div>
  );
};
