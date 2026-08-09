/**
 * 服务商 = 配置：点选即切换到该套 LLM（各自独立 Key/URL/模型）
 */

import React from 'react';
import { Check, ExternalLink, Settings2 } from 'lucide-react';
import {
  LLM_PROVIDER_PRESETS,
  type LlmProviderId,
  getProviderById,
} from '@/constants/llmProviders';

interface ProviderPresetPickerProps {
  /** 当前选中的服务商 id */
  selectedId: LlmProviderId;
  /** 当前档案实际使用的模型名（可能被用户改过） */
  activeModel?: string;
  /** 已填 Key 的服务商（小圆点提示） */
  configuredIds?: Set<string>;
  onSelect: (id: LlmProviderId) => void;
}

export const ProviderPresetPicker: React.FC<ProviderPresetPickerProps> = ({
  selectedId,
  activeModel,
  configuredIds,
  onSelect,
}) => {
  const selected = getProviderById(selectedId);
  const modelLabel = (activeModel || selected.model || '').trim();

  return (
    <div className="space-y-2 md:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <label className="block text-sm font-medium text-[var(--wb-text-2)]">服务商</label>
        {selected.keyUrl && (
          <a
            href={selected.keyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-[var(--wb-brand)] hover:text-[var(--wb-brand)] shrink-0"
          >
            获取 {selected.shortName} Key
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      <div className="grid grid-cols-5 gap-1.5" role="listbox" aria-label="选择服务商">
        {LLM_PROVIDER_PRESETS.map((preset) => {
          const isSelected = selectedId === preset.id;
          const hasKey = configuredIds?.has(preset.id);
          return (
            <button
              key={preset.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => onSelect(preset.id)}
              title={`${preset.name}${preset.hint ? ` · ${preset.hint}` : ''}${hasKey ? ' · 已配置' : ''}`}
              className={`
                relative flex flex-col items-center gap-1 p-2 rounded-xl border transition-all duration-150
                active:scale-[0.97]
                ${
                  isSelected
                    ? 'border-[var(--wb-brand)] bg-[var(--wb-brand-soft)] shadow-sm ring-1 ring-[var(--palette-brand-soft-strong)]'
                    : 'border-[var(--wb-border)] bg-[var(--wb-panel)] hover:border-[var(--wb-border-strong)]'
                }
              `}
            >
              {preset.badge && (
                <span
                  className={`absolute -top-1.5 -right-1 z-10 px-1 py-0.5 text-[9px] font-semibold leading-none rounded-full text-[var(--palette-on-brand)] shadow-sm ${
                    preset.badgeTone === 'recommend'
                      ? 'bg-[var(--wb-brand)]'
                      : preset.badgeTone === 'free'
                        ? 'bg-[var(--palette-success)]'
                        : 'bg-[var(--wb-text-3)]'
                  }`}
                >
                  {preset.badge}
                </span>
              )}
              {preset.iconSrc ? (
                <span
                  className={`wb-provider-icon-wrap${preset.iconMono ? ' is-mono' : ''}`}
                >
                  <img
                    src={preset.iconSrc}
                    alt=""
                    className="wb-provider-icon"
                    draggable={false}
                  />
                </span>
              ) : (
                <span className="wb-provider-icon-wrap wb-provider-icon-fallback">
                  <Settings2 className="w-3.5 h-3.5" strokeWidth={2} />
                </span>
              )}
              <span
                className={`text-[10px] font-medium leading-tight text-center truncate w-full ${
                  isSelected ? 'text-[var(--apple-blue)]' : 'text-[var(--wb-text-2)]'
                }`}
              >
                {preset.shortName}
              </span>
              {isSelected ? (
                <span className="wb-provider-check" aria-hidden>
                  <Check className="w-2.5 h-2.5" strokeWidth={3} />
                </span>
              ) : hasKey ? (
                <span
                  className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--apple-success)]"
                  aria-hidden
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {(selected.hint || modelLabel) && (
        <p className="text-xs text-[var(--wb-text-3)]">
          {selected.name}
          {selected.hint ? ` · ${selected.hint}` : ''}
          {modelLabel ? ` · ${modelLabel}` : ''}
        </p>
      )}
    </div>
  );
};
