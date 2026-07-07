// 类型定义：复刻 D:\voxtrans 的断句流水线（Layer1 硬切分 + Layer2 DP 软切分）。
// 仅做文本分析，不依赖任何 AI。

/** 长度预算预设，对应 voxtrans 的 SubtitleLengthPreset。 */
export type Preset = 'short' | 'standard' | 'loose';

/** 一个分词单元。纯文本场景下 start/end 不填（VAD 静音项在 DP 中为可选）。 */
export interface WordToken {
  word: string;
  start?: number;
  end?: number;
}

/** 断句原因：硬切分（句末标点）或 DP 软切分（超长句按代价再切）。 */
export type SplitReason = 'hard' | 'subtitle-layout';

/** 最终输出的一段文本。 */
export interface Segment {
  text: string;
  reason: SplitReason;
}

/**
 * 可选的 VAD 静音查询：给定相邻两个 token，返回它们之间的静音秒数；
 * 无时间戳的纯文本场景不传，DP 会跳过该代价项（与 voxtrans 默认行为一致）。
 */
export type SilenceQuery = (left: WordToken, right: WordToken) => number | null;

/** 转录产出的单词级时间戳单元（start/end 单位为秒）。 */
export interface WordWithTime {
  text: string;
  start: number;
  end: number;
}

/**
 * 音频流（带时间戳）经 DP 断句后的产物。
 * startTime/endTime 为毫秒，对齐 SubtitleEntry 的字段；wordStart/wordEnd 为
 * 在原始 words 数组中的闭区间下标，便于回写 words 切片。
 */
export interface DpSegment {
  text: string;
  startTime: number;
  endTime: number;
  wordStart: number;
  wordEnd: number;
  words: WordWithTime[];
}
