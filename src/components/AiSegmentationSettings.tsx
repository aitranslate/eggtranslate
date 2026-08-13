import React from 'react';
import { useAiSegmentationEnabled, useSetAiSegmentationEnabled } from '@/stores/transcriptionStore';

interface AiSegmentationSettingsProps {
  compact?: boolean;
}

/**
 * AI 断句兜底开关（转录设置区）。
 * 开启后：规则断句找不到合适断点的句子，交给翻译服务配置的 LLM 找断点；
 * 调用失败自动回退规则断句，关闭则完全走原 DP 逻辑。
 */
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
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded border-[var(--wb-border)]"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          data-testid="ai-segmentation-toggle"
        />
        <span className="min-w-0">
          <span className="block text-xs font-medium text-[var(--wb-text)]">
            找不到合适断点时交给 AI
          </span>
          <span className="block text-[11px] text-[var(--wb-text-3)] mt-0.5 leading-snug">
            规则断句对长句硬切且没有标点/停顿可用时，用翻译服务的 LLM 找断点。
            失败自动回退规则断句；关闭后完全使用原规则逻辑，不受影响。
          </span>
        </span>
      </label>
    </div>
  );
};
