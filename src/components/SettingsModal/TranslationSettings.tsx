import React from 'react';
import { TranslationConfig } from '@/types';
import { LanguageSelector } from './LanguageSelector';
import { ApiTestForm } from './ApiTestForm';

interface TranslationSettingsProps {
  config: TranslationConfig;
  onConfigChange: (field: keyof TranslationConfig, value: any) => void;
  testResult: { success: boolean; message: string } | null;
}

export const TranslationSettings: React.FC<TranslationSettingsProps> = ({
  config,
  onConfigChange,
  testResult
}) => {
  return (
    <>
      {/* API 配置 */}
      <div className="space-y-4">
        <h3 className="apple-heading-small">API 配置</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ApiTestForm config={config} onConfigChange={onConfigChange} testResult={testResult} />
        </div>
      </div>

      {/* 语言配置 */}
      <div className="space-y-4">
        <h3 className="apple-heading-small">语言配置</h3>

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

      {/* 翻译参数 */}
      <div className="space-y-4">
        <h3 className="apple-heading-small">翻译参数</h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              前置上下文
            </label>
            <input
              type="number"
              min="0"
              max="10"
              value={config.contextBefore}
              onChange={(e) => onConfigChange('contextBefore', parseInt(e.target.value))}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              后置上下文
            </label>
            <input
              type="number"
              min="0"
              max="10"
              value={config.contextAfter}
              onChange={(e) => onConfigChange('contextAfter', parseInt(e.target.value))}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              批次大小
            </label>
            <input
              type="number"
              min="1"
              max="50"
              value={config.batchSize}
              onChange={(e) => onConfigChange('batchSize', parseInt(e.target.value))}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              线程数
            </label>
            <input
              type="number"
              min="1"
              max="10"
              value={config.threadCount}
              onChange={(e) => onConfigChange('threadCount', parseInt(e.target.value))}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
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
              onChange={(e) => onConfigChange('rpm', e.target.value === '' ? 0 : parseInt(e.target.value))}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
            />
          </div>
        </div>
      </div>
    </>
  );
};
