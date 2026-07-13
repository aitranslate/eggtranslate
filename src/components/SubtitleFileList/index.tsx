import React, { useState, useCallback, useMemo } from 'react';
import { Trash2, Play } from 'lucide-react';
import toast from 'react-hot-toast';
import { downloadZipFile, type ExportFormat } from '@/utils/fileExport';
import { exportFile, exportAllPackage, exportAllFormat } from '@/services/SubtitleExporter';
import { ExportButton } from '@/components/common/ExportButton';
import { useFiles, useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { removeFile, clearAll } from '@/services/filesService';
import { enqueueTask, dequeueTask, enqueueAllUncompleted } from '@/services/queueService';
import { SubtitleFileMetadata } from '@/types';
import { SubtitleFileItemMemo as SubtitleFileItem } from './components/SubtitleFileItem';
import { ConfirmDialog } from '../ConfirmDialog';
import { SettingsModal } from '../SettingsModal';
import { useErrorHandler } from '@/hooks/useErrorHandler';

interface SubtitleFileListProps {
  className?: string;
  onEditFile: (file: SubtitleFileMetadata) => void;
}

export const SubtitleFileList: React.FC<SubtitleFileListProps> = ({
  className,
  onEditFile
}) => {
  const files = useFiles();
  const taskQueue = useQueueStore((state) => state.taskQueue);
  const activeTaskId = useQueueStore((state) => state.activeTaskId);

  // O(1) 队列位置查询，避免列表项多时 indexOf/includes 形成 O(n^2)
  const queueMeta = useMemo(() => {
    const map = new Map<string, number>();
    taskQueue.forEach((id, i) => map.set(id, i + 1));
    return map;
  }, [taskQueue]);

  const { handleError } = useErrorHandler();

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<SubtitleFileMetadata | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleStartAll = useCallback(() => {
    if (files.length === 0) return;
    enqueueAllUncompleted();
  }, [files]);

  const handleSettingsClose = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

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
    // 收集有条目的文件（可导出）
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

  // 批量导出按钮：是否有任意文件已翻译（控制译文/双语菜单项是否可点）
  const hasAnyTranslated = files.some(f => (f.translatedCount ?? 0) > 0);

  if (files.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <div>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="apple-heading-medium">
              文件列表
            </h3>
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-600">
                共 {files.length} 个文件
              </div>
              <button
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
                onClick={handleClearAll}
                disabled={files.length === 0}
                className="apple-button apple-button-sm apple-button-secondary"
              >
                <Trash2 className="h-4 w-4" />
                <span>清空</span>
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {files.map((file) => {
              const queuePosition = queueMeta.get(file.id) ?? 0;
              const isActive = activeTaskId === file.id;
              const isQueued = queuePosition > 0 && !isActive;

              return (
                <SubtitleFileItem
                  key={file.id}
                  file={file}
                  onEdit={onEditFile}
                  onStartTranslation={async () => {
                    useFilesStore.getState().setWorkflow(file.id, 'translate');
                    enqueueTask(file.id);
                  }}
                  onExportFormat={handleExportFile}
                  onDelete={handleDeleteFile}
                  onTranscribeAndTranslate={async () => {
                    useFilesStore.getState().setWorkflow(file.id, 'full');
                    enqueueTask(file.id);
                  }}
                  onTranscribe={async () => {
                    useFilesStore.getState().setWorkflow(file.id, 'transcribe');
                    enqueueTask(file.id);
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
      </div>

      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleConfirmClear}
        title="确认清空"
        message={`确定要清空所有 ${files.length} 个文件吗？此操作不可恢复。`}
        confirmText="确认清空"
        confirmButtonClass="bg-red-500 hover:bg-red-600 text-white"
      />

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setFileToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
        title="确认删除"
        message={fileToDelete ? `确定要删除文件 "${fileToDelete.name}" 吗？此操作不可恢复。` : ''}
        confirmText="确认删除"
        confirmButtonClass="bg-red-500 hover:bg-red-600 text-white"
      />

      {isSettingsOpen && (
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={handleSettingsClose}
        />
      )}
    </div>
  );
};
