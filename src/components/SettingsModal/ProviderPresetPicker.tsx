/**
 * 服务商 = 配置：点选即切换到该套 LLM（各自独立 Key/URL/模型）
 */

import React from 'react';
import { ExternalLink, Settings2 } from 'lucide-react';
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
        <label className="block text-sm font-medium text-gray-700">服务商</label>
        {selected.keyUrl && (
          <a
            href={selected.keyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 shrink-0"
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
                    ? 'border-blue-500 bg-blue-50/80 shadow-sm shadow-blue-500/10'
                    : 'border-gray-100 bg-gray-50/60 hover:border-gray-200 hover:bg-white'
                }
              `}
            >
              {preset.badge && (
                <span
                  className={`absolute -top-1.5 -right-1 z-10 px-1 py-0.5 text-[9px] font-semibold leading-none rounded-full text-white shadow-sm ${
                    preset.badgeTone === 'recommend'
                      ? 'bg-blue-500'
                      : preset.badgeTone === 'free'
                        ? 'bg-emerald-500'
                        : 'bg-gray-500'
                  }`}
                >
                  {preset.badge}
                </span>
              )}
              {preset.iconSrc ? (
                <img
                  src={preset.iconSrc}
                  alt=""
                  className="w-7 h-7 object-contain"
                  draggable={false}
                />
              ) : (
                <span className="w-7 h-7 rounded-lg bg-gray-200/80 flex items-center justify-center">
                  <Settings2 className="w-3.5 h-3.5 text-gray-600" />
                </span>
              )}
              <span
                className={`text-[10px] font-medium leading-tight text-center truncate w-full ${
                  isSelected ? 'text-blue-700' : 'text-gray-600'
                }`}
              >
                {preset.shortName}
              </span>
              {hasKey && !isSelected && (
                <span
                  className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-500"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>

      {(selected.hint || modelLabel) && (
        <p className="text-xs text-gray-500">
          {selected.name}
          {selected.hint ? ` · ${selected.hint}` : ''}
          {modelLabel ? ` · ${modelLabel}` : ''}
        </p>
      )}
    </div>
  );
};
