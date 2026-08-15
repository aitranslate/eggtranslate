// DP 软切分代价常量。

import { CHARS_PER_WORD_BUDGET } from './profiles';

/**
 * 过短碎片下限（单位与长度预算一致：拉丁=词，CJK=字）。
 * ≤ 此值的 DP 段在 **合并后仍 ≤ hard limit** 时才会被吸收。
 */
export const MIN_FRAGMENT_UNITS = 3;

/**
 * 孤儿尾巴：右侧段不超过该单位则允许粘回上一行（拉丁=词，CJK=字）。
 * 独立于具体文本，只看长度。
 */
export const ORPHAN_TAIL_LATIN_UNITS = 4;
export const ORPHAN_TAIL_CJK_UNITS = 8;

/** 粘孤儿尾巴时允许超出 hard 的词/字缓冲（避免 16+3 因顶格无法合并）。 */
export const ORPHAN_MERGE_GRACE_UNITS = 4;

/** 孤儿尾巴自身时长上限（毫秒）。更长的短句是正常应答，不按尾巴处理。 */
export const ORPHAN_TAIL_MAX_MS = 1500;

/** watchability / 闪帧合并允许的段间间隔（毫秒）。 */
export const WATCHABILITY_GAP_MS = 800;

/** 闪帧段时长上限（毫秒）：短于此的段视为一闪而过，优先吸收进相邻行。 */
export const FLASH_MS = 800;

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

/** 小于此间隔视为时间粘连（首尾相接 / 抖动），强制切时最后才落刀。 */
export const GLUE_GAP_SEC = 0.08;

/** 粘连词界代价（高于普通词界，低于 Forbidden）。 */
export const GLUED_WORD_COST = 8.5;

/** DP 对 ≤2 单位段的额外代价，避免「台」「风」单独成行。 */
export const SHORT_SEGMENT_PENALTY = 3.5;

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
