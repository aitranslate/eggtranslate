/**
 * 文件业务 Service
 * 封装文件 CRUD 的业务规则：
 * - 加载：解析文件 + 转换 + 加入 store
 * - 删除：清理 MP3 数据 + 停止相关翻译
 * - 选中：记录用户当前选择
 */

import { useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { loadFromFile, removeMp3Data } from './SubtitleFileManager';
import { toAppError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import toast from 'react-hot-toast';

export async function addFile(file: File): Promise<string> {
  try {
    // 默认从设置中获取热词分组
    const transcriptionStore = useTranscriptionStore.getState();
    const defaultKeytermGroupId = transcriptionStore.keytermsEnabled
      ? transcriptionStore.defaultKeytermGroupId
      : null;

    const result = await loadFromFile(file, {
      existingFilesCount: useFilesStore.getState().tasks.length,
      defaultKeytermGroupId,
    });
    const taskWithRef = { ...result.task, fileRef: file };
    useFilesStore.getState().addTask(taskWithRef);
    return result.metadata.id;
  } catch (error) {
    const appError = toAppError(error, '文件加载失败');
    logger.error(appError.message, appError);
    toast.error(`文件加载失败: ${appError.message}`);
    throw error;
  }
}

export async function removeFile(fileId: string, _file?: File): Promise<void> {
  const state = useFilesStore.getState();
  const file = state.getFile(fileId);
  if (!file) return;

  // 从队列移除
  const queue = useQueueStore.getState();
  if (queue.taskQueue.includes(fileId)) {
    useQueueStore.getState().setTaskQueue(queue.taskQueue.filter((id) => id !== fileId));
  }

  // 停止相关翻译
  const translationStore = useTranslationConfigStore.getState();
  if (translationStore.isTranslating && translationStore.currentTaskId === file.taskId) {
    translationStore.stopTranslation();
  }

  try {
    state.removeTask(file.taskId);
    await removeMp3Data(file.taskId);
    toast.success('文件已删除');
  } catch (error) {
    const appError = toAppError(error, '删除文件失败');
    logger.error(appError.message, appError);
    toast.error('删除文件失败');
  }
}

export function selectFile(fileId: string | null): void {
  useFilesStore.getState().setSelectedFileId(fileId);
}

export async function clearAll(): Promise<void> {
  try {
    const tasks = useFilesStore.getState().tasks;
    useFilesStore.getState().clearAllTasks();
    useQueueStore.getState().setTaskQueue([]);
    useQueueStore.getState().setActiveTaskId(null);
    for (const task of tasks) {
      await removeMp3Data(task.taskId);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('taskCleared'));
    }
  } catch (error) {
    const appError = toAppError(error, '清空数据失败');
    logger.error(appError.message, appError);
    toast.error('清空数据失败');
  }
}
