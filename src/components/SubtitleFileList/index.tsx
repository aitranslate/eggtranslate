import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import localforage from 'localforage';
import { downloadZipFile } from '@/utils/fileExport';
import { exportTaskZip, getBaseName } from '@/services/SubtitleExporter';
import { useSubtitleStore } from '@/stores/subtitleStore';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { useTerms } from '@/contexts/TermsContext';
import { useHistory } from '@/contexts/HistoryContext';
import { SubtitleFileMetadata } from '@/types';
import { API_CONSTANTS } from '@/constants/api';
import { SubtitleFileItem } from './components/SubtitleFileItem';
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
  const files = useSubtitleStore((state) => state.files);
  const removeFile = useSubtitleStore((state) => state.removeFile);
  const clearAllData = useSubtitleStore((state) => state.clearAll);
  const getTranslationProgress = useSubtitleStore((state) => state.getTranslationProgress);
  const startTranscription = useSubtitleStore((state) => state.startTranscription);
  const startTranslation = useSubtitleStore((state) => state.startTranslation);

  const { getRelevantTerms } = useTerms();
  const { addHistoryEntry } = useHistory();
  const { handleError } = useErrorHandler();

  const [isTranslatingGloballyState, setIsTranslatingGlobally] = useState(false);
  const [currentTranslatingFileId, setCurrentTranslatingFileId] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<SubtitleFileMetadata | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleTranscribe = useCallback(async (fileId: string) => {
    await startTranscription(fileId);
  }, [startTranscription]);

  const executeTranslation = useCallback(async (file: SubtitleFileMetadata) => {
    const result = await startTranslation(file.id);

    if (!result) {
      console.log('[SubtitleFileList] 翻译未完成或已中止');
      return;
    }

    const { tokens, entries, phases } = result;
    const actualCompleted = entries.filter(e =>
      e.translatedText && e.translatedText.trim() !== ''
    ).length;

    if (actualCompleted > 0) {
      await addHistoryEntry({
        taskId: file.taskId,
        filename: file.name,
        completedCount: actualCompleted,
        totalTokens: tokens,
        phases: phases,
        subtitle_entries: entries
      });
    }
  }, [startTranslation, addHistoryEntry]);

  const handleStartTranslation = useCallback(async (file: SubtitleFileMetadata) => {
    setCurrentTranslatingFileId(file.id);

    try {
      // 设置仅翻译工作流
      useSubtitleStore.getState().setWorkflow(file.id, 'translate');
      await executeTranslation(file);
    } catch (error) {
      handleError(error, {
        context: { operation: '翻译', fileName: file.name }
      });
    } finally {
      setCurrentTranslatingFileId(null);
    }
  }, [executeTranslation, handleError]);

  const handleTranscribeAndTranslate = useCallback(async (file: SubtitleFileMetadata) => {
    setCurrentTranslatingFileId(file.id);

    try {
      // 设置全流程工作流
      useSubtitleStore.getState().setWorkflow(file.id, 'full');

      if ((file.fileType === 'audio' || file.fileType === 'video') && file.phases.transcribing.status !== 'completed') {
        await startTranscription(file.id);

        // 转录失败则中断，不继续翻译
        const updatedFile = useSubtitleStore.getState().getFile(file.id);
        if (!updatedFile || updatedFile.phases.transcribing.status !== 'completed') {
          return;
        }
      }

      await executeTranslation(file);
    } catch (error) {
      handleError(error, {
        context: { operation: '转译', fileName: file.name }
      });
    } finally {
      setCurrentTranslatingFileId(null);
    }
  }, [startTranscription, executeTranslation, handleError]);

  const handleStartAllTranslation = useCallback(async () => {
    if (files.length === 0 || isTranslatingGloballyState) return;

    const filesToProcess = files.filter(file => {
      // total === 0 表示还没有加载字幕条目，需要处理
      // completed < total 表示进度未完成，需要处理
      const progress = getTranslationProgress(file.id);
      return progress.total === 0 || progress.completed < progress.total;
    });

    if (filesToProcess.length === 0) {
      toast.success('所有文件都已翻译完成');
      return;
    }

    setIsTranslatingGlobally(true);
    toast.success(`开始处理 ${filesToProcess.length} 个文件`);

    for (const file of filesToProcess) {
      try {
        if ((file.fileType === 'audio' || file.fileType === 'video') && file.phases.transcribing.status !== 'completed') {
          await handleTranscribeAndTranslate(file);
        } else {
          await handleStartTranslation(file);
        }
        await new Promise(resolve => setTimeout(resolve, API_CONSTANTS.BATCH_TASK_GAP_MS));
      } catch (error) {
        handleError(error, {
          context: { operation: '批量处理', fileName: file.name }
        });
      }
    }

    setIsTranslatingGlobally(false);
  }, [files, isTranslatingGloballyState, getTranslationProgress, handleTranscribeAndTranslate, handleStartTranslation, handleError]);

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
                onClick={handleStartAllTranslation}
                disabled={files.length === 0 || isTranslatingGloballyState}
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
              {files.map((file, index) => (
                <SubtitleFileItem
                  key={file.id}
                  file={file}
                  index={index}
                  onEdit={onEditFile}
                  onStartTranslation={handleStartTranslation}
                  onExport={handleExport}
                  onDelete={handleDeleteFile}
                  onTranscribeAndTranslate={handleTranscribeAndTranslate}
                  onTranscribe={handleTranscribe}
                  isTranslatingGlobally={isTranslatingGloballyState}
                  currentTranslatingFileId={currentTranslatingFileId}
                />
              ))}
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
