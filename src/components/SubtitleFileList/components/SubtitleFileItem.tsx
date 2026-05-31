import { useCallback, useMemo, memo } from 'react';
import { motion } from 'framer-motion';
import { SubtitleFileMetadata, ALL_PHASES, type ProgressPhase } from '@/types';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { getCardBadge } from '@/utils/badgeHelper';
import { FileIcon } from './FileIcon';
import { StepperProgress } from './StepperProgress';
import { FileActionButtons } from './FileActionButtons';
import { formatFileSize, formatDuration } from '../utils/fileHelpers';

interface SubtitleFileItemProps {
  file: SubtitleFileMetadata;
  index: number;
  onEdit: (file: SubtitleFileMetadata) => void;
  onStartTranslation: (file: SubtitleFileMetadata) => Promise<void>;
  onExport: (file: SubtitleFileMetadata) => void;
  onDelete: (file: SubtitleFileMetadata) => Promise<void>;
  onTranscribeAndTranslate: (file: SubtitleFileMetadata) => Promise<void>;
  onTranscribe: (fileId: string) => Promise<void>;
  onDequeue: (fileId: string) => void;
  isQueued: boolean;
  queuePosition: number;
  isActive: boolean;
}

export const SubtitleFileItem: React.FC<SubtitleFileItemProps> = ({
  file,
  index,
  onEdit,
  onStartTranslation,
  onExport,
  onDelete,
  onTranscribeAndTranslate,
  onTranscribe,
  onDequeue,
  isQueued,
  queuePosition,
  isActive,
}) => {
  const isTranscribing = file.phases.converting.status === 'active' ||
    file.phases.transcribing.status === 'active';
  const isBusy = isTranscribing || isActive || isQueued;

  // 获取 aiSegmentationEnabled 配置
  const aiSegmentationEnabled = useTranscriptionStore(state => state.aiSegmentationEnabled);

  // 计算 displayPhases（与 StepperProgress 一致）
  const displayPhases = useMemo(() => {
    const basePhases = file.fileType === 'srt'
      ? ALL_PHASES.filter(p => p !== 'converting' && p !== 'transcribing')
      : ALL_PHASES;
    if (file.fileType === 'srt') {
      return aiSegmentationEnabled ? basePhases : basePhases.filter(p => p !== 'splitting');
    }
    return aiSegmentationEnabled ? basePhases : basePhases.filter(p => p !== 'splitting');
  }, [file.fileType, aiSegmentationEnabled]);

  // 使用 getCardBadge 计算 badge 信息
  const badgeInfo = getCardBadge(file.phases, displayPhases, isQueued, queuePosition);
  const badgeClass = badgeInfo.color === 'green'
    ? 'bg-green-50 text-green-600'
    : badgeInfo.color === 'blue'
    ? 'bg-blue-50 text-blue-600'
    : badgeInfo.color === 'red'
    ? 'bg-red-50 text-red-600'
    : badgeInfo.color === 'yellow'
    ? 'bg-amber-100 text-amber-700'
    : 'border border-gray-200 text-gray-500 bg-transparent';
  const badgeText = badgeInfo.text;

  // Token count
  const tokens = file.tokensUsed || 0;

  const handleExport = useCallback(() => onExport(file), [file, onExport]);
  const handleDelete = useCallback(() => onDelete(file), [file, onDelete]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl p-5 flex flex-col gap-5 transition-all duration-400 hover:shadow-lg hover:-translate-y-0.5"
      style={{ boxShadow: '0 2px 12px rgba(0,0,0,0.03), 0 0 0 1px rgba(0,0,0,0.02)' }}
    >
      {/* 1. Header: file info + status badge */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0 flex-1">
          <FileIcon type={file.fileType} />
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold text-gray-900 truncate" title={file.name}>
              {file.name}
            </h4>
            <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
              {file.fileType === 'srt' ? (
                <span>{file.entryCount ?? 0} 条字幕</span>
              ) : (
                <>
                  <span>{formatFileSize(file.fileSize ?? 0)}</span>
                  {file.duration != null && file.duration > 0 && (
                    <>
                      <span>·</span>
                      <span>{formatDuration(file.duration)}</span>
                    </>
                  )}
                </>
              )}
              {tokens > 0 && (
                <span className="inline-flex items-center gap-0.5">
                  ·
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                  </svg>
                  <span>{tokens.toLocaleString()}</span>
                </span>
              )}
            </div>
          </div>
        </div>
        <span className={`px-2.5 py-1 rounded-md text-xs font-medium flex-shrink-0 ${badgeClass}`}>
          {badgeText}
        </span>
      </div>

      {/* 2. Progress area (stepper) */}
      <StepperProgress fileId={file.id} />

      {/* 3. Footer: action buttons */}
      <FileActionButtons
        file={file}
        isTranslating={isActive}
        translationStats={{
          percentage: (file.entryCount ?? 0) > 0
            ? Math.round(((file.translatedCount ?? 0) / (file.entryCount ?? 1)) * 100)
            : 0,
        }}
        isQueued={isQueued}
        queuePosition={queuePosition}
        isActive={isActive}
        onTranscribeAndTranslate={() => onTranscribeAndTranslate(file)}
        onTranscribe={() => onTranscribe(file.id)}
        onDequeue={() => onDequeue(file.id)}
        onStartTranslation={() => onStartTranslation(file)}
        onEdit={() => onEdit(file)}
        onExport={handleExport}
        onDelete={handleDelete}
      />
    </motion.div>
  );
};

export const SubtitleFileItemMemo = memo(SubtitleFileItem, (prevProps, nextProps) => {
  const fileKeys: (keyof SubtitleFileMetadata)[] = [
    'id', 'name', 'fileSize', 'duration',
    'entryCount', 'translatedCount', 'tokensUsed',
  ];

  for (const key of fileKeys) {
    if (prevProps.file[key] !== nextProps.file[key]) return false;
  }

  // Deep compare phases object
  if (prevProps.file.phases !== nextProps.file.phases) return false;

  if (prevProps.isQueued !== nextProps.isQueued) return false;
  if (prevProps.queuePosition !== nextProps.queuePosition) return false;
  if (prevProps.isActive !== nextProps.isActive) return false;

  return true;
});

export default SubtitleFileItemMemo;
