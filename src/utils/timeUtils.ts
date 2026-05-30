/**
 * 时间格式工具函数
 * SRT 时间格式: "HH:MM:SS,mmm"
 */

/**
 * 秒 → SRT 时间字符串 "HH:MM:SS,mmm"
 */
export function formatTime(seconds: number): string {
  let totalSeconds = Math.floor(seconds);
  let milliseconds = Math.round((seconds - totalSeconds) * 1000);

  // 处理四舍五入溢出（如 10.99995 → ms=1000）
  if (milliseconds >= 1000) {
    milliseconds -= 1000;
    totalSeconds += 1;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  return String(hours).padStart(2, '0') + ':' +
         String(minutes).padStart(2, '0') + ':' +
         String(secs).padStart(2, '0') + ',' +
         String(milliseconds).padStart(3, '0');
}

/**
 * SRT 时间字符串 → 秒
 */
export function parseTime(srtTime: string): number {
  const parts = srtTime.split(/[:,]/);
  if (parts.length < 4) return 0;
  const hours = parseInt(parts[0], 10) || 0;
  const minutes = parseInt(parts[1], 10) || 0;
  const seconds = parseInt(parts[2], 10) || 0;
  const milliseconds = parseInt(parts[3], 10) || 0;
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}
