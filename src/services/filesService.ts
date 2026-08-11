/**
 * 文件业务 Service
 * 封装文件 CRUD 的业务规则：
 * - 加载：解析文件 + 转换 + 加入 store
 * - 删除：清理 MP3 数据 + 停止相关翻译
 * - 选中：记录用户当前选择
 */

import { useFilesStore, flushFilesStorePersist } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { loadFromFile, removeMp3Data } from './SubtitleFileManager';
import { convertToMP3, warmupMp3Encoder } from '@/utils/convertToMP3';
import { toAppError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { playAppSound } from '@/utils/appSound';
import { isMediaImportFileName } from '@/utils/taskGuards';
import { toastError } from '@/utils/appToast';
import localforage from 'localforage';
import toast from 'react-hot-toast';

function defaultTaskLanguages() {
  const { sourceLanguage, targetLanguage } = useTranslationConfigStore.getState().config;
  return { sourceLanguage, targetLanguage };
}

export async function addFile(file: File): Promise<string | null> {
  // Store 已在 main bootstrap 中 rehydrate 完成；此处不再做 per-call hydrate 等待
  const { defaultKeytermGroupId } = useTranscriptionStore.getState();
  const langs = defaultTaskLanguages();

  // 音视频：唯一转码点（浏览器解码 → 16k mono MP3）
  const isSrt = /\.srt$/i.test(file.name) || file.type === 'application/x-subrip';
  const isMedia =
    !isSrt &&
    (file.type.startsWith('audio/') ||
      file.type.startsWith('video/') ||
      isMediaImportFileName(file.name));
  if (isMedia) {
    return addMediaFile(file, defaultKeytermGroupId, langs);
  }

  return addSubtitleFile(file, defaultKeytermGroupId, langs);
}

async function addSubtitleFile(
  file: File,
  defaultKeytermGroupId: string | null,
  langs: { sourceLanguage: string; targetLanguage: string }
): Promise<string> {
  try {
    const result = await loadFromFile(file, {
      existingFilesCount: useFilesStore.getState().tasks.length,
      defaultKeytermGroupId,
      defaultSourceLanguage: langs.sourceLanguage,
      defaultTargetLanguage: langs.targetLanguage,
    });
    useFilesStore.getState().addTask(result.task);
    toast.success(`已添加：${file.name}`);
    return result.metadata.id;
  } catch (error) {
    const appError = toAppError(error, '文件加载失败');
    logger.error(appError.message, appError);
    toastError(`文件加载失败: ${appError.message}`);
    throw error;
  }
}

async function addMediaFile(
  file: File,
  defaultKeytermGroupId: string | null,
  langs: { sourceLanguage: string; targetLanguage: string }
): Promise<string | null> {
  // 处理中 toast 必须持续显示：显式 Infinity（全局 duration 会盖住 loading 默认值）。
  // 定稿 success/error 必须带有限 duration，覆盖同 id 上的 Infinity。
  const toastId = toast.loading(`正在处理 ${file.name}…`, { duration: Infinity });
  // 与元数据解析并行预热 MP3 Worker（按需，不在冷启动全站预拉）
  warmupMp3Encoder();

  try {
    // 1) 解析元数据（不持有原始 File 进 store：转码后只留 IDB 里的 MP3）
    const result = await loadFromFile(file, {
      existingFilesCount: useFilesStore.getState().tasks.length,
      defaultKeytermGroupId,
      defaultSourceLanguage: langs.sourceLanguage,
      defaultTargetLanguage: langs.targetLanguage,
    });

    // 2) 原生解码 + Worker 编码 → 16k mono MP3 并持久化
    logger.info(`[addFile] 转码开始: ${file.name}`);
    toast.loading(`正在处理音频 ${file.name}…`, { id: toastId, duration: Infinity });
    const mp3Blob = await convertToMP3(file, (p) => {
      const pct = Math.round(Math.min(1, Math.max(0, p)) * 100);
      if (pct >= 2) {
        toast.loading(`正在处理音频 ${file.name}… ${pct}%`, {
          id: toastId,
          duration: Infinity,
        });
      }
    });
    await localforage.setItem(`mp3_data:${result.task.taskId}`, mp3Blob);
    logger.info(`[addFile] 转码完成: ${file.name}, ${(mp3Blob.size / 1024 / 1024).toFixed(2)}MB`);

    // 3) 加入 store：不挂 fileRef，避免大视频整段占堆；转录只读 mp3_data
    const finalTask = {
      ...result.task,
      phases: {
        ...result.task.phases,
        converting: { status: 'completed' as const, progress: 100, tokens: 0 },
      },
    };
    useFilesStore.getState().addTask(finalTask);
    // 双保险：addTask 已 flush，这里再 await 确保 MP3 key 与任务列表一致落盘
    await flushFilesStorePersist();

    toast.success(`已添加：${file.name}`, { id: toastId, duration: 2000 });
    return result.metadata.id;
  } catch (error) {
    const appError = toAppError(error, '导入失败');
    logger.error(appError.message, appError);
    // 用带「复制」按钮的错误 toast 替换 loading（同 id）
    toastError(`导入失败：${file.name}（${appError.message}）`, { id: toastId });
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
    playAppSound('delete');
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
    if (tasks.length > 0) playAppSound('delete');
  } catch (error) {
    const appError = toAppError(error, '清空数据失败');
    logger.error(appError.message, appError);
    toast.error('清空数据失败');
  }
}
