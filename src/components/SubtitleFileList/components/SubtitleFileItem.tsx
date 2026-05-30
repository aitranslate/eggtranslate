import { useCallback, useMemo, memo } from 'react';
import { motion } from 'framer-motion';
import { SubtitleFileMetadata } from '@/types';
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
  isTranslatingGlobally: boolean;
  currentTranslatingFileId: string | null;
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
  isTranslatingGlobally,
  currentTranslatingFileId,
}) => {
  const isTranscribing = file.phases.converting.status === 'active' ||
    file.phases.transcribing.status === 'active';
  const isBusy = isTranscribing || (currentTranslatingFileId === file.id);

  // Derive card-level status from phases
  const hasFailedPhase = useMemo(() =>
    file.phases.converting.status === 'failed' ||
    file.phases.transcribing.status === 'failed' ||
    file.phases.translating.status === 'failed' ||
    file.phases.splitting.status === 'failed',
    [file.phases]
  );

  const cardStatus = useMemo(() => {
    if (hasFailedPhase) return 'failed';
    if (isBusy) return 'active';
    const entryCount = file.entryCount ?? 0;
    const translatedCount = file.translatedCount ?? 0;
    if (entryCount > 0 && translatedCount >= entryCount) return 'completed';
    return 'idle';
  }, [isBusy, hasFailedPhase, file.entryCount, file.translatedCount]);

  const badgeClass = cardStatus === 'active'
    ? 'bg-blue-50 text-blue-600'
    : cardStatus === 'completed'
    ? 'bg-green-50 text-green-600'
    : cardStatus === 'failed'
    ? 'bg-red-50 text-red-600'
    : 'border border-gray-200 text-gray-500 bg-transparent';

  const badgeText = cardStatus === 'active'
    ? '处理中'
    : cardStatus === 'completed'
    ? '已完成'
    : cardStatus === 'failed'
    ? '失败'
    : '未开始';

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
        isTranslating={currentTranslatingFileId === file.id}
        translationStats={{
          percentage: (file.entryCount ?? 0) > 0
            ? Math.round(((file.translatedCount ?? 0) / (file.entryCount ?? 1)) * 100)
            : 0,
        }}
        isTranslatingGlobally={isTranslatingGlobally}
        currentTranslatingFileId={currentTranslatingFileId}
        onTranscribeAndTranslate={() => onTranscribeAndTranslate(file)}
        onTranscribe={() => onTranscribe(file.id)}
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
    'entryCount', 'translatedCount', 'tokensUsed', 'entriesVersion',
  ];

  for (const key of fileKeys) {
    if (prevProps.file[key] !== nextProps.file[key]) return false;
  }

  // Deep compare phases object
  if (prevProps.file.phases !== nextProps.file.phases) return false;

  if (prevProps.isTranslatingGlobally !== nextProps.isTranslatingGlobally) return false;
  if (prevProps.currentTranslatingFileId !== nextProps.currentTranslatingFileId) return false;

  return true;
});

export default SubtitleFileItemMemo;
