/**
 * Step 5.1: 原文拆分 prompt
 * 与 VoxTrans build_source_split_prompt 完全一致
 */
export function buildSourceSplitPrompt(params: {
  sourceLanguage: string;
  targetLanguage: string;
  fullSourceText: string;
  fullDraftTranslation: string;
  sourceText: string;
  sourceLimit: number;
  targetLimit: number;
  splitRound: number;
  mustSplit: boolean;
}): object {
  return {
    task: 'binary_split_source_segment_for_subtitle_alignment',
    rule: 'Think step by step internally, but output JSON only.',
    sourceLanguage: params.sourceLanguage,
    targetLanguage: params.targetLanguage,
    fullSourceText: params.fullSourceText,
    fullDraftTranslation: params.fullDraftTranslation,
    sourceText: params.sourceText,
    sourceLengthLimit: params.sourceLimit,
    targetLengthLimit: params.targetLimit,
    splitRound: params.splitRound,
    mustSplit: params.mustSplit,
    constraints: [
      'Return sourceParts only.',
      'sourceParts must be an array with either one or two strings.',
      'Use one string only when mustSplit is false and there is no natural semantic split.',
      'If mustSplit is true, return two strings.',
      'Use two strings when sourceText is too long and has a natural split point.',
      'Most sourceText values sent to this task are too long; prefer two complete chunks unless splitting would clearly damage meaning.',
      'Keep original language and wording. Do not translate.',
      'Do not reorder meaning. Keep sequence from sourceText.',
      'The strings joined together must reproduce sourceText exactly, aside from whitespace normalization.',
      'Use fullDraftTranslation only as context for semantic boundaries; do not output translation.',
      'Prefer complete clauses or sentence-like chunks over equal lengths.',
      'The length limits are soft. Never cut a word, CJK phrase, name, title, number, amount, percentage, date, or punctuation unit just to hit the limit.',
      'Avoid ultra-short fragments like single discourse markers.',
    ],
    output: { sourceParts: ['part 1', 'part 2'] },
  };
}

/**
 * Step 5.2: 译文对齐 prompt
 * 与 VoxTrans build_align_prompt 完全一致
 */
export function buildAlignPrompt(params: {
  sourceLanguage: string;
  targetLanguage: string;
  theme: string;
  sourceText: string;
  draftTranslation: string;
  splitSourceLines: { id: number; source: string }[];
  terminology: { source: string; target: string; note: string }[];
}): object {
  return {
    task: 'align_translation_to_split_source_lines',
    rule: 'Return JSON only.',
    sourceLanguage: params.sourceLanguage,
    targetLanguage: params.targetLanguage,
    theme: params.theme,
    sourceText: params.sourceText,
    draftTranslation: params.draftTranslation,
    splitSourceLines: params.splitSourceLines,
    terminology: params.terminology,
    constraints: [
      'Return exactly one translation line for each split source line id.',
      'Keep meaning faithful and natural.',
      'Do not merge lines.',
      'Do not copy full draftTranslation to multiple ids.',
      'Each id should only contain meaning from its own source line.',
      'If uncertain, keep a shorter partial translation for that line only.',
      'Do not add explanations.',
    ],
    output: {
      translations: [{ id: 1, text: 'translated text' }],
    },
  };
}
