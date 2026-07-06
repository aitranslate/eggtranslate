import React, { useState, useCallback } from 'react';
import { useTranslationConfigStore, useTranslationConfig } from '@/stores/translationConfigStore';
import { useKeytermGroups, useUpdateKeytermGroups } from '@/stores/transcriptionStore';
import { TranslationSettings } from './SettingsModal/TranslationSettings';
import { TranscriptionSettings } from './TranscriptionSettings';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, TestTube, Settings as SettingsIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { useErrorHandler } from '@/hooks/useErrorHandler';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'translation' | 'transcription';

interface TestResult {
  success: boolean;
  message: string;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  // Translation config
  const config = useTranslationConfig();
  const updateConfig = useTranslationConfigStore((state) => state.updateConfig);

  // Transcription config (热词分组)
  const keytermGroups = useKeytermGroups();
  const updateKeytermGroups = useUpdateKeytermGroups();

  // 测试连接相关状态
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // 使用统一错误处理
  const { handleError } = useErrorHandler();

  const [activeTab, setActiveTab] = useState<TabType>('transcription');
  const [formData, setFormData] = useState(config);

  // 在模态框打开时同步最新的配置
  React.useEffect(() => {
    if (isOpen) {
      setFormData(config);
      setActiveTab('transcription');
      setTestResult(null);
    }
  }, [isOpen, config]);

  // 测试 API 连接
  const onTestConnection = useCallback(async () => {
    const currentApiKey = formData.apiKey?.trim();

    if (!currentApiKey || currentApiKey === '') {
      setTestResult({ success: false, message: '请先输入API密钥' });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      // 获取第一个 API Key
      const apiKey = currentApiKey.split('|').map(key => key.trim()).filter(key => key.length > 0)[0];

      const response = await fetch(`${formData.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: formData.model,
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 10
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      await response.json();
      setTestResult({ success: true, message: '连接成功！API配置正常' });
    } catch (error) {
      handleError(error, {
        context: { operation: 'API 连接测试' },
        showToast: false
      });
      const message = error instanceof Error ? error.message : '连接失败';
      setTestResult({ success: false, message });
    } finally {
      setIsTesting(false);
    }
  }, [formData, handleError]);

  const onSave = useCallback(async () => {
    try {
      await updateConfig(formData);
      toast.success('设置已保存');
      onClose();
    } catch (error) {
      handleError(error, {
        context: { operation: '保存翻译设置' }
      });
    }
  }, [formData, updateConfig, onClose, handleError]);

  const onInputChange = useCallback(
    (
      field: keyof typeof config,
      value: import('@/types').TranslationConfig[keyof import('@/types').TranslationConfig]
    ) => {
      setFormData(prev => ({ ...prev, [field]: value }));
    },
    []
  );

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
        className="bg-white shadow-2xl w-full max-w-[calc(100vw-2rem)] md:max-w-[560px] lg:max-w-[680px] rounded-none md:rounded-2xl p-4 md:p-6 max-h-[100dvh] md:max-h-[90vh] overflow-y-auto pb-24 md:pb-6"
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.3 }}
          className="flex items-center justify-between mb-6"
        >
          <h2 className="apple-heading-medium">设置</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors active:scale-90"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </motion.div>

        {/* 标签页切换 */}
        <div className="flex gap-2 mb-6 bg-gray-100 p-1 rounded-xl">
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

        <div className="space-y-6">
          {activeTab === 'translation' ? (
            <>
              <TranslationSettings
                config={formData}
                onConfigChange={onInputChange}
                testResult={testResult}
              />

              {/* 操作按钮 */}
              <div className="flex justify-between items-center pt-4 border-t border-gray-200">
                {/* 左侧：测试连接按钮 */}
                <button
                  onClick={onTestConnection}
                  disabled={isTesting || !formData.apiKey}
                  className="apple-button apple-button-secondary px-6 py-2.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.97]"
                >
                  <TestTube className={`h-4 w-4 ${isTesting ? 'animate-spin' : ''}`} />
                  <span>{isTesting ? '测试中...' : '测试连接'}</span>
                </button>

                {/* 右侧：取消和保存按钮 */}
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
      </motion.div>

      {/* 移动端底部 sticky 操作栏 */}
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
              onClick={onClose}
              className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium active:scale-95 transition-transform"
            >
              取消
            </button>
            <button
              type="button"
              onClick={onSave}
              className="flex-[2] py-3 bg-blue-600 text-white rounded-lg text-sm font-medium active:scale-95 transition-transform"
            >
              保存设置
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
};
