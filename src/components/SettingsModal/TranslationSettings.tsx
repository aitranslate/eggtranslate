import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { LlmProfile, TranslationConfig } from '@/types';
import type { LlmProviderId } from '@/constants/llmProviders';
import { LanguageSelector } from './LanguageSelector';
import { ApiTestForm } from './ApiTestForm';
import { SettingsHint } from '../SettingsHint';
import { getActiveProfile } from '@/utils/llmProfiles';

interface TranslationSettingsProps {
  config: TranslationConfig;
  onConfigChange: (
    field: keyof TranslationConfig,
    value: TranslationConfig[keyof TranslationConfig]
  ) => void;
  onSelectProvider: (id: LlmProviderId) => void;
  onUpdateActiveProfile: (patch: Partial<Omit<LlmProfile, 'id' | 'presetId'>>) => void;
  testResult: { success: boolean; message: string } | null;
}

const inputClass =
  'w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all';

export const TranslationSettings: React.FC<TranslationSettingsProps> = ({
  config,
  onConfigChange,
  onSelectProvider,
  onUpdateActiveProfile,
  testResult,
}) => {
  const [paramsOpen, setParamsOpen] = useState(false);
  const activeProfile = getActiveProfile(config);

  return (
    <>
      <div className="space-y-3">
        <h3 className="apple-heading-small">翻译服务</h3>
        <p className="text-xs text-gray-400">点选服务商即切换；每家各自保存 Key，URL/模型可改</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          <ApiTestForm
            profiles={config.profiles}
            activeProfile={activeProfile}
            onSelectProvider={onSelectProvider}
            onUpdateActiveProfile={onUpdateActiveProfile}
            testResult={testResult}
          />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="apple-heading-small">语言配置</h3>
        <SettingsHint>选择字幕的源语言和翻译输出的目标语言。</SettingsHint>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
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

      <div className="space-y-2">
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
                <SettingsHint>
                  上下文携带前后相邻句，提高术语和语气一致性；批次/线程/RPM 控制请求速率。
                </SettingsHint>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">前置上下文</label>
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
                    <label className="block text-sm font-medium text-gray-700 mb-2">后置上下文</label>
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
                    <label className="block text-sm font-medium text-gray-700 mb-2">批次大小</label>
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
                    <label className="block text-sm font-medium text-gray-700 mb-2">线程数</label>
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      RPM 限制 (每分钟请求数)
                    </label>
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
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
};
