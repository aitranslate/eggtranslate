// 断句常量 —— 与 OneAsr crates/oneasr-core/src/sentence_boundary 保持一致。
// 改这里之前先看 OneAsr 的 boundary_rules.rs / subtitle_layout.rs / watchability_merge.rs 同名常量。

/** 边界基础代价（越低越好切）。 */
export const TERMINAL_COST = 0.5;
export const SOFT_COST = 1.0;
export const COMMA_COST = 1.5;
export const CONNECTOR_COST = 2.5;
export const WORD_COST = 6.0;
/** 句尾落在 了/着/的、日语韩语光杆助词、连词上：比普通词界更差。 */
export const WEAK_ENDING_COST = 10.0;
export const FORBIDDEN_COST = Number.POSITIVE_INFINITY;

/** 真实停顿（秒）：即使没有 VAD 也算好切点。 */
export const GOOD_SILENCE_SEC = 0.35;
/** 小于此间隔视为时间粘连（0ms 抖动），切在其上比普通词界更差。 */
export const GLUE_GAP_SEC = 0.08;
/** 粘连词界的代价（向 WORD_COST 插值）。 */
export const GLUED_WORD_COST = 8.5;

/** 1–2 单位段的额外代价，避免「台」「风」单独成行。 */
export const SHORT_SEGMENT_PENALTY = 3.5;
/** 长度惩罚相对边界代价的权重。 */
export const LENGTH_PENALTY_WEIGHT = 0.3;

/** 略超目标时允许的词/字缓冲；超出即强制切。 */
export const LENGTH_GRACE_UNITS = 2.0;
/** 字符 grace ≈ 词 grace × 5.5。 */
export const LENGTH_GRACE_CHARS = 11.0;
/** ≤ 该单位的段在合并后仍不超上限时被吸收。 */
export const MIN_FRAGMENT_UNITS = 3.0;

/** 预算内（VadInsideBudget）判定的强停顿门槛。 */
export const VAD_QUALITY_SILENCE_SEC = 0.5;
export const VAD_INSIDE_BUDGET_SILENCE_SEC = 0.55;
export const INSIDE_BUDGET_GAP_SEC = 0.5;

/** watchability：闪帧段时长上限（秒）。 */
export const FLASH_SEC = 0.8;
/** 孤儿尾巴自身时长上限（秒）。 */
export const ORPHAN_TAIL_MAX_SEC = 1.5;
/** 允许合并的段间静音。 */
export const WATCHABILITY_GAP_SEC = 0.8;
/** 普通合并的时长预算。 */
export const MERGE_BUDGET_SEC = 6.0;
/** 孤儿 / 开放定语回粘允许放宽到的时长预算。 */
export const ORPHAN_MERGE_BUDGET_SEC = 7.5;
export const ORPHAN_TAIL_LATIN_UNITS = 4.0;
export const ORPHAN_TAIL_CJK_UNITS = 8.0;
export const ORPHAN_MERGE_GRACE_UNITS = 4.0;
/** 拉丁显示字符预算系数。 */
export const CHARS_PER_WORD_BUDGET = 5.5;
