// 词表拼接 —— OneAsr crates/oneasr-core/src/sentence_boundary/util.rs 的 join_words。
// 字幕文本与显示字符计数共用这一处，避免两套空格规则。

const NO_SPACE_SCRIPT = (ch: string): boolean => {
  const v = ch.codePointAt(0)!;
  return (
    (v >= 0x3040 && v <= 0x30ff) ||
    (v >= 0x3400 && v <= 0x4dbf) ||
    (v >= 0x4e00 && v <= 0x9fff) ||
    (v >= 0xf900 && v <= 0xfaff) ||
    (v >= 0xff66 && v <= 0xff9d) ||
    (v >= 0x20000 && v <= 0x2fa1f)
  );
};

const firstChar = (s: string): string => {
  const c = [...s];
  return c.length ? c[0]! : '';
};
const lastChar = (s: string): string => {
  const c = [...s];
  return c.length ? c[c.length - 1]! : '';
};

const hasSpacingWord = (token: string): boolean => {
  for (const ch of token) {
    if (/[\p{L}\p{N}]/u.test(ch) && !NO_SPACE_SCRIPT(ch)) return true;
  }
  return false;
};

const allowsSpaceAfter = (token: string): boolean =>
  [',', ';', ':', '?', '!', '.', '，', '；', '：', '？', '！', '。'].includes(lastChar(token));

const TIGHT_MARKS = new Set([',', '.', '!', '?', ':', ';']);

const tightenMarks = (token: string): string => {
  let out = token;
  for (const m of TIGHT_MARKS) out = out.split(` ${m}`).join(m);
  return out;
};

export interface SpacingPiece {
  spaceBefore: boolean;
  text: string;
}

export function spacingPieces(parts: Iterable<string>): SpacingPiece[] {
  const out: SpacingPiece[] = [];
  let prevHasSpacingWord = false;
  let prevAllowsSpaceAfter = false;
  for (const raw of parts) {
    const token = raw.trim();
    if (!token) continue;
    const nextHasSpacingWord = hasSpacingWord(token);
    const opensWithTightMark = TIGHT_MARKS.has(firstChar(token));
    out.push({
      spaceBefore:
        out.length > 0 &&
        nextHasSpacingWord &&
        (prevHasSpacingWord || prevAllowsSpaceAfter) &&
        !opensWithTightMark,
      text: tightenMarks(token),
    });
    prevHasSpacingWord = nextHasSpacingWord;
    prevAllowsSpaceAfter = allowsSpaceAfter(token);
  }
  return out;
}

export function joinWords(parts: Iterable<string>): string {
  let out = '';
  for (const piece of spacingPieces(parts)) {
    if (piece.spaceBefore) out += ' ';
    out += piece.text;
  }
  return out;
}
