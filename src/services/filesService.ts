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
import { convertToMP3 } from '@/utils/convertToMP3';
import { toAppError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import localforage from 'localforage';
import toast from 'react-hot-toast';

export async function addFile(file: File): Promise<string | null> {
  const transcriptionStore = useTranscriptionStore.getState();
  const defaultKeytermGroupId = transcriptionStore.keytermsEnabled
    ? transcriptionStore.defaultKeytermGroupId
    : null;

  // 音视频文件：转码 + 持久化 + 上传完成才加入 store（用 toast 持续提示）
  if (file.type.startsWith('audio/') || file.type.startsWith('video/') || /\.(mp3|m4a|wav|mp4|mov|webm|mkv)$/i.test(file.name)) {
    return addMediaFile(file, defaultKeytermGroupId);
  }

  // SRT 字幕：直接加载，无转码
  return addSubtitleFile(file, defaultKeytermGroupId);
}

async function addSubtitleFile(file: File, defaultKeytermGroupId: string | null): Promise<string> {
  try {
    const result = await loadFromFile(file, {
      existingFilesCount: useFilesStore.getState().tasks.length,
      defaultKeytermGroupId,
    });
    useFilesStore.getState().addTask(result.task);
    toast.success(`已添加：${file.name}`);
    return result.metadata.id;
  } catch (error) {
    const appError = toAppError(error, '文件加载失败');
    logger.error(appError.message, appError);
    toast.error(`文件加载失败: ${appError.message}`);
    throw error;
  }
}

async function addMediaFile(file: File, defaultKeytermGroupId: string | null): Promise<string | null> {
  // 上传中 toast（持续显示，转码完成或失败才更新）
  const toastId = toast.loading(`正在上传 ${file.name}…`, { duration: Infinity });

  try {
    // 1) 解析元数据
    const result = await loadFromFile(file, {
      existingFilesCount: useFilesStore.getState().tasks.length,
      defaultKeytermGroupId,
    });

    // 2) 转码为 MP3 并持久化
    logger.info(`[addFile] 转码开始: ${file.name}`);
    const mp3Blob = await convertToMP3(file);
    await localforage.setItem(`mp3_data:${result.task.taskId}`, mp3Blob);
    logger.info(`[addFile] 转码完成: ${file.name}, ${(mp3Blob.size / 1024 / 1024).toFixed(2)}MB`);

    // 3) 加入 store（此时 converting 已是 completed）
    const finalTask = {
      ...result.task,
      fileRef: file,
      phases: {
        ...result.task.phases,
        converting: { status: 'completed' as const, progress: 100, tokens: 0 },
      },
    };
    useFilesStore.getState().addTask(finalTask);

    // 4) 上传成功 toast（覆盖 loading toast，4s 后自动消失）
    toast.success(`上传成功：${file.name}`, { id: toastId, duration: 4000 });
    return result.metadata.id;
  } catch (error) {
    const appError = toAppError(error, '上传失败');
    logger.error(appError.message, appError);
    toast.error(`上传失败：${file.name}（${appError.message}）`, { id: toastId, duration: 4000 });
    return null;
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
