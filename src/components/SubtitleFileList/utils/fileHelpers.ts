import { SubtitleFile } from '@/types';
import type { FileType } from '@/types/transcription';
import { formatFileSize as formatFileSizeUtil } from '@/utils/fileFormat';

// 重新导出，保持组件使用方便
export const formatFileSize = formatFileSizeUtil;

/**
 * 获取状态文本
 */
export const getStatusText = (file: SubtitleFile): string => {
  if (file.fileType === 'srt') {
    return 'SRT 字幕';
  }

  // 音视频文件（极简转录流程）
  switch (file.transcriptionStatus) {
    case 'idle':
      return '等待转录';
    case 'uploading':
      return '上传中';
    case 'transcribing':
      return '转录中';
    case 'completed':
      return '转录完成';
    case 'failed':
      return '转录失败';
    default:
      return '等待转录';
  }
};
