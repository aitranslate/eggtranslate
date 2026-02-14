import { FileType } from '@/types';

/**
 * 将秒数转换为 SRT 时间格式 (HH:MM:SS,mmm)
 * @param seconds - 时间（秒）
 * @returns SRT 时间格式字符串，例如 "00:01:23,456"
 */
export const formatSRTTime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);

  const pad = (num: number, size: number) => String(num).padStart(size, '0');

  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(ms, 3)}`;
};
