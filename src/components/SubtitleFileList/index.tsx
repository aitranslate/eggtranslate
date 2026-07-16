import React, { useState, useCallback, useMemo } from 'react';
import { Trash2, Play, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { downloadZipFile, type ExportFormat } from '@/utils/fileExport';
import { exportFile, exportAllPackage, exportAllFormat } from '@/services/SubtitleExporter';
import { ExportButton } from '@/components/common/ExportButton';
import { useFiles } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { removeFile, clearAll } from '@/services/filesService';
import { dequeueTask } from '@/services/queueService';
import {
  startAllUncompleted,
  startFullTask,
  startTranscribeTask,
  startTranslateTask,
} from '@/services/startTask';
import { SubtitleFileMetadata } from '@/types';
import { SubtitleFileItemMemo as SubtitleFileItem } from './components/SubtitleFileItem';
import { SidebarTaskRowMemo as SidebarTaskRow } from './components/SidebarTaskRow';
import { ConfirmDialog } from '../ConfirmDialog';
import { useErrorHandler } from '@/hooks/useErrorHandler';

interface SubtitleFileListProps {
  className?: string;
  /** @deprecated 请用 onSelectFile；保留兼容 */
  onEditFile?: (file: SubtitleFileMetadata) => void;
  onSelectFile?: (file: SubtitleFileMetadata) => void;
  selectedFileId?: string | null;
  variant?: 'default' | 'sidebar';
  /** 侧栏：导入文件（与批量操作同一行） */
  onImport?: () => void;
  /** 侧栏导入快捷键提示，如 ⌘+O */
  importShortcut?: string;
}

export const SubtitleFileList: React.FC<SubtitleFileListProps> = ({
  className,
  onEditFile,
  onSelectFile,
  selectedFileId = null,
  variant = 'default',
  onImport,
  importShortcut,
}) => {
  const files = useFiles();
  const taskQueue = useQueueStore((state) => state.taskQueue);
  const activeTaskId = useQueueStore((state) => state.activeTaskId);

  const queueMeta = useMemo(() => {
    const map = new Map<string, number>();
    taskQueue.forEach((id, i) => map.set(id, i + 1));
    return map;
  }, [taskQueue]);

  const { handleError } = useErrorHandler();

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<SubtitleFileMetadata | null>(null);

  const handleOpen = useCallback(
    (file: SubtitleFileMetadata) => {
      if (onSelectFile) onSelectFile(file);
      else onEditFile?.(file);
    },
    [onSelectFile, onEditFile]
  );

  const handleStartAll = useCallback(() => {
    if (files.length === 0) return;
    startAllUncompleted();
  }, [files]);

  const handleClearAll = useCallback(async () => {
    if (files.length === 0) return;
    setShowClearConfirm(true);
  }, [files]);

  const handleConfirmClear = useCallback(async () => {
    try {
      await clearAll();
      toast.success('所有文件已清空');
    } catch (error) {
      handleError(error, {
        context: { operation: '清空所有数据' }
      });
    } finally {
      setShowClearConfirm(false);
    }
  }, [handleError]);

  const handleDeleteFile = useCallback(async (file: SubtitleFileMetadata) => {
    setFileToDelete(file);
    setShowDeleteConfirm(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!fileToDelete) return;

    try {
      await removeFile(fileToDelete.id);
    } catch (error) {
      handleError(error, {
        context: { operation: '删除文件', fileName: fileToDelete.name }
      });
    } finally {
      setFileToDelete(null);
    }
  }, [fileToDelete, handleError]);

  const handleExportFile = useCallback(async (file: SubtitleFileMetadata, format: ExportFormat) => {
    try {
      await exportFile(file.taskId, file.name, format);
      toast.success('导出成功');
    } catch (error) {
      handleError(error, {
        context: { operation: '导出', fileName: file.name }
      });
    }
  }, [handleError]);

  const handleExportAll = useCallback(async (format: ExportFormat) => {
    const exportableFiles = files.filter(f => (f.entryCount ?? 0) > 0);
    if (exportableFiles.length === 0) {
      toast.error('没有可导出的文件');
      return;
    }

    const taskIds = exportableFiles.map(f => f.taskId);

    try {
      if (format === 'package') {
        const blob = await exportAllPackage(taskIds);
        downloadZipFile(blob, '字幕导出_全部.zip');
        toast.success(`已打包 ${exportableFiles.length} 个文件`);
      } else {
        const skipped = await exportAllFormat(taskIds, format);
        const exported = exportableFiles.length - skipped;
        if (exported === 0) {
          toast.error('没有可导出的文件（可能均未翻译）');
        } else if (skipped > 0) {
          toast.success(`已导出 ${exported} 个文件，跳过 ${skipped} 个未翻译文件`);
        } else {
          toast.success(`已导出 ${exported} 个文件`);
        }
      }
    } catch (error) {
      handleError(error, {
        context: { operation: '批量导出' }
      });
    }
  }, [files, handleError]);

  const hasAnyTranslated = files.some(f => (f.translatedCount ?? 0) > 0);
  const isSidebar = variant === 'sidebar';
  const hasFiles = files.length > 0;

  // 非侧栏且无文件时不渲染
  if (!isSidebar && !hasFiles) {
    return null;
  }

  const importTitle = importShortcut ? `导入文件（${importShortcut}）` : '导入文件';

  return (
    <div className={className ?? (isSidebar ? 'wb-task-list-root' : undefined)}>
      {/* 侧栏：标题 + 操作同一行  [+] [全部开始] [导出] [清空] */}
      {isSidebar && (
        <div className="wb-tasks-head">
          <div className="wb-tasks-head-main">
            <h2>项目</h2>
            {hasFiles && <span className="wb-tasks-count">{files.length}</span>}
          </div>
          <div className="wb-tasks-actions" role="toolbar" aria-label="项目操作">
            {onImport && (
              <button
                type="button"
                className="wb-tasks-import"
                onClick={(e) => {
                  e.stopPropagation();
                  onImport();
                }}
                title={importTitle}
                aria-label="导入文件"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
              </button>
            )}
            {hasFiles && (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartAll();
                  }}
                  className="wb-proj-list-btn primary"
                >
                  <Play className="h-3 w-3" />
                  全部开始
                </button>
                <ExportButton
                  variant="icon"
                  disabled={!hasFiles}
                  hasTranslation={hasAnyTranslated}
                  onSelect={handleExportAll}
                  title="批量导出"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleClearAll();
                  }}
                  className="wb-tasks-export-btn"
                  title="清空全部"
                  aria-label="清空全部"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {!isSidebar && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="apple-heading-medium">文件列表</h3>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-sm text-gray-600">共 {files.length} 个文件</div>
            <button
              type="button"
              onClick={handleStartAll}
              disabled={files.length === 0}
              className="apple-button apple-button-sm"
            >
              <Play className="h-4 w-4" />
              <span>全部开始</span>
            </button>
            <ExportButton
              variant="button"
              disabled={files.length === 0}
              hasTranslation={hasAnyTranslated}
              onSelect={handleExportAll}
            />
            <button
              type="button"
              onClick={handleClearAll}
              disabled={files.length === 0}
              className="apple-button apple-button-sm apple-button-secondary"
            >
              <Trash2 className="h-4 w-4" />
              <span>清空</span>
            </button>
          </div>
        </div>
      )}

      {isSidebar && !hasFiles ? (
        <div className="wb-task-list-empty">暂无项目</div>
      ) : (
        <div className={isSidebar ? 'wb-task-list' : undefined}>
          <div className={isSidebar ? 'wb-proj-list' : 'space-y-4'}>
            {files.map((file) => {
              const queuePosition = queueMeta.get(file.id) ?? 0;
              const isActive = activeTaskId === file.id;
              const isQueued = queuePosition > 0 && !isActive;

              if (isSidebar) {
                return (
                  <SidebarTaskRow
                    key={file.id}
                    file={file}
                    selected={selectedFileId === file.id}
                    onSelect={handleOpen}
                    onStartTranslation={async () => {
                      startTranslateTask(file.id);
                    }}
                    onExportFormat={handleExportFile}
                    onDelete={handleDeleteFile}
                    onTranscribeAndTranslate={async () => {
                      startFullTask(file.id);
                    }}
                    onTranscribe={async () => {
                      startTranscribeTask(file.id);
                    }}
                    onDequeue={() => dequeueTask(file.id)}
                    isQueued={isQueued}
                    queuePosition={queuePosition}
                    isActive={isActive}
                  />
                );
              }

              return (
                <SubtitleFileItem
                  key={file.id}
                  file={file}
                  selected={selectedFileId === file.id}
                  onSelect={handleOpen}
                  onEdit={handleOpen}
                  onStartTranslation={async () => {
                    startTranslateTask(file.id);
                  }}
                  onExportFormat={handleExportFile}
                  onDelete={handleDeleteFile}
                  onTranscribeAndTranslate={async () => {
                    startFullTask(file.id);
                  }}
                  onTranscribe={async () => {
                    startTranscribeTask(file.id);
                  }}
                  onDequeue={() => dequeueTask(file.id)}
                  isQueued={isQueued}
                  queuePosition={queuePosition}
                  isActive={isActive}
                />
              );
            })}
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleConfirmClear}
        title="清空全部项目？"
        message={`将移除列表中的 ${files.length} 个项目，且不可恢复。`}
        confirmText="清空"
        tone="danger"
      />

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setFileToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
        title="删除项目？"
        detail={fileToDelete?.name}
        message="将从列表中移除，且不可恢复。"
        confirmText="删除"
        tone="danger"
      />
    </div>
  );
};
