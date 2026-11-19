// 断句总入口 —— 与 OneAsr 的 build_source_sentences_from_words 同流程：
// 归一化 → 硬切分（句末标点）→ 排版 DP → watchability 合并 → 词区间。
//
// 只做规则断句，不含 AI 兜底。

import { buildSplitPoints, splitPointsToSpans, type SplitPoint } from './hardSplit';
import { glueAsrSplitDigits, unglueFusedJaCopula } from './normalize';
import { getProfile, type LanguageProfile, type Preset } from './profiles';
import { dpSplitSpan, spanBudgetFor } from './softSplit';
import { joinWords } from './spacing';
import { mergeWatchabilitySpans } from './watchabilityMerge';
import { padCueTimings } from './timing';
import type { DpSegment, Segment, WordWithTime } from './types';

export type { Preset } from './profiles';
export type { DpSegment, Segment, WordWithTime } from './types';

interface TimedUnit {
  text: string;
  start: number;
  end: number;
}

/** 归一化后的时间单元（数字胶合 / 日语粘连拆分）。 */
function normalizeWords(words: readonly WordWithTime[]): TimedUnit[] {
  const units: TimedUnit[] = words.map((w) => ({ text: w.text, start: w.start, end: w.end }));
  return unglueFusedJaCopula(glueAsrSplitDigits(units));
}

const reasonPriority = (reason: SplitPoint['reason']): number =>
  reason === 'terminal-punctuation' ? 1 : 2;

/** 合并硬切分点与排版切分点，同一位置保留优先级高的 reason。 */
function mergeSplitPoints(base: readonly SplitPoint[], extra: readonly SplitPoint[]): SplitPoint[] {
  const all = [...base, ...extra];
  all.sort((a, b) => a.index - b.index || reasonPriority(a.reason) - reasonPriority(b.reason));
  const out: SplitPoint[] = [];
  for (const p of all) {
    if (out.length && out[out.length - 1]!.index === p.index) continue;
    out.push(p);
  }
  return out;
}

/**
 * 词流断句（带时间戳）。返回的字幕条按源顺序排列。
 * words 的 start/end 单位为秒，输出 startTime/endTime 为毫秒。
 */
export function segmentWords(
  words: readonly WordWithTime[],
  lang: string,
  preset: Preset = 'standard',
  options: { watchabilityMerge?: boolean } = {},
): DpSegment[] {
  if (words.length === 0) return [];
  const profile = getProfile(lang);
  const units = normalizeWords(words);
  if (units.length === 0) return [];

  const spans = layoutSpans(units, profile, preset, options.watchabilityMerge !== false);

  const out: DpSegment[] = [];
  for (const [s, e] of spans) {
    const slice = units.slice(s, e + 1);
    const orig = words.slice(s, e + 1);
    out.push({
      text: joinWords(slice.map((u) => u.text)),
      startTime: Math.round((slice[0]!.start ?? 0) * 1000),
      endTime: Math.round((slice[slice.length - 1]!.end ?? 0) * 1000),
      wordStart: s,
      wordEnd: e,
      words: orig,
    });
  }
  // 时间轴单独铺：把每条的显示时间填进前后停顿，降低单条 CPS、消掉闪帧短条
  return padCueTimings(out, { maxDuration: profile.maxDuration });
}

/** 纯文本断句（离线测试 / 复刻用，不带时间信息）。 */
export function segmentText(text: string, lang: string, preset: Preset = 'standard'): Segment[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const profile = getProfile(lang);
  const units: TimedUnit[] = tokens.map((t) => ({ text: t, start: Number.NaN, end: Number.NaN }));
  const normalized = lang === 'zh' || lang.startsWith('zh') ? units : normalizeWords(units);
  const spans = layoutSpans(normalized, profile, preset, true);
  const out: Segment[] = [];
  for (const [s, e] of spans) {
    out.push({
      text: joinWords(
        normalized
          .slice(s, e + 1)
          .map((u) => u.text),
      ),
      reason: 'subtitle-layout',
    });
  }
  return out;
}

/** 硬切分 → 排版 DP → watchability，返回最终词区间。 */
function layoutSpans(
  units: readonly { text: string; start: number | null; end: number | null }[],
  profile: LanguageProfile,
  preset: Preset,
  watchability: boolean,
): Array<[number, number]> {
  const n = units.length;
  const hard = buildSplitPoints(
    units.map((u) => u.text),
    profile,
  );
  const semanticSpans = splitPointsToSpans(n, hard);

  const budget = spanBudgetFor(profile, preset);
  const layout: SplitPoint[] = [];
  if (budget) {
    const timed = units.map((u) => ({
      text: u.text,
      start: Number.isFinite(u.start as number) ? (u.start as number) : null,
      end: Number.isFinite(u.end as number) ? (u.end as number) : null,
    }));
    for (const [s, e] of semanticSpans) {
      for (const cut of dpSplitSpan(timed, s, e, profile, budget)) {
        layout.push({ index: cut, reason: 'subtitle-layout' });
      }
    }
  }

  const merged = mergeSplitPoints(hard, layout);
  let spans = splitPointsToSpans(n, merged);
  if (!watchability) return spans;
  spans = mergeWatchabilitySpans(
    units.map((u) => ({
      text: u.text,
      start: Number.isFinite(u.start as number) ? (u.start as number) : null,
      end: Number.isFinite(u.end as number) ? (u.end as number) : null,
    })),
    spans,
    profile,
    preset,
  );
  return spans;
}
