/**
 * 统一文件导入：SRT / 音视频 → addFile
 * 供工作区空状态拖放、Ctrl/Cmd+O、侧栏导入按钮共用
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import toast from 'react-hot-toast';
import { addFile, selectFile } from '@/services/filesService';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import {
  formatImportProgress,
  formatImportSummary,
  unsupportedImportMessage,
} from '@/utils/uxHelpers';
import {
  isMediaImportFileName,
  isTranscriptionApiConfigured,
} from '@/utils/taskGuards';

/**
 * 字幕 + 常见音视频。
 * accept 用 MIME 通配 + 常见扩展（仅影响系统文件选择器过滤，UI 不罗列格式）。
 * 媒体走流式抽轨/原文件直传，用户无需关心容器细节。
 */
const IMPORT_ACCEPT =
  '.srt,audio/*,video/*,.mkv,.avi,.mov,.wmv,.flv,.ts,.m4v,.webm,.ogg,.flac,.aac,.opus,.wma,.3gp,.mpeg,.mpg,.m4a,.wav,.mp3,.mp4';

export function isSupportedImportFile(file: File): boolean {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.srt')) return true;
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('audio/') || type.startsWith('video/')) return true;
  // type 为空时：常见媒体扩展仍放行
  if (isMediaImportFileName(file.name)) return true;
  return false;
}

/** 修饰键展示：macOS 用 ⌘，其它用 Ctrl */
export function importModKeyLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  const platform = navigator.platform || '';
  const ua = navigator.userAgent || '';
  if (/Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X/i.test(ua)) {
    return '⌘';
  }
  return 'Ctrl';
}

export function useFileImport() {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { handleError } = useErrorHandler();

  const importOne = useCallback(
    async (file: File): Promise<string | null> => {
      if (!isSupportedImportFile(file)) {
        toast.error(unsupportedImportMessage());
        return null;
      }
      try {
        return await addFile(file);
      } catch (err) {
        handleError(err, {
          context: { operation: '加载文件', fileName: file.name },
        });
        return null;
      }
    },
    [handleError]
  );

  /** 串行导入；多文件显示 n/N 进度；成功后选中最后导入项并打开工作区 */
  const importFiles = useCallback(
    async (list: FileList | File[] | null | undefined) => {
      if (!list || list.length === 0) return;
      const files = Array.from(list);
      const total = files.length;
      let ok = 0;
      let fail = 0;
      let lastId: string | null = null;
      /** 仅统计成功入库的媒体，避免「SRT 成功 + 媒体失败」仍弹转录 tip */
      let okMedia = 0;

      // 多文件总进度：loading 必须 Infinity；定稿 success/error 带有限 duration 覆盖
      const progressToastId =
        total > 1
          ? toast.loading(formatImportProgress(0, total), { duration: Infinity })
          : null;

      for (let i = 0; i < files.length; i++) {
        if (progressToastId) {
          toast.loading(formatImportProgress(i + 1, total), {
            id: progressToastId,
            duration: Infinity,
          });
        }
        const id = await importOne(files[i]);
        if (id) {
          ok += 1;
          lastId = id;
          if (isMediaImportFileName(files[i].name)) okMedia += 1;
        } else {
          fail += 1;
        }
      }

      if (progressToastId) {
        if (ok > 0 && fail === 0) {
          toast.success(formatImportSummary(ok, fail), { id: progressToastId, duration: 2000 });
        } else if (ok === 0) {
          toast.error(formatImportSummary(ok, fail), { id: progressToastId, duration: 3000 });
        } else {
          toast.success(formatImportSummary(ok, fail), { id: progressToastId, duration: 2000 });
        }
      }

      if (lastId) {
        selectFile(lastId);
        useWorkspaceStore.getState().openEditor();
      }

      // 导入音视频但未配置转录：简短提示（无引导 tip）
      if (okMedia > 0) {
        const apiKeys = useTranscriptionStore.getState().apiKeys;
        if (!isTranscriptionApiConfigured(apiKeys)) {
          toast('已导入音视频。开始转录前请在设置中配置 AssemblyAI Key。', {
            duration: 3000,
            id: 'transcription-key-hint',
          });
        }
      }
    },
    [importOne]
  );

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      void importFiles(e.target.files);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [importFiles]
  );

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      void importFiles(e.dataTransfer.files);
    },
    [importFiles]
  );

  // 拖放被系统取消时清掉高亮
  useEffect(() => {
    const clear = () => setIsDragging(false);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);

  return {
    fileInputRef,
    isDragging,
    importFiles,
    openFilePicker,
    onFileInputChange,
    onDragOver,
    onDragLeave,
    onDrop,
    accept: IMPORT_ACCEPT,
    modKeyLabel: importModKeyLabel(),
  };
}
