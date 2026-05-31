import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { downloadZipFile } from '@/utils/fileExport';
import { exportTaskZip, getBaseName } from '@/services/SubtitleExporter';
import { useSubtitleStore, useFiles, useQueueState } from '@/stores/subtitleStore';
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
  const removeFile = useSubtitleStore((state) => state.removeFile);
  const clearAllData = useSubtitleStore((state) => state.clearAll);
  const { taskQueue, activeTaskId } = useQueueState();
  const enqueueTask = useSubtitleStore((state) => state.enqueueTask);
  const dequeueTask = useSubtitleStore((state) => state.dequeueTask);
  const enqueueAllUncompleted = useSubtitleStore((state) => state.enqueueAllUncompleted);

  const { handleError } = useErrorHandler();

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<SubtitleFileMetadata | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleStartAll = useCallback(() => {
    if (files.length === 0) return;
    enqueueAllUncompleted();
  }, [files, enqueueAllUncompleted]);

  const handleSettingsClose = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const handleClearAll = useCallback(async () => {
    if (files.length === 0) return;
    setShowClearConfirm(true);
  }, [files]);

  const handleConfirmClear = useCallback(async () => {
    try {
      await clearAllData();
      toast.success('所有文件已清空');
    } catch (error) {
      handleError(error, {
        context: { operation: '清空所有数据' }
      });
    } finally {
      setShowClearConfirm(false);
    }
  }, [clearAllData, handleError]);

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
  }, [fileToDelete, removeFile, handleError]);

  const handleExport = useCallback(async (file: SubtitleFileMetadata) => {
    try {
      const zipBlob = await exportTaskZip(file.taskId);
      const zipName = `${getBaseName(file.name)}.zip`;
      downloadZipFile(zipBlob, zipName);
      toast.success('导出成功');
    } catch (error) {
      handleError(error, {
        context: { operation: '导出', fileName: file.name }
      });
    }
  }, [handleError]);

  if (files.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
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
                className="apple-button px-5 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>全部开始</span>
              </button>
              <button
                onClick={handleClearAll}
                disabled={files.length === 0}
                className="apple-button apple-button-secondary px-5 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="h-4 w-4" />
                <span>清空</span>
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <AnimatePresence>
              {files.map((file, index) => {
                const isQueued = taskQueue.includes(file.id);
                const queuePosition = taskQueue.indexOf(file.id) + 1;
                const isActive = activeTaskId === file.id;

                return (
                  <SubtitleFileItem
                    key={file.id}
                    file={file}
                    index={index}
                    onEdit={onEditFile}
                    onStartTranslation={() => enqueueTask(file.id)}
                    onExport={handleExport}
                    onDelete={handleDeleteFile}
                    onTranscribeAndTranslate={() => enqueueTask(file.id)}
                    onTranscribe={() => enqueueTask(file.id)}
                    onDequeue={() => dequeueTask(file.id)}
                    isQueued={isQueued && !isActive}
                    queuePosition={queuePosition}
                    isActive={isActive}
                  />
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

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

function formatTime(ms: number): string {
  const date = new Date(ms);
  const hours = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}
