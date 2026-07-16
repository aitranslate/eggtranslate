import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { LlmProfile, TranslationConfig } from '@/types';
import type { LlmProviderId } from '@/constants/llmProviders';
import { LanguageSelector } from './LanguageSelector';
import { ApiTestForm } from './ApiTestForm';
import { SettingsHint } from '../SettingsHint';
import { getActiveProfile } from '@/utils/llmProfiles';

export type TranslationSettingsSection = 'all' | 'provider' | 'language' | 'params';

interface TranslationSettingsProps {
  config: TranslationConfig;
  onConfigChange: (
    field: keyof TranslationConfig,
    value: TranslationConfig[keyof TranslationConfig]
  ) => void;
  onSelectProvider: (id: LlmProviderId) => void;
  onUpdateActiveProfile: (patch: Partial<Omit<LlmProfile, 'id' | 'presetId'>>) => void;
  /** 工作台卡片分区时只渲染一块；默认 all */
  sections?: TranslationSettingsSection;
  /** 参数区更紧凑、默认折叠高级说明 */
  compactParams?: boolean;
}

const inputClass =
  'w-full p-2.5 bg-[var(--wb-panel-2,#f5f5f7)] border border-transparent rounded-[10px] text-[var(--apple-text-primary,#1d1d1f)] text-sm focus:outline-none focus:border-[var(--apple-blue)] focus:ring-2 focus:ring-[var(--apple-blue-soft)] focus:bg-[var(--wb-panel,#fff)] transition-all';

export const TranslationSettings: React.FC<TranslationSettingsProps> = ({
  config,
  onConfigChange,
  onSelectProvider,
  onUpdateActiveProfile,
  sections = 'all',
  compactParams = false,
}) => {
  const [paramsOpen, setParamsOpen] = useState(sections === 'params' && !compactParams);
  const activeProfile = getActiveProfile(config);
  const showHeadings = sections === 'all';
  const showProvider = sections === 'all' || sections === 'provider';
  const showLanguage = sections === 'all' || sections === 'language';
  const showParams = sections === 'all' || sections === 'params';

  return (
    <>
      {showProvider && (
        <div className="space-y-3">
          {showHeadings && (
            <>
              <h3 className="apple-heading-small">翻译服务</h3>
              <p className="text-xs text-gray-400">点选服务商即切换；每家各自保存 Key，URL/模型可改</p>
            </>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ApiTestForm
              profiles={config.profiles}
              activeProfile={activeProfile}
              onSelectProvider={onSelectProvider}
              onUpdateActiveProfile={onUpdateActiveProfile}
            />
          </div>
        </div>
      )}

      {showLanguage && (
        <div className="space-y-3">
          {showHeadings && (
            <>
              <h3 className="apple-heading-small">语言配置</h3>
              <SettingsHint>选择字幕的源语言和翻译输出的目标语言。</SettingsHint>
            </>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <LanguageSelector
              label="源语言"
              value={config.sourceLanguage}
              onChange={(value) => onConfigChange('sourceLanguage', value)}
            />
            <LanguageSelector
              label="目标语言"
              value={config.targetLanguage}
              onChange={(value) => onConfigChange('targetLanguage', value)}
            />
          </div>
        </div>
      )}

      {showParams && (
        <div className="space-y-2">
          {sections === 'params' && compactParams ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setParamsOpen((v) => !v)}
                className="flex items-center gap-1.5 w-full text-left text-[11.5px] text-[var(--wb-text-2)]"
                aria-expanded={paramsOpen}
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-200 shrink-0 ${
                    paramsOpen ? 'rotate-0' : '-rotate-90'
                  }`}
                />
                <span>
                  上下文 {config.contextBefore}/{config.contextAfter} · 批次 {config.batchSize} · 线程{' '}
                  {config.threadCount}
                  {config.rpm ? ` · RPM ${config.rpm}` : ''}
                </span>
              </button>
              <AnimatePresence initial={false}>
                {paramsOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden"
                  >
                    <ParamsFields config={config} onConfigChange={onConfigChange} inputClass={inputClass} compact />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : sections === 'params' ? (
            <div className="space-y-3">
              <ParamsFields config={config} onConfigChange={onConfigChange} inputClass={inputClass} />
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setParamsOpen((v) => !v)}
                className="flex items-center gap-1.5 w-full text-left"
                aria-expanded={paramsOpen}
              >
                <ChevronDown
                  className={`w-4 h-4 text-gray-500 transition-transform duration-200 shrink-0 ${
                    paramsOpen ? 'rotate-0' : '-rotate-90'
                  }`}
                />
                <h3 className="apple-heading-small">翻译参数</h3>
                {!paramsOpen && (
                  <span className="text-xs text-gray-400 font-normal ml-1">
                    上下文 {config.contextBefore}/{config.contextAfter} · 批次 {config.batchSize} · 线程{' '}
                    {config.threadCount}
                  </span>
                )}
              </button>

              <AnimatePresence initial={false}>
                {paramsOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-3 pt-1">
                      <ParamsFields config={config} onConfigChange={onConfigChange} inputClass={inputClass} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </div>
      )}
    </>
  );
};

function ParamsFields({
  config,
  onConfigChange,
  inputClass,
  compact = false,
}: {
  config: TranslationConfig;
  onConfigChange: TranslationSettingsProps['onConfigChange'];
  inputClass: string;
  compact?: boolean;
}) {
  const labelCls = compact
    ? 'block text-[10.5px] font-medium text-[var(--wb-text-3)] mb-1'
    : 'block text-xs font-medium text-gray-600 mb-1.5';
  return (
    <>
      <div className={`grid grid-cols-2 md:grid-cols-4 ${compact ? 'gap-2' : 'gap-3'}`}>
        <div>
          <label className={labelCls}>前置上下文</label>
          <input
            type="number"
            min="0"
            max="10"
            value={config.contextBefore}
            onChange={(e) => onConfigChange('contextBefore', parseInt(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelCls}>后置上下文</label>
          <input
            type="number"
            min="0"
            max="10"
            value={config.contextAfter}
            onChange={(e) => onConfigChange('contextAfter', parseInt(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelCls}>批次大小</label>
          <input
            type="number"
            min="1"
            max="50"
            value={config.batchSize}
            onChange={(e) => onConfigChange('batchSize', parseInt(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelCls}>线程数</label>
          <input
            type="number"
            min="1"
            max="10"
            value={config.threadCount}
            onChange={(e) => onConfigChange('threadCount', parseInt(e.target.value))}
            className={inputClass}
          />
        </div>
      </div>

      <div className={`grid grid-cols-1 md:grid-cols-2 ${compact ? 'gap-2 mt-2' : 'gap-3'}`}>
        <div>
          <label className={labelCls}>RPM 限制</label>
          <input
            type="number"
            min="0"
            max="1000"
            placeholder="不限制"
            value={config.rpm || ''}
            onChange={(e) =>
              onConfigChange('rpm', e.target.value === '' ? 0 : parseInt(e.target.value))
            }
            className={inputClass}
          />
        </div>
      </div>

      {/* Agent 翻译：增量能力；关闭时完全走现有批译 */}
      <div
        className={`${compact ? 'mt-2' : 'mt-3'} rounded-lg border border-[var(--wb-border)] bg-[var(--wb-panel-2)] p-3`}
      >
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-[var(--wb-border)]"
            checked={Boolean(config.agentTranslationEnabled)}
            onChange={(e) => onConfigChange('agentTranslationEnabled', e.target.checked)}
            data-testid="agent-translation-toggle"
          />
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-[var(--wb-text)]">
              Agent 翻译
            </span>
            <span className="block text-[11px] text-[var(--wb-text-3)] mt-0.5 leading-snug">
              开启后：术语 Agent（tool loop）→ 分窗翻译 Subagent → QA 审校/重跑 →
              断点续跑；译文仍走现有流式上屏。关闭则完全使用原来的批译路径。
            </span>
          </span>
        </label>
        {config.agentTranslationEnabled && (
          <div className={`grid grid-cols-2 ${compact ? 'gap-2 mt-2' : 'gap-3 mt-3'}`}>
            <div>
              <label className={labelCls}>Agent 窗大小</label>
              <input
                type="number"
                min="5"
                max="80"
                value={config.agentWindowSize ?? 30}
                onChange={(e) =>
                  onConfigChange('agentWindowSize', parseInt(e.target.value) || 30)
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelCls}>Agent 窗并发</label>
              <input
                type="number"
                min="1"
                max="8"
                value={config.agentMaxConcurrency ?? 3}
                onChange={(e) =>
                  onConfigChange('agentMaxConcurrency', parseInt(e.target.value) || 3)
                }
                className={inputClass}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
