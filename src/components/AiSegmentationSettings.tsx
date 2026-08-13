import React from 'react';
import { useAiSegmentationEnabled, useSetAiSegmentationEnabled } from '@/stores/transcriptionStore';

interface AiSegmentationSettingsProps {
  compact?: boolean;
}

export const AiSegmentationSettings: React.FC<AiSegmentationSettingsProps> = ({
  compact = false,
}) => {
  const enabled = useAiSegmentationEnabled();
  const setEnabled = useSetAiSegmentationEnabled();

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <h3 className={compact ? 'text-xs font-semibold text-[var(--wb-text)]' : 'apple-heading-small'}>
        AI 断句
      </h3>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-[var(--wb-border)]"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          data-testid="ai-segmentation-toggle"
        />
        <span className="text-xs text-[var(--wb-text-2)]">由 AI 辅助断句</span>
      </label>
    </div>
  );
};
