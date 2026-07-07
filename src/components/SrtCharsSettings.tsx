import React from 'react';
import { useSubtitleLengthPreset, useSetSubtitleLengthPreset } from '@/stores/transcriptionStore';
import { PRESET_LABELS } from '@/utils/subtitleLengthPresets';
import type { SubtitleLengthPreset } from '@/types/transcription';
import { SettingsHint } from './SettingsHint';

const PRESETS: SubtitleLengthPreset[] = ['short', 'standard', 'loose'];

export const SrtCharsSettings: React.FC = () => {
  const preset = useSubtitleLengthPreset();
  const setPreset = useSetSubtitleLengthPreset();

  return (
    <div className="space-y-3">
      <h3 className="apple-heading-small">字幕长度</h3>
      <SettingsHint>转录阶段会自动断句：超长句按语义/标点再切，下方选择字幕长度偏好。</SettingsHint>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                preset === p
                  ? 'bg-violet-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          {preset === 'short' && '英文≤12词 / 中文≤16字'}
          {preset === 'standard' && '英文≤16词 / 中文≤22字'}
          {preset === 'loose' && '英文≤20词 / 中文≤28字'}
        </p>
      </div>
    </div>
  );
};
