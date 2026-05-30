import { formatFileSize as formatFileSizeUtil } from '@/utils/fileFormat';

// 重新导出，保持组件使用方便
export const formatFileSize = formatFileSizeUtil;

/**
 * 秒 → 显示用时长 "HH:MM:SS"
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return String(h).padStart(2, '0') + ':' +
         String(m).padStart(2, '0') + ':' +
         String(s).padStart(2, '0');
}
