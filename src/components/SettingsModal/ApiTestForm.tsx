import React, { useState } from 'react';
import { AlertCircle, CheckCircle, Eye, EyeOff } from 'lucide-react';
import { motion } from 'framer-motion';
import { TranslationConfig } from '@/types';

interface ApiTestFormProps {
  config: TranslationConfig;
  onConfigChange: (field: keyof TranslationConfig, value: string | number | undefined) => void;
  testResult: { success: boolean; message: string } | null;
}

export const ApiTestForm: React.FC<ApiTestFormProps> = ({ config, onConfigChange, testResult }) => {
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <>
      {/* API 密钥输入 */}
      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          API 密钥 *
        </label>
        <div className="relative">
          <input
            type={showApiKey ? 'text' : 'password'}
            value={config.apiKey}
            onChange={(e) => onConfigChange('apiKey', e.target.value)}
            placeholder="sk-..."
            className="w-full p-3 pr-12 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
          />
          <button
            type="button"
            onClick={() => setShowApiKey(!showApiKey)}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Base URL */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Base URL
        </label>
        <input
          type="text"
          value={config.baseURL}
          onChange={(e) => onConfigChange('baseURL', e.target.value)}
          className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
        />
      </div>

      {/* 模型 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          模型
        </label>
        <input
          type="text"
          value={config.model}
          onChange={(e) => onConfigChange('model', e.target.value)}
          placeholder="例如: gpt-3.5-turbo, gpt-4, claude-3-sonnet"
          className="w-full p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
        />
      </div>

      {/* 测试结果 */}
      {testResult && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`md:col-span-2 p-4 rounded-xl border flex items-center gap-2 ${
            testResult.success
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {testResult.success ? (
            <CheckCircle className="h-5 w-5" />
          ) : (
            <AlertCircle className="h-5 w-5" />
          )}
          <span>{testResult.message}</span>
        </motion.div>
      )}
    </>
  );
};
