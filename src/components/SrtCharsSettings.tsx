import React from 'react';
import { useSubtitleLengthPreset, useSetSubtitleLengthPreset, useAiSegmentationEnabled, useSetAiSegmentationEnabled } from '@/stores/transcriptionStore';
import { PRESET_LABELS } from '@/utils/subtitleLengthPresets';
import type { SubtitleLengthPreset } from '@/types/transcription';
import { SettingsHint } from './SettingsHint';

const PRESETS: SubtitleLengthPreset[] = ['short', 'standard', 'loose'];

export const SrtCharsSettings: React.FC = () => {
  const preset = useSubtitleLengthPreset();
  const setPreset = useSetSubtitleLengthPreset();
  const aiEnabled = useAiSegmentationEnabled();
  const setAiEnabled = useSetAiSegmentationEnabled();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="apple-heading-small">AI 断句对齐</h3>
        <button
          onClick={() => setAiEnabled(!aiEnabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            aiEnabled ? 'bg-violet-500' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              aiEnabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      <SettingsHint>智能分割长句，让字幕更易读；下方选择字幕长度偏好。</SettingsHint>

      {aiEnabled && (
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
      )}

      {!aiEnabled && (
        <p className="text-xs text-gray-500">翻译完成后不进行断句对齐，保持原始字幕分段</p>
      )}
    </div>
  );
};
