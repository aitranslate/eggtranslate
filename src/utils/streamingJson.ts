/**
 * 从流式 LLM 输出中增量提取翻译 JSON 的 direct 字段。
 * 期望格式：{ "1": { "origin": "...", "direct": "..." }, "2": { ... } }
 */

export type StreamingDirects = Record<string, string>;

/**
 * 从 partial/complete JSON 字符串中提取各条目的 direct 译文（可含未闭合字符串）。
 */
export function extractStreamingDirects(raw: string): StreamingDirects {
  if (!raw) return {};

  // 去掉 markdown 代码围栏前缀，定位到第一个 {
  let s = raw.trim();
  const fence = s.match(/^```(?:json)?\s*/i);
  if (fence) {
    s = s.slice(fence[0].length);
  }
  const brace = s.indexOf('{');
  if (brace < 0) return {};
  if (brace > 0) s = s.slice(brace);

  const result: StreamingDirects = {};
  const keyRe = /"(\d+)"\s*:\s*\{/g;
  const matches: Array<{ key: string; objStart: number; matchStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(s)) !== null) {
    matches.push({
      key: m[1],
      objStart: m.index + m[0].length,
      matchStart: m.index,
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const { key, objStart } = matches[i];
    // 对象边界：下一个同级 "N": { 或文本尾
    const objEnd = i + 1 < matches.length ? matches[i + 1].matchStart : s.length;
    const objSlice = s.slice(objStart, objEnd);
    const directMatch = objSlice.match(/"direct"\s*:\s*"/);
    if (!directMatch || directMatch.index === undefined) continue;

    const strStart = directMatch.index + directMatch[0].length;
    const { value } = readJsonStringFragment(objSlice, strStart);
    if (value.length > 0) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * 从 start 起读取 JSON 字符串内容（支持转义；未闭合时返回已读 partial）。
 */
export function readJsonStringFragment(
  s: string,
  start: number
): { value: string; complete: boolean } {
  let i = start;
  let value = '';

  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      if (i + 1 >= s.length) {
        // 转义未完成，丢弃尾部反斜杠
        break;
      }
      const n = s[i + 1];
      switch (n) {
        case 'n':
          value += '\n';
          break;
        case 't':
          value += '\t';
          break;
        case 'r':
          value += '\r';
          break;
        case '"':
        case '\\':
        case '/':
          value += n;
          break;
        case 'u': {
          if (i + 5 >= s.length) {
            // 不完整的 \uXXXX，停在此
            return { value, complete: false };
          }
          const hex = s.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            value += String.fromCharCode(parseInt(hex, 16));
            i += 6;
            continue;
          }
          value += n;
          break;
        }
        default:
          value += n;
      }
      i += 2;
      continue;
    }
    if (c === '"') {
      return { value, complete: true };
    }
    value += c;
    i += 1;
  }

  return { value, complete: false };
}

/**
 * 节流：避免每个 token 都触发 store 更新。
 * 返回一个 schedule(fn) 与 flush()。
 */
export function createThrottle(intervalMs: number): {
  schedule: (fn: () => void) => void;
  flush: () => void;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: (() => void) | null = null;
  let lastRun = 0;

  const run = () => {
    timer = null;
    const fn = pending;
    pending = null;
    if (fn) {
      lastRun = Date.now();
      fn();
    }
  };

  return {
    schedule(fn: () => void) {
      pending = fn;
      const elapsed = Date.now() - lastRun;
      if (elapsed >= intervalMs) {
        if (timer != null) {
          clearTimeout(timer);
          timer = null;
        }
        run();
        return;
      }
      if (timer == null) {
        timer = setTimeout(run, intervalMs - elapsed);
      }
    },
    flush() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      run();
    },
    cancel() {
      if (timer != null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
    },
  };
}
