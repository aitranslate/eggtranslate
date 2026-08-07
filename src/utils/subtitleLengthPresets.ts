import type { SubtitleLengthPreset } from '@/types/transcription';
import { CJK_CHAR_LIMITS, WORD_LIMITS } from '@/services/sentenceSegmentation/profiles';

export const PRESET_LABELS: Record<SubtitleLengthPreset, string> = {
  short: '短',
  standard: '标准',
  loose: '宽松',
};

/** 与断句 hard limit 同源，供设置页文案 */
export function presetLimitHint(preset: SubtitleLengthPreset): string {
  return `英文≤${WORD_LIMITS[preset]}词 / 中文≤${CJK_CHAR_LIMITS[preset]}字`;
}
