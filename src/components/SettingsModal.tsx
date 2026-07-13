import React, { useState, useCallback } from 'react';
import { useTranslationConfigStore, useTranslationConfig } from '@/stores/translationConfigStore';
import { TranslationSettings } from './SettingsModal/TranslationSettings';
import { TranscriptionSettings } from './TranscriptionSettings';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, TestTube } from 'lucide-react';
import toast from 'react-hot-toast';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import type { LlmProfile, TranslationConfig } from '@/types';
import type { LlmProviderId } from '@/constants/llmProviders';
import {
  ensureProfiles,
  getActiveProfile,
  isTranslationLlmConfigured,
  selectProvider,
  updateActiveProfile,
} from '@/utils/llmProfiles';
import { useApiKeys } from '@/stores/transcriptionStore';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'translation' | 'transcription';

interface TestResult {
  success: boolean;
  message: string;
}

/** 缺翻译 Key 优先翻译；翻译已配且缺转录 Key 则转录；否则默认翻译 */
function resolveDefaultTab(
  config: TranslationConfig,
  transcriptionKeys: string
): TabType {
  const translationOk = isTranslationLlmConfigured(config);
  const transcriptionOk = transcriptionKeys.trim().length > 0;
  if (!translationOk) return 'translation';
  if (!transcriptionOk) return 'transcription';
  return 'translation';
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const config = useTranslationConfig();
  const updateConfig = useTranslationConfigStore((state) => state.updateConfig);
  const transcriptionKeys = useApiKeys();

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const { handleError } = useErrorHandler();

  const [activeTab, setActiveTab] = useState<TabType>('translation');
  const [formData, setFormData] = useState<TranslationConfig>(() => ensureProfiles(config));

  React.useEffect(() => {
    if (isOpen) {
      const normalized = ensureProfiles(config);
      setFormData(normalized);
      setActiveTab(resolveDefaultTab(normalized, transcriptionKeys));
      setTestResult(null);
    }
  }, [isOpen, config, transcriptionKeys]);

  const activeProfile = getActiveProfile(formData);

  const onTestConnection = useCallback(async () => {
    const currentApiKey = activeProfile.apiKey?.trim();

    if (!currentApiKey) {
      setTestResult({ success: false, message: '请先输入API密钥' });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const apiKey = currentApiKey
        .split('|')
        .map((key) => key.trim())
        .filter((key) => key.length > 0)[0];

      const response = await fetch(`${activeProfile.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: activeProfile.model,
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 10,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          (errorData as { error?: { message?: string } })?.error?.message ||
            `HTTP ${response.status}`
        );
      }

      await response.json();
      setTestResult({ success: true, message: '连接成功！API配置正常' });
    } catch (error) {
      handleError(error, {
        context: { operation: 'API 连接测试' },
        showToast: false,
      });
      const message = error instanceof Error ? error.message : '连接失败';
      setTestResult({ success: false, message });
    } finally {
      setIsTesting(false);
    }
  }, [activeProfile, handleError]);

  const onSave = useCallback(async () => {
    try {
      await updateConfig(ensureProfiles(formData));
      toast.success('设置已保存');
      onClose();
    } catch (error) {
      handleError(error, {
        context: { operation: '保存翻译设置' },
      });
    }
  }, [formData, updateConfig, onClose, handleError]);

  const onInputChange = useCallback(
    (field: keyof TranslationConfig, value: TranslationConfig[keyof TranslationConfig]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const onSelectProvider = useCallback((id: LlmProviderId) => {
    setFormData((prev) => selectProvider(prev, id));
    setTestResult(null);
  }, []);

  const onUpdateActiveProfile = useCallback((patch: Partial<Omit<LlmProfile, 'id' | 'presetId'>>) => {
    setFormData((prev) => updateActiveProfile(prev, patch));
  }, []);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      >
        <motion.div
          initial={{ scale: 0.92, y: 24, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.95, y: 8, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 28 }}
          className="bg-white shadow-2xl w-full max-w-[calc(100vw-2rem)] md:max-w-[560px] lg:max-w-[680px] rounded-2xl max-h-[calc(100dvh-2rem)] md:max-h-[min(90vh,calc(100dvh-2rem))] flex flex-col overflow-hidden"
        >
          <div className="shrink-0 px-5 pt-6 pb-4 md:px-6 md:pt-6 md:pb-5 border-b border-gray-100">
            <div className="flex items-center justify-between mb-5">
              <h2 className="apple-heading-medium">设置</h2>
              <button
                onClick={onClose}
                className="p-2 -mr-1 hover:bg-gray-100 rounded-full transition-colors active:scale-90"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            <div className="flex gap-2 bg-gray-100 p-1 rounded-xl">
              <button
                onClick={() => setActiveTab('transcription')}
                className={`flex-1 px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'transcription'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                转录设置
              </button>
              <button
                onClick={() => setActiveTab('translation')}
                className={`flex-1 px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'translation'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                翻译设置
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 md:px-6 md:py-5 pb-28 md:pb-5">
            <div className="space-y-6">
              {activeTab === 'translation' ? (
                <>
                  <TranslationSettings
                    config={formData}
                    onConfigChange={onInputChange}
                    onSelectProvider={onSelectProvider}
                    onUpdateActiveProfile={onUpdateActiveProfile}
                    testResult={testResult}
                  />

                  <div className="hidden md:flex justify-between items-center pt-4 border-t border-gray-200">
                    <button
                      onClick={onTestConnection}
                      disabled={isTesting || !activeProfile.apiKey}
                      className="apple-button apple-button-secondary px-6 py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97]"
                    >
                      <TestTube className={`h-4 w-4 ${isTesting ? 'animate-spin' : ''}`} />
                      <span>{isTesting ? '测试中...' : '测试连接'}</span>
                    </button>

                    <div className="flex gap-3">
                      <button
                        onClick={onClose}
                        className="apple-button apple-button-ghost px-6 py-2.5 text-sm active:scale-[0.97]"
                      >
                        取消
                      </button>
                      <button
                        onClick={onSave}
                        className="apple-button px-6 py-2.5 text-sm active:scale-[0.97]"
                      >
                        <Save className="h-4 w-4" />
                        <span>保存设置</span>
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <TranscriptionSettings />
              )}
            </div>
          </div>
        </motion.div>

        <AnimatePresence>
          {activeTab === 'translation' && (
            <motion.div
              key="mobile-action-bar"
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="fixed bottom-0 left-0 right-0 md:hidden bg-white border-t border-gray-200 p-3 flex gap-2 z-50"
            >
              <button
                type="button"
                onClick={onTestConnection}
                disabled={isTesting || !activeProfile.apiKey}
                className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium active:scale-95 transition-transform disabled:opacity-50"
              >
                {isTesting ? '测试中…' : '测试'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium active:scale-95 transition-transform"
              >
                取消
              </button>
              <button
                type="button"
                onClick={onSave}
                className="flex-[1.4] py-3 bg-blue-600 text-white rounded-lg text-sm font-medium active:scale-95 transition-transform"
              >
                保存
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
};
