import { useCallback, useMemo, memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SubtitleFileMetadata, ALL_PHASES, type ProgressPhase } from '@/types';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { useFilesStore } from '@/stores/filesStore';
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

  // Tooltip 悬停时把整张卡片提升到最上层，避免被下方的 task card 遮挡
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);

  // 获取 aiSegmentationEnabled 配置
  const aiSegmentationEnabled = useTranscriptionStore(state => state.aiSegmentationEnabled);

  // 热词选择（无全局开关，per-task 选择即生效）
  const keytermGroups = useTranscriptionStore((state) => state.keytermGroups);
  const setSelectedKeytermGroupId = useFilesStore((state) => state.setSelectedKeytermGroupId);

  // 计算 displayPhases（与 StepperProgress 一致：永远不展示 converting）
  const displayPhases = useMemo(() => {
    const basePhases = file.fileType === 'srt'
      ? ALL_PHASES.filter(p => p !== 'converting' && p !== 'transcribing')
      : ALL_PHASES.filter(p => p !== 'converting');
    return aiSegmentationEnabled ? basePhases : basePhases.filter(p => p !== 'splitting');
  }, [file.fileType, aiSegmentationEnabled]);

  // 所有需要展示的阶段都完成了（用于 FileActionButtons 的 "一键转译置灰" 终态判断）
  const allPhasesDone = useMemo(
    () => displayPhases.every(p => file.phases[p]?.status === 'completed'),
    [displayPhases, file.phases]
  );

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
      variants={{
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 220, damping: 24 } },
      }}
      whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)' }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className="relative bg-white rounded-2xl p-3 md:p-3.5 flex flex-col gap-3 md:gap-5"
      style={{
        boxShadow: '0 2px 12px rgba(0,0,0,0.03), 0 0 0 1px rgba(0,0,0,0.02)',
        zIndex: isTooltipVisible ? 50 : 'auto',
      }}
    >
      {/* 1. Header: file info + status badge */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0 flex-1">
          <FileIcon type={file.fileType} size={20} className="md:hidden" />
          <FileIcon type={file.fileType} size={24} className="hidden md:inline-flex lg:hidden" />
          <FileIcon type={file.fileType} size={32} className="hidden lg:inline-flex" />
          <div className="min-w-0 flex-1">
            <h4 className="text-xs md:text-sm font-semibold text-gray-900 truncate" title={file.name}>
              {file.name}
            </h4>
            <div className="text-[10px] md:text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
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
      <StepperProgress
        fileId={file.id}
        onTooltipVisibleChange={setIsTooltipVisible}
      />

      {/* 3. Footer: action buttons (keyterm dropdown slots into secondary group) */}
      <FileActionButtons
        file={file}
        isTranslating={isActive}
        allPhasesDone={allPhasesDone}
        translationStats={{
          percentage: (file.entryCount ?? 0) > 0
            ? Math.round(((file.translatedCount ?? 0) / (file.entryCount ?? 1)) * 100)
            : 0,
        }}
        isQueued={isQueued}
        queuePosition={queuePosition}
        isActive={isActive}
        keytermDropdown={
          <KeytermDropdown
            fileId={file.id}
            fileSelectedGroupId={file.selectedKeytermGroupId}
            keytermGroups={keytermGroups.map(g => ({ id: g.id, name: g.name }))}
            onChange={(groupId) => setSelectedKeytermGroupId(file.id, groupId)}
          />
        }
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

interface KeytermDropdownProps {
  fileId: string;
  fileSelectedGroupId: string | null;
  keytermGroups: { id: string; name: string }[];
  onChange: (groupId: string | null) => void;
}

const KeytermDropdown: React.FC<KeytermDropdownProps> = ({
  fileSelectedGroupId,
  keytermGroups,
  onChange,
}) => {
  const selectedGroup = keytermGroups.find((g) => g.id === fileSelectedGroupId);
  const displayText = selectedGroup ? selectedGroup.name : '不使用';

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value === '' ? null : e.target.value);
  };

  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <span className="text-xs text-gray-500">热词:</span>
      <select
        value={fileSelectedGroupId ?? ''}
        onChange={handleChange}
        aria-label={`热词分组 (${displayText})`}
        className="text-xs px-2 py-1 rounded-md border border-gray-200 bg-white text-gray-700 focus:outline-none focus:border-blue-500 cursor-pointer hover:border-gray-300 transition-colors"
      >
        <option value="">不使用</option>
        {keytermGroups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>
    </div>
  );
};

export const SubtitleFileItemMemo = memo(SubtitleFileItem, (prevProps, nextProps) => {
  const fileKeys: (keyof SubtitleFileMetadata)[] = [
    'id', 'name', 'fileSize', 'duration',
    'entryCount', 'translatedCount', 'tokensUsed',
    'selectedKeytermGroupId',
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
