/**
 * 统一文件导入：SRT / 音视频 → addFile
 * 供工作区空状态拖放、Ctrl/Cmd+O、侧栏导入按钮共用
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import toast from 'react-hot-toast';
import { addFile } from '@/services/filesService';
import { useErrorHandler } from '@/hooks/useErrorHandler';

export const IMPORT_ACCEPT =
  '.srt,.mp3,.wav,.m4a,.ogg,.flac,.mp4,.webm,.mkv,.avi,.mov,audio/*,video/*';

const SUPPORTED_EXTS = new Set([
  'srt',
  'mp3',
  'wav',
  'm4a',
  'ogg',
  'flac',
  'mp4',
  'webm',
  'mkv',
  'avi',
  'mov',
]);

export function isSupportedImportFile(file: File): boolean {
  const ext = file.name.toLowerCase().split('.').pop();
  return Boolean(ext && SUPPORTED_EXTS.has(ext));
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
    async (file: File) => {
      if (!isSupportedImportFile(file)) {
        toast.error('不支持的文件格式，请选择 .srt 字幕或音视频文件');
        return;
      }
      try {
        await addFile(file);
      } catch (err) {
        handleError(err, {
          context: { operation: '加载文件', fileName: file.name },
        });
      }
    },
    [handleError]
  );

  /** 串行导入，避免多文件并发转码与 index 快照冲突 */
  const importFiles = useCallback(
    async (list: FileList | File[] | null | undefined) => {
      if (!list || list.length === 0) return;
      const files = Array.from(list);
      for (const f of files) {
        await importOne(f);
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
