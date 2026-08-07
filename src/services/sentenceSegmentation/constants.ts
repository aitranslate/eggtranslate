// DP 软切分代价常量。

/**
 * 过短碎片下限（单位与长度预算一致：拉丁=词，CJK=字）。
 * ≤ 此值的 DP 段在 **合并后仍 ≤ hard limit** 时才会被吸收。
 */
export const MIN_FRAGMENT_UNITS = 2.0;

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
  word: 6.0, // 普通词界（最差合法切）
} as const;
