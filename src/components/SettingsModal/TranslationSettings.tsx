import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { collapseMotion } from '@/motion';
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

/** 方案 A：白底细边，focus 不换底 */
const inputClass =
  'w-full p-2.5 bg-[var(--wb-panel)] border border-[var(--wb-border)] rounded-[10px] text-[var(--wb-text)] text-sm hover:border-[var(--wb-border-strong)] focus:outline-none focus:border-[var(--wb-brand)] focus:ring-2 focus:ring-[var(--wb-brand-soft)] focus:bg-[var(--wb-panel)] transition-[border-color,box-shadow]';

export const TranslationSettings: React.FC<TranslationSettingsProps> = ({
  config,
  onConfigChange,
  onSelectProvider,
  onUpdateActiveProfile,
  sections = 'all',
  compactParams = false,
}) => {
  const [paramsOpen, setParamsOpen] = useState(sections === 'params' && !compactParams);
  const reduceMotion = useReducedMotion();
  const collapse = collapseMotion(reduceMotion);
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
              <p className="text-xs text-[var(--wb-text-3)]">点选服务商即切换；每家各自保存 Key，URL/模型可改</p>
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
                  上下文 {config.contextBefore}/{config.contextAfter} · 批次 {config.batchSize} · 并发{' '}
                  {config.threadCount}
                  {config.rpm ? ` · RPM ${config.rpm}` : ''}
                </span>
              </button>
              <AnimatePresence initial={false}>
                {paramsOpen && (
                  <motion.div
                    {...collapse}
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
                  className={`w-4 h-4 text-[var(--wb-text-3)] transition-transform duration-200 shrink-0 ${
                    paramsOpen ? 'rotate-0' : '-rotate-90'
                  }`}
                />
                <h3 className="apple-heading-small">翻译参数</h3>
                {!paramsOpen && (
                  <span className="text-xs text-[var(--wb-text-3)] font-normal ml-1">
                    上下文 {config.contextBefore}/{config.contextAfter} · 批次 {config.batchSize} · 并发{' '}
                    {config.threadCount}
                  </span>
                )}
              </button>

              <AnimatePresence initial={false}>
                {paramsOpen && (
                  <motion.div {...collapse} className="overflow-hidden">
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
    : 'block text-xs font-medium text-[var(--wb-text-2)] mb-1.5';
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
          <label className={labelCls}>LLM 并发</label>
          <input
            type="number"
            min="1"
            max="10"
            value={config.threadCount}
            onChange={(e) => onConfigChange('threadCount', parseInt(e.target.value))}
            className={inputClass}
            title="批译与 AI 断句共用"
            aria-label="LLM 并发，批译与 AI 断句共用"
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
    </>
  );
}
