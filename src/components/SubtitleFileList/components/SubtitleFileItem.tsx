import { useCallback, useMemo, memo, useState } from 'react';
import { SubtitleFileMetadata, ALL_PHASES } from '@/types';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { useFilesStore } from '@/stores/filesStore';
import { getCardBadge } from '@/utils/badgeHelper';
import type { ExportFormat } from '@/utils/fileExport';
import { ExportButton } from '@/components/common/ExportButton';
import { FileIcon } from './FileIcon';
import { StepperProgress } from './StepperProgress';
import { FileActionButtons } from './FileActionButtons';
import { formatFileSize, formatDuration } from '../utils/fileHelpers';

interface SubtitleFileItemProps {
  file: SubtitleFileMetadata;
  onEdit: (file: SubtitleFileMetadata) => void;
  /** 点击卡片主体选中任务（工作台右侧展示编辑器） */
  onSelect?: (file: SubtitleFileMetadata) => void;
  selected?: boolean;
  onStartTranslation: (file: SubtitleFileMetadata) => Promise<void>;
  onExportFormat: (file: SubtitleFileMetadata, format: ExportFormat) => void;
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
  onEdit,
  onSelect,
  selected = false,
  onStartTranslation,
  onExportFormat,
  onDelete,
  onTranscribeAndTranslate,
  onTranscribe,
  onDequeue,
  isQueued,
  queuePosition,
  isActive,
}) => {
  // Tooltip 悬停时把整张卡片提升到最上层，避免被下方的 task card 遮挡
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);

  const handleCardClick = useCallback(() => {
    if (onSelect) {
      onSelect(file);
    } else {
      onEdit(file);
    }
  }, [onSelect, onEdit, file]);

  // 热词选择（无全局开关，per-task 选择即生效）
  const keytermGroups = useTranscriptionStore((state) => state.keytermGroups);
  const setSelectedKeytermGroupId = useFilesStore((state) => state.setSelectedKeytermGroupId);

  // 计算 displayPhases（与 StepperProgress 一致：永远不展示 converting）
  const displayPhases = useMemo(() => {
    return file.fileType === 'srt'
      ? ALL_PHASES.filter(p => p !== 'converting' && p !== 'transcribing')
      : ALL_PHASES.filter(p => p !== 'converting');
  }, [file.fileType]);

  // 所有需要展示的阶段都完成了（用于 FileActionButtons 主按钮置灰终态判断）
  const allPhasesDone = useMemo(
    () => displayPhases.every(p => file.phases[p]?.status === 'completed'),
    [displayPhases, file.phases]
  );

  // 使用 getCardBadge 计算 badge 信息
  const badgeInfo = getCardBadge(file.phases, displayPhases, isQueued, queuePosition);
  const badgeClass =
    badgeInfo.color === 'green'
      ? 'bg-[var(--palette-success-soft)] text-[var(--palette-success)]'
      : badgeInfo.color === 'blue'
        ? 'bg-[var(--palette-brand-soft)] text-[var(--wb-brand)]'
        : badgeInfo.color === 'red'
          ? 'bg-[var(--palette-danger-soft)] text-[var(--palette-danger)]'
          : badgeInfo.color === 'yellow'
            ? 'bg-[var(--palette-warning-soft)] text-[var(--palette-warning)]'
            : 'border border-[var(--wb-border)] text-[var(--wb-text-3)] bg-transparent';
  const badgeText = badgeInfo.text;

  // Token count
  const tokens = file.tokensUsed || 0;

  const handleExportFormat = useCallback(
    (format: ExportFormat) => onExportFormat(file, format),
    [file, onExportFormat]
  );
  const handleDelete = useCallback(() => onDelete(file), [file, onDelete]);

  return (
    <div
      className="relative bg-[var(--wb-panel)] rounded-2xl p-3 md:p-3.5 lg:p-5 flex flex-col gap-3 md:gap-5 lg:gap-5 hover:-translate-y-0.5 transition-transform duration-200 will-change-transform cursor-pointer"
      style={{
        boxShadow: selected
          ? '0 0 0 2px var(--palette-brand-soft-strong), 0 2px 12px rgba(0,0,0,0.04)'
          : '0 2px 12px rgba(0,0,0,0.03), 0 0 0 1px rgba(0,0,0,0.02)',
        zIndex: isTooltipVisible ? 50 : 'auto',
      }}
      onClick={handleCardClick}
    >
      {/* 1. Header: file info + status badge */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0 flex-1">
          <FileIcon type={file.fileType} size={20} className="md:hidden" />
          <FileIcon type={file.fileType} size={24} className="hidden md:inline-flex lg:hidden" />
          <FileIcon type={file.fileType} size={32} className="hidden lg:inline-flex" />
          <div className="min-w-0 flex-1">
            <h4
              className="text-xs md:text-sm font-semibold text-[var(--wb-text)] truncate"
              title={file.name}
            >
              {file.name}
            </h4>
            <div className="text-[10px] md:text-xs text-[var(--wb-text-3)] mt-0.5 flex items-center gap-1.5">
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
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--palette-warning)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
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
      <div onClick={(e) => e.stopPropagation()}>
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
          onExportFormat={handleExportFormat}
          onDelete={handleDelete}
        />
      </div>
    </div>
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
      <span className="text-xs text-[var(--wb-text-3)]">热词:</span>
      <select
        value={fileSelectedGroupId ?? ''}
        onChange={handleChange}
        aria-label={`热词分组 (${displayText})`}
        className="text-xs px-2 py-1 rounded-md border border-[var(--wb-border)] bg-[var(--wb-panel)] text-[var(--wb-text-2)] focus:outline-none focus:border-[var(--wb-brand)] cursor-pointer hover:border-[var(--wb-border-strong)] transition-colors"
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
  if (prevProps.selected !== nextProps.selected) return false;

  return true;
});
