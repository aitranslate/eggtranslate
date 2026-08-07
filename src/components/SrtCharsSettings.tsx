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
    </div>
  );
};
