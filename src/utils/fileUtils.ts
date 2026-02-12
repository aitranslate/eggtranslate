/**
 * 文件工具函数
 */

import type { SubtitleFile, SubtitleFileMetadata } from '@/types';

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
export const canRetranscribe = (file: SubtitleFile | SubtitleFileMetadata): boolean => {
  // SRT 文件：不需要转录
  if (file.fileType === 'srt') {
    return false;
  }

  // 音视频文件
  if (file.fileType === 'audio-video') {
    // 只有未完成或失败时才允许重新转录
    return file.transcriptionStatus !== 'completed';
  }

  // 默认：允许转录
  return true;
};
