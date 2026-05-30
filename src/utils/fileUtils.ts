/**
 * 文件工具函数
 */

import type { SubtitleFileMetadata } from '@/types';

/**
 * 判断文件是否可以重新转录
 *
 * 规则：
 * - SRT 文件：不需要转录
 * - 音视频文件：已完成则禁用，失败或未完成则允许
 *
 * @param file - 字幕文件对象
 * @returns 是否可以重新转录
 */
export const canRetranscribe = (file: SubtitleFileMetadata): boolean => {
  // SRT 文件：不需要转录
  if (file.fileType === 'srt') {
    return false;
  }

  // 音视频文件
  if (file.fileType === 'audio' || file.fileType === 'video') {
    return file.phases.transcribing.status !== 'completed' && file.phases.transcribing.status !== 'active';
  }

  // 默认：允许转录
  return true;
};