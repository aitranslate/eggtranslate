// DP 软切分代价常量。

import { CHARS_PER_WORD_BUDGET } from './profiles';

/**
 * 过短碎片下限（单位与长度预算一致：拉丁=词，CJK=字）。
 * ≤ 此值的 DP 段在 **合并后仍 ≤ hard limit** 时才会被吸收。
 */
export const MIN_FRAGMENT_UNITS = 2.0;

/**
 * 无「好切点」时允许略超设置长度的词/字缓冲。
 * 例：短=12 → 词最多整句保留 14。
 */
export const LENGTH_GRACE_UNITS = 2;

/** 字符 grace ≈ 词 grace × 5.5 → 11 */
export const LENGTH_GRACE_CHARS = Math.round(LENGTH_GRACE_UNITS * CHARS_PER_WORD_BUDGET);

/**
 * 静音多久才算「好切点」（秒）。
 * 词间正常缝隙（~50–200ms）不算；明显停顿才允许 quality 模式切开。
 */
export const GOOD_SILENCE_SEC = 0.35;

/** 长度惩罚相对边界代价的权重（边界质量主导，长度拟合次之）。 */
export const LENGTH_PENALTY_WEIGHT = 0.3;

/** 禁止切分位置的代价（数字内 / 配对标点内）。 */
export const FORBIDDEN_COST = Infinity;

/** 各边界类型的基础代价（越低越优先切）。 */
export const BOUNDARY_COST = {
  terminal: 0.5, // 句末标点
  soft: 1.0, // 分号 / 冒号
  comma: 1.5, // 逗号
  connector: 2.5, // 连词前
  word: 6.0, // 普通词界（最差合法切；不算「好切点」）
} as const;
