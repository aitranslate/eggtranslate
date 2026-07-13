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

/** 宽松匹配用户输入的字幕时间（点/逗号毫秒均可） */
const SRT_TIME_RE = /^(\d{1,2}):([0-5]?\d):([0-5]?\d)[,.](\d{1,3})$/;

/**
 * 规范化为标准 SRT 时间 "HH:MM:SS,mmm"；无法解析则返回 null
 */
export function normalizeSrtTime(input: string): string | null {
  const raw = (input || '').trim();
  if (!raw) return null;
  const m = raw.match(SRT_TIME_RE);
  if (!m) return null;
  const hours = m[1].padStart(2, '0');
  const minutes = m[2].padStart(2, '0');
  const secs = m[3].padStart(2, '0');
  const ms = m[4].padEnd(3, '0').slice(0, 3);
  return `${hours}:${minutes}:${secs},${ms}`;
}


