import { FileType } from '@/types';

/**
 * 检测文件类型
 * @param filename - 文件名
 * @returns 文件类型：'srt' | 'audio' | 'video'
 */
export const detectFileType = (filename: string): FileType => {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'srt') return 'srt';

  const audioExts = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac'];
  const videoExts = ['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv'];

  if (audioExts.includes(ext || '')) return 'audio';
  if (videoExts.includes(ext || '')) return 'video';

  return 'srt'; // 默认
};

/**
 * 格式化文件大小显示
 * @param bytes - 字节数
 * @returns 格式化后的文件大小字符串，例如 "1.5 MB"
 */
export const formatFileSize = (bytes: number): string => {
  if (!bytes || bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};
