// DP 软切分代价常量 —— 与 D:\voxtrans 的 subtitle_layout.rs 保持一致。
// 导出便于后续调参。

/** 长度预算的硬上限倍数：span 长度 ≤ limit * 1.15 时永不切（核心保证短句不被碎片化）。 */
export const KEEP_INTACT_RATIO = 1.15;

/** 过短碎片下限（单位与长度预算一致：拉丁=词，CJK=字）。≤ 此值的 DP 段会被吸收进相邻段。 */
export const MIN_FRAGMENT_UNITS = 2.0;

/** 长度惩罚相对边界代价的权重（0.3：边界质量主导，长度拟合次之）。 */
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
