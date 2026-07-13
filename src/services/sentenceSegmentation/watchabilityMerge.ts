// Watchability 合并后处理 —— 移植 D:\voxtrans 的 subtitle_step5/watchability_merge.rs。
// 解决"一闪而过"：DP 断句后把过短相邻段按静音间隔 / 残段-连词模式重新粘合。
// EggTranslate 断句阶段只有源文本，故文本判定均基于 source `text`，逻辑等价。
// 入口为纯函数（输入输出 DpSegment[]），便于单测。

import { getProfile } from './profiles';
import type { DpSegment, Preset } from './types';

const MERGE_GAP_MS = 500;
const MERGE_BUDGET_MS = 6000;
const MERGE_LEN_RATIO = 1.55;

const norm = (s: string) => s.replace(/[\r\n]/g, ' ').split(/\s+/).filter(Boolean).join(' ').trim();

const isCjk = (ch: string) => {
  const c = ch.codePointAt(0)!;
  return (
    (c >= 0x3040 && c <= 0x30ff) || (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xac00 && c <= 0xd7af)
  );
};

const shouldUseCharUnits = (lang: string, text: string) => {
  const lo = lang.trim().toLowerCase();
  if (/^(zh|yue|ja|ko|th)/.test(lo)) return true;
  if (!lo || lo === 'auto') return [...text].some(isCjk);
  return false;
};

const countCharUnits = (t: string) => {
  let n = 0, asc = false;
  for (const ch of t) {
    if (ch === ' ' || ch === '\t') { if (asc) { n++; asc = false; } continue; }
    if (/[A-Za-z0-9]/.test(ch)) { asc = true; continue; }
    if (asc) { n++; asc = false; }
    // \p{L}\p{M}* 把基础字母和后续组合标记（重音等）算一个单位，避免 café 被算成 5。
    // 韩文 syllable block（가-힣）是 NFC 单码点，\p{L} 已覆盖；Jamo 组合极少见，忽略。
    if (isCjk(ch) || /\p{L}\p{M}*|\p{N}/u.test(ch)) n++;
  }
  return asc ? n + 1 : n;
};

const countWordUnits = (t: string) => {
  let n = 0, w = false;
  for (const ch of t) {
    if (/[A-Za-z0-9]/.test(ch)) { if (!w) { n++; w = true; } continue; }
    if (isCjk(ch)) n++;
    w = false;
  }
  return n;
};

const textLen = (t: string, lang: string) => {
  const s = t.trim();
  if (!s) return 0;
  return shouldUseCharUnits(lang, s) ? countCharUnits(s) : countWordUnits(s);
};

// 与 voxtrans quality.rs is_terminal_punctuation 一致。注意不含 ] / ) ——
// 它们是配对右括号，不是句末标点。
const isTerm = (ch: string) => ['.','!','?',';','。','！','？','；','，',','].includes(ch);

const CJK_CONNECTORS = ['然后','而且','并且','因为','所以','但是','如果','为了','以及','还有','并','和','与','及','或','来','去','在','对','把','将','大约'];
const ASCII_CONNECTORS = ['and','or','to','for','with','that','which','when','if','but','so'];
const CJK_STARTERS = ['个','这个','那个','这','那','然后','并且','而且','而','并','因为','所以','如果','还','继续','将','与','和'];
const ASCII_STARTERS = ['a','an','the','to','of','and','or','with','for','this','that','if','so','then','while','it','you','we','they'];
const CJK_DANGLING = ['一个','做一个','这个','那个','这笔','那笔','这','那'];

const endsDangling = (t: string) => CJK_DANGLING.some((s) => norm(t).endsWith(s));

const endsConnector = (t: string) => {
  const n = norm(t);
  if (!n) return false;
  if (CJK_CONNECTORS.some((s) => n.endsWith(s))) return true;
  const lo = n.toLowerCase();
  return ASCII_CONNECTORS.some((s) => lo.endsWith(s));
};

const fragPenalty = (t: string) => {
  const n = norm(t);
  if (!n) return 0;
  const cc = [...n].length;
  const endTerm = isTerm(n[n.length - 1]);
  const startPunct = /^[,，、。:：;；]/.test(n);
  let p = 0;
  if (startPunct) p += 8;
  if (cc <= 4 && !endTerm) p += 6;
  if (endsConnector(n)) p += 8;
  if (cc <= 8 && endsDangling(n)) p += 10;
  return p;
};

const isFragIssue = (t: string, lang: string) => {
  const n = norm(t);
  if (!n || countWordUnits(n) < 6) return false;
  if (isTerm(n[n.length - 1])) return false;
  if (endsConnector(n) || endsDangling(n)) return true;
  return fragPenalty(n) >= 8 && textLen(n, lang) <= 14;
};

const startsContinuation = (t: string, lang: string) => {
  const n = norm(t);
  if (!n) return false;
  if (shouldUseCharUnits(lang, n)) return CJK_STARTERS.some((p) => n.startsWith(p));
  const first = n.split(/\s+/)[0]?.toLowerCase() ?? '';
  return !!first && (ASCII_STARTERS.includes(first) || ASCII_STARTERS.some((s) => n.startsWith(s + ' ')));
};

const mergeText = (a: string, b: string) => {
  const la = norm(a), lb = norm(b);
  if (!la || !lb) return la || lb;
  // 左右任一侧以/起 CJK 时不插空格，避免"我们决定出门去 然后"这种字面瑕疵；
  // 两侧皆拉丁时保留空格（"and the weather was bad"）。
  const rxCjk = /[\u3000-\u9fff\uff00-\uffef]/;
  const useSpace = !rxCjk.test(la[la.length - 1] ?? '') || !rxCjk.test(lb[0] ?? '');
  return norm(useSpace ? `${la} ${lb}` : `${la}${lb}`);
};

const canMerge = (l: DpSegment, r: DpSegment, maxUnits: number, lang: string) => {
  if (!l.text.trim() || !r.text.trim()) return false;
  if (l.endTime > r.startTime) return false;
  if (r.startTime - l.endTime > MERGE_GAP_MS) return false;
  if (r.endTime - l.startTime > MERGE_BUDGET_MS) return false;
  if (isTerm(norm(l.text).slice(-1))) return false;
  if (!endsDangling(l.text) && !isFragIssue(l.text, lang)) return false;
  if (!startsContinuation(r.text, lang)) return false;
  const merged = mergeText(l.text, r.text);
  if (textLen(merged, lang) > maxUnits) return false;
  return true;
};

const mergePair = (l: DpSegment, r: DpSegment): DpSegment => ({
  text: mergeText(l.text, r.text),
  startTime: l.startTime,
  endTime: r.endTime,
  wordStart: l.wordStart,
  wordEnd: r.wordEnd,
  words: [...l.words, ...r.words],
});

/**
 * 对 DP 断句产物做 watchability 合并。纯函数，返回新数组。
 * @param segments segmentWords 的输出
 * @param lang       语言码（与断句时一致）
 * @param preset     长度预设（决定合并后长度上限 = sourceLimit * 1.55）
 */
export function mergeWatchabilitySegments(
  segments: DpSegment[],
  lang: string,
  preset: Preset = 'standard',
): DpSegment[] {
  if (segments.length < 2) return segments;
  const limit = getProfile(lang).sourceLimit(preset);
  const maxUnits = limit * MERGE_LEN_RATIO;

  const merged: DpSegment[] = [];
  let i = 0;
  while (i < segments.length) {
    if (i + 1 >= segments.length) {
      merged.push(segments[i]);
      break;
    }
    const l = segments[i], r = segments[i + 1];
    if (canMerge(l, r, maxUnits, lang)) {
      merged.push(mergePair(l, r));
      i += 2;
    } else {
      merged.push(l);
      i += 1;
    }
  }
  return merged;
}
