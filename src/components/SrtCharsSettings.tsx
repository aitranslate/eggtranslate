import React from 'react';
import {
  useSrtCharsPerCaption,
  useSetSrtCharsPerCaption
} from '@/stores/transcriptionStore';

export const SrtCharsSettings: React.FC = () => {
  const chars = useSrtCharsPerCaption();
  const setChars = useSetSrtCharsPerCaption();

  return (
    <div className="flex items-center gap-4">
      <h3 className="apple-heading-small">字幕长度</h3>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={5}
          max={150}
          value={chars}
          onChange={(e) => {
            const val = parseInt(e.target.value) || 32;
            setChars(val);
          }}
          className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-sm"
        />
      </div>
    </div>
  );
};
