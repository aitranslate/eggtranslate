// 时间轴铺停顿 —— 断句只决定「切成哪几段」，这里决定「每段在屏幕上待多久」。
//
// 为什么需要它：CPS（字符/秒）由语音本身的语速决定，切分改变不了它（切完还是
// 同样的字/秒）。但可读性看的是**这一条**的字符/秒 —— 把每条的显示时间铺进前后
// 停顿里，就能在不改一个字的前提下把 CPS 拉下来，并顺手消掉一闪而过的短条。
//
// 取值来自 Netflix TTSG：单条最短 5/6 秒、最长 7 秒、相邻两条至少留 2 帧
// （24fps ≈ 0.083s）空隙。字幕允许比语音早出现一点点（lead-in），给观众读的时间。
//
// 关键约束：铺尾部空隙时必须给下一条**预留** lead-in，否则前一条会把空隙吃干，
// 后一条只能贴着语音出现。

import type { DpSegment, WordWithTime } from './types';

/** 相邻两条之间的最小空隙：2 帧 @24fps。 */
export const MIN_GAP_SEC = 0.083;
/** 字幕可以比语音早出现一点点，给观众读的时间。 */
export const LEAD_IN_SEC = 0.12;
/** Netflix 单条最短时长 5/6 秒。 */
export const MIN_DURATION_SEC = 5 / 6;

export interface PadOptions {
  /** 单条最长时长（秒），取 profile.maxDuration。 */
  maxDuration: number;
}

/**
 * 把每条的时间向后铺到「下一条要出现的位置」前，并向前留 lead-in。
 * 保证：相邻不重叠且留最小空隙、不超单条最长时长、尽量满足最短时长。
 *
 * 只改 startTime/endTime，不动文本与词区间。
 */
export function padCueTimings(segments: readonly DpSegment[], opts: PadOptions): DpSegment[] {
  if (segments.length === 0) return [];
  const maxMs = opts.maxDuration > 0 ? opts.maxDuration * 1000 : Number.POSITIVE_INFINITY;
  const gapMs = MIN_GAP_SEC * 1000;
  const leadMs = LEAD_IN_SEC * 1000;
  const minDurMs = MIN_DURATION_SEC * 1000;

  const out = segments.map((s) => ({ ...s }));
  const wordStartMs = (seg: DpSegment): number | null => {
    const first = seg.words[0] as WordWithTime | undefined;
    return first ? first.start * 1000 : null;
  };
  const wordEndMs = (seg: DpSegment): number | null => {
    const last = seg.words[seg.words.length - 1] as WordWithTime | undefined;
    return last ? last.end * 1000 : null;
  };

  for (let i = 0; i < out.length; i++) {
    const cur = out[i]!;
    const ws = wordStartMs(cur);
    const we = wordEndMs(cur);
    if (ws == null || we == null) continue;

    const prev = out[i - 1];
    const next = out[i + 1];
    const nextWordStart = next ? wordStartMs(next) : null;

    // 前界：不越过上一条 + 最小空隙
    const lower = prev ? prev.endTime + gapMs : 0;
    // 上界：给下一条预留 lead-in + 空隙（没有下一条就只看本条最长时长）
    const upper =
      nextWordStart == null
        ? Number.POSITIVE_INFINITY
        : Math.min(nextWordStart - leadMs - gapMs, nextWordStart - gapMs);

    let start = Math.max(Math.min(ws - leadMs, ws), lower);
    let end = Math.min(Math.max(we, upper), start + maxMs);
    end = Math.max(end, we);

    if (end - start < minDurMs) {
      end = Math.min(start + minDurMs, Math.max(upper, we));
      if (end - start < minDurMs) start = Math.max(lower, end - minDurMs);
    }
    end = Math.min(end, start + maxMs);

    if (end <= start) continue;
    cur.startTime = Math.round(start);
    cur.endTime = Math.round(end);
  }

  // 取整后可能擦边：统一夹一次，保证严格递增且留空隙
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]!;
    const cur = out[i]!;
    const floor = prev.endTime + Math.round(gapMs);
    if (cur.startTime < floor) {
      cur.startTime = floor;
      if (cur.endTime <= cur.startTime) cur.endTime = cur.startTime + 1;
    }
  }
  return out;
}
