import React, { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslationConfigStore, useTranslationConfig } from '@/stores/translationConfigStore';
import { TranslationSettings } from './SettingsModal/TranslationSettings';
import { TranscriptionSettings } from './TranscriptionSettings';
import { motion, AnimatePresence } from 'framer-motion';
import { Save, TestTube, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import type { LlmProfile, TranslationConfig } from '@/types';
import type { LlmProviderId } from '@/constants/llmProviders';
import {
  ensureProfiles,
  getActiveProfile,
  selectProvider,
  updateActiveProfile,
} from '@/utils/llmProfiles';
import { toastError } from '@/utils/appToast';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { testLlmConnection } from '@/services/llmTranslationService';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SettingsHint } from '@/components/SettingsHint';
import { shouldConfirmDiscardSettings } from '@/utils/uxHelpers';
import { useIsTranslationConfigured } from '@/stores/translationConfigStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { isTranscriptionApiConfigured } from '@/utils/taskGuards';

interface SettingsModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  /** @deprecated 抽屉模式为主 */
  variant?: 'panel' | 'modal' | 'drawer';
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen = true,
  onClose,
}) => {
  const config = useTranslationConfig();
  const updateConfig = useTranslationConfigStore((state) => state.updateConfig);
  const closeSettings = useWorkspaceStore((s) => s.closeSettings);
  const openEditor = useWorkspaceStore((s) => s.openEditor);
  const settingsFocus = useWorkspaceStore((s) => s.settingsFocus);
  const clearSettingsFocus = useWorkspaceStore((s) => s.clearSettingsFocus);
  const isTranslationConfigured = useIsTranslationConfigured();
  const transcriptionApiKeys = useTranscriptionStore((s) => s.apiKeys);
  const isTranscriptionConfigured = isTranscriptionApiConfigured(transcriptionApiKeys);
  const isMobile = useIsMobile();

  const [isTesting, setIsTesting] = useState(false);
  const { handleError } = useErrorHandler();
  const [formData, setFormData] = useState<TranslationConfig>(() => ensureProfiles(config));
  const [dirty, setDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const doClose = useCallback(() => {
    setShowDiscardConfirm(false);
    setDirty(false);
    onClose?.();
    closeSettings();
  }, [onClose, closeSettings]);

  /** 有未保存翻译草稿时先确认，再丢弃关闭 */
  const handleClose = useCallback(() => {
    if (shouldConfirmDiscardSettings(dirty)) {
      setShowDiscardConfirm(true);
      return;
    }
    doClose();
  }, [dirty, doClose]);

  // 打开时锁 body 滚动，避免底层页跟着滑
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // 打开时：若有未保存草稿则保留；否则从 store 同步
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!isOpen) return;
    if (dirtyRef.current) return;
    setFormData(ensureProfiles(config));
    setDirty(false);
  }, [isOpen, config]);

  // 深链到翻译 / 转录区块
  useEffect(() => {
    if (!isOpen || !settingsFocus) return;
    const id =
      settingsFocus === 'transcription'
        ? 'settings-section-transcription'
        : 'settings-section-translation';
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      clearSettingsFocus();
    }, 80);
    return () => window.clearTimeout(t);
  }, [isOpen, settingsFocus, clearSettingsFocus]);

  const activeProfile = getActiveProfile(formData);

  const onTestConnection = useCallback(async () => {
    setIsTesting(true);
    try {
      const result = await testLlmConnection(activeProfile);
      if (result.ok === false) {
        toastError(result.message);
        return;
      }
      toast.success('连接成功，API 配置正常');
    } catch (error) {
      handleError(error, {
        context: { operation: 'API 连接测试' },
        showToast: false,
      });
      toastError(error instanceof Error ? error.message : '连接失败');
    } finally {
      setIsTesting(false);
    }
  }, [activeProfile, handleError]);

  const onSave = useCallback(async () => {
    try {
      await updateConfig(ensureProfiles(formData));
      setDirty(false);
      toast.success('设置已保存');
      // 直接关闭，勿走 handleClose（闭包里 dirty 可能仍为 true 会误弹确认）
      doClose();
      openEditor();
    } catch (error) {
      handleError(error, { context: { operation: '保存翻译设置' } });
    }
  }, [formData, updateConfig, handleError, doClose, openEditor]);

  const onInputChange = useCallback(
    (field: keyof TranslationConfig, value: TranslationConfig[keyof TranslationConfig]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      setDirty(true);
    },
    []
  );

  const onSelectProvider = useCallback((id: LlmProviderId) => {
    setFormData((prev) => selectProvider(prev, id));
    setDirty(true);
  }, []);

  const onUpdateActiveProfile = useCallback(
    (patch: Partial<Omit<LlmProfile, 'id' | 'presetId'>>) => {
      setFormData((prev) => updateActiveProfile(prev, patch));
      setDirty(true);
    },
    []
  );

  const sheet = (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="wb-drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={handleClose}
            aria-hidden
          />
          <motion.aside
            className={`wb-drawer${isMobile ? ' is-mobile-sheet' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wb-settings-title"
            initial={isMobile ? { y: '100%' } : { x: '100%' }}
            animate={isMobile ? { y: 0 } : { x: 0 }}
            exit={isMobile ? { y: '100%' } : { x: '100%' }}
            transition={{ type: 'tween', duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          >
            <header className="wb-drawer-header">
              <div className="min-w-0">
                <h2 id="wb-settings-title" className="wb-drawer-title">
                  设置
                </h2>
                {dirty && <span className="wb-prefs-dirty">未保存的更改</span>}
              </div>
              <button
                type="button"
                className="wb-proj-icon-btn"
                onClick={handleClose}
                aria-label="关闭设置"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="wb-drawer-scroll wb-drawer-scroll-full">
              <section className="wb-drawer-section" id="settings-section-translation">
                <header className="wb-prefs-section-head">
                  <h3>翻译</h3>
                  <p>服务商、密钥与源/目标语言</p>
                </header>
                {!isTranslationConfigured && (
                  <div className="wb-prefs-block ob-settings-hint-block">
                    <SettingsHint>
                      上手：选择服务商预设 → 填入 API Key → 点「测试连接」→「保存」。密钥只保存在本机浏览器。
                    </SettingsHint>
                  </div>
                )}
                <div className="wb-prefs-block">
                  <TranslationSettings
                    config={formData}
                    onConfigChange={onInputChange}
                    onSelectProvider={onSelectProvider}
                    onUpdateActiveProfile={onUpdateActiveProfile}
                    sections="provider"
                  />
                </div>
                <div className="wb-prefs-block">
                  <h4 className="wb-prefs-block-title">语言</h4>
                  <TranslationSettings
                    config={formData}
                    onConfigChange={onInputChange}
                    onSelectProvider={onSelectProvider}
                    onUpdateActiveProfile={onUpdateActiveProfile}
                    sections="language"
                  />
                </div>
              </section>

              <section className="wb-drawer-section" id="settings-section-transcription">
                <header className="wb-prefs-section-head">
                  <h3>转录</h3>
                  <p>AssemblyAI、字幕长度与热词</p>
                </header>
                {!isTranscriptionConfigured && (
                  <div className="wb-prefs-block ob-settings-hint-block">
                    <SettingsHint>
                      音视频路径：填入 AssemblyAI API Key → 导入 MP4/MP3 等 → 点「转录 / 转译」。可配置多个 Key（用 | 分隔）轮询。
                    </SettingsHint>
                  </div>
                )}
                <div className="wb-prefs-block">
                  <TranscriptionSettings compact />
                </div>
              </section>

              <section className="wb-drawer-section">
                <header className="wb-prefs-section-head">
                  <h3>高级参数</h3>
                  <p>上下文、批次与限速，一般保持默认即可</p>
                </header>
                <div className="wb-prefs-block">
                  <TranslationSettings
                    config={formData}
                    onConfigChange={onInputChange}
                    onSelectProvider={onSelectProvider}
                    onUpdateActiveProfile={onUpdateActiveProfile}
                    sections="params"
                  />
                </div>
              </section>
            </div>

            <footer className="wb-drawer-footer">
              <button
                type="button"
                className="wb-tool"
                onClick={onTestConnection}
                disabled={isTesting || !activeProfile.apiKey}
              >
                <TestTube className={`h-3.5 w-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                {isTesting ? '测试中…' : '测试连接'}
              </button>
              <div className="wb-prefs-footer-spacer" />
              <button type="button" className="wb-tool" onClick={handleClose}>
                关闭
              </button>
              <button type="button" className="wb-tool primary" onClick={onSave}>
                <Save className="h-3.5 w-3.5" />
                保存
              </button>
            </footer>
          </motion.aside>

          <ConfirmDialog
            isOpen={showDiscardConfirm}
            onClose={() => setShowDiscardConfirm(false)}
            onConfirm={doClose}
            title="放弃未保存的更改？"
            message="翻译 API / 语言等修改尚未保存，关闭后将丢失。"
            confirmText="放弃更改"
            cancelText="继续编辑"
            tone="danger"
          />
        </>
      )}
    </AnimatePresence>
  );

  // Portal 到 body，避免被 m-shell / workbench 层叠上下文裁切或压住
  if (typeof document !== 'undefined') {
    return createPortal(sheet, document.body);
  }
  return sheet;
};
