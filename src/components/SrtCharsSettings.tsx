import React from 'react';
import { useSubtitleLengthPreset, useSetSubtitleLengthPreset } from '@/stores/transcriptionStore';
import { PRESET_LABELS } from '@/utils/subtitleLengthPresets';
import type { SubtitleLengthPreset } from '@/types/transcription';

const PRESETS: SubtitleLengthPreset[] = ['short', 'standard', 'loose'];

interface SrtCharsSettingsProps {
  compact?: boolean;
}

export const SrtCharsSettings: React.FC<SrtCharsSettingsProps> = ({ compact = false }) => {
  const preset = useSubtitleLengthPreset();
  const setPreset = useSetSubtitleLengthPreset();

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <h3 className={compact ? 'text-xs font-semibold text-[var(--wb-text)]' : 'apple-heading-small'}>
        字幕长度
      </h3>
      {!compact && (
        <p className="text-xs text-gray-500">
          转录阶段自动断句；超长句按语义/标点再切。
        </p>
      )}

      <div className="space-y-1.5">
        <div className="wb-seg" role="group" aria-label="字幕长度">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={preset === p ? 'is-active' : ''}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
        <p className="text-[10.5px] text-[var(--wb-text-3)]">
          {preset === 'short' && '英文≤12词 / 中文≤16字'}
          {preset === 'standard' && '英文≤16词 / 中文≤22字'}
          {preset === 'loose' && '英文≤20词 / 中文≤28字'}
        </p>
      </div>
    </div>
  );
};
