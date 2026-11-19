// 词流归一化 —— OneAsr crates/oneasr-core/src/sentence_boundary/digit_glue.rs 的移植。
// ASR 会把数字拆成单字 token（"1" "5"），或在 token 内部留空格（"1 5"）；
// 断句前先粘回去，否则 DP 会把 15 当成两个单位。

export interface GlueWord {
  text: string;
  start: number;
  end: number;
}

const isDecimalDigit = (ch: string): boolean => /[0-9０-９]/.test(ch);

const hasInternalDecimal = (token: string): boolean => {
  const c = [...token];
  for (let i = 0; i + 2 < c.length; i++) {
    if (isDecimalDigit(c[i]!) && ['.', ',', '。'].includes(c[i + 1]!) && isDecimalDigit(c[i + 2]!)) {
      return true;
    }
  }
  return false;
};

const digitRunLen = (chars: Iterable<string>): number => {
  let n = 0;
  for (const ch of chars) {
    if (!isDecimalDigit(ch)) break;
    n += 1;
  }
  return n;
};

const trailingSingletonDigit = (token: string): boolean => {
  if (hasInternalDecimal(token)) return false;
  const trimmed = token.trim();
  if (trimmed.endsWith('.') || trimmed.endsWith(',')) return false;
  const core = trimmed.replace(/[。！？、!?]+$/, '');
  return digitRunLen([...core].reverse()) === 1;
};

const leadingSingletonDigit = (token: string): boolean => {
  if (hasInternalDecimal(token)) return false;
  const trimmed = token.trim();
  if (trimmed.startsWith('.') || trimmed.startsWith(',')) return false;
  return digitRunLen(trimmed) === 1;
};

export function glueInternalDigitSpaces(s: string): string {
  const c = [...s];
  let out = '';
  let i = 0;
  while (i < c.length) {
    const ch = c[i]!;
    if (!isDecimalDigit(ch)) {
      out += ch;
      i += 1;
      continue;
    }
    const prevDigit = out.length > 0 && isDecimalDigit([...out].pop()!);
    out += ch;
    i += 1;
    if (prevDigit) continue;
    for (;;) {
      let j = i;
      while (j < c.length && /\s/.test(c[j]!)) j += 1;
      if (j < c.length && isDecimalDigit(c[j]!)) {
        const isolated = j + 1 >= c.length || !isDecimalDigit(c[j + 1]!);
        if (isolated && j > i) {
          out += c[j];
          i = j + 1;
          continue;
        }
      }
      break;
    }
  }
  return out;
}

export function glueAsrSplitDigits<T extends GlueWord>(words: readonly T[]): T[] {
  if (words.length === 0) return [];
  const prepared = words.map((w) => ({ ...w, text: glueInternalDigitSpaces(w.text) }));
  const out: T[] = [];
  let i = 0;
  while (i < prepared.length) {
    const cur = prepared[i]!;
    const next = prepared[i + 1];
    if (next && trailingSingletonDigit(cur.text) && leadingSingletonDigit(next.text)) {
      const start = i;
      i += 1;
      while (i < prepared.length && leadingSingletonDigit(prepared[i]!.text)) {
        const endsNumber = !trailingSingletonDigit(prepared[i]!.text);
        i += 1;
        if (endsNumber) break;
      }
      const run = prepared.slice(start, i);
      out.push({
        ...run[0]!,
        text: glueInternalDigitSpaces(run.map((w) => w.text).join('')),
        end: run[run.length - 1]!.end,
      });
      continue;
    }
    out.push(cur);
    i += 1;
  }
  return out;
}

const JA_COPULA = ['ました', 'でした', 'ません', 'です', 'ます'];
const JA_REST = ['まず', 'まずは', 'はい', 'じゃあ', 'だから', 'でも', 'それから', 'そして'];

/** ASR 有时把 ます+まず / です+だから 粘成一个 token，按字时长比例拆开。 */
export function unglueFusedJaCopula<T extends GlueWord>(words: readonly T[]): T[] {
  const out: T[] = [];
  for (const word of words) {
    const text = word.text;
    let split: [string, string] | null = null;
    for (const cop of JA_COPULA) {
      const idx = text.lastIndexOf(cop);
      if (idx < 0) continue;
      const rest = text.slice(idx + cop.length);
      if (!rest) continue;
      if (JA_REST.some((r) => rest === r || rest.startsWith(r))) {
        split = [text.slice(0, idx + cop.length), rest];
        break;
      }
    }
    if (!split) {
      out.push(word);
      continue;
    }
    const [left, rest] = split;
    const leftChars = [...left].length;
    const total = leftChars + [...rest].length;
    const span = Math.max(0, word.end - word.start);
    const mid = total <= 0 ? word.start : word.start + span * (leftChars / total);
    out.push({ ...word, text: left, end: mid });
    out.push({ ...word, text: rest, start: mid });
  }
  return out;
}
