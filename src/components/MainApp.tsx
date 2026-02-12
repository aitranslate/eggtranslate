import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Settings,
  BookOpen,
  History
} from 'lucide-react';
import { FileUpload } from './FileUpload';
import { BatchFileUpload } from './BatchFileUpload';
import { SubtitleFileList } from './SubtitleFileList';
import { TranslationControls } from './TranslationControls';
import { SubtitleEditor } from './SubtitleEditor';
import { ProgressDisplay } from './ProgressDisplay';
import { SettingsModal } from './SettingsModal';
import { TermsManager } from './TermsManager';
import { HistoryModal } from './HistoryModal';
import { HelpButton } from './HelpButton';
import { GuideModal } from './GuideModal';
import { useFiles } from '@/stores/subtitleStore';
import { useIsTranslationConfigured } from '@/stores/translationConfigStore';
import { useHistory } from '@/contexts/HistoryContext';
import { SubtitleFile, SubtitleFileMetadata } from '@/types';
import { useTerms } from '@/contexts/TermsContext';
import dataManager from '@/services/dataManager';
import { useErrorHandler } from '@/hooks/useErrorHandler';

// 滚动动画观察器 Hook
const useScrollAnimation = () => {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animated');
          }
        });
      },
      {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
      }
    );

    document.querySelectorAll('.apple-animate-on-scroll').forEach((el) => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);
};

export const MainApp: React.FC = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTermsOpen, setIsTermsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
  const files = useFiles();
  const isConfigured = useIsTranslationConfigured();
  const { history } = useHistory();
  const { terms } = useTerms();

  const { handleError } = useErrorHandler();
  useScrollAnimation();

  const handleEditFile = useCallback((file: SubtitleFileMetadata) => {
    setEditingFileId(file.id);
    setIsEditingModalOpen(true);
  }, []);

  const handleCloseEditModal = useCallback(async () => {
    try {
      await dataManager.forcePersistAllData();
      console.log('数据已持久化到localforage');
    } catch (error) {
      handleError(error, {
        context: { operation: '数据持久化' },
        showToast: false
      });
    } finally {
      setIsEditingModalOpen(false);
      setEditingFileId(null);
    }
  }, [handleError]);

  return (
    <div className="apple-style min-h-screen w-full">
      {/* Apple 风格导航栏 */}
      <nav className="apple-navbar">
        <div className="apple-navbar-content">
          <h1 className="apple-heading-small">蛋蛋字幕翻译</h1>

          <div className="flex items-center gap-6">
            <button
              onClick={() => setIsTermsOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-gray-100 transition-colors"
            >
              <BookOpen className="h-4 w-4" />
              <span className="text-sm">术语</span>
              {terms.length > 0 && (
                <span className="px-1.5 py-0.5 text-xs bg-blue-500 text-white rounded-full">
                  {terms.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setIsHistoryOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full hover:bg-gray-100 transition-colors"
            >
              <History className="h-4 w-4" />
              <span className="text-sm">历史</span>
              {history.length > 0 && (
                <span className="px-1.5 py-0.5 text-xs bg-blue-500 text-white rounded-full">
                  {history.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setIsSettingsOpen(true)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors ${
                isConfigured
                  ? 'text-gray-600 hover:bg-gray-100'
                  : 'text-orange-600 bg-orange-50 hover:bg-orange-100'
              }`}
            >
              <Settings className="h-4 w-4" />
              <span className="text-sm">设置</span>
              {!isConfigured && (
                <span className="px-1.5 py-0.5 text-xs bg-orange-500 text-white rounded-full">
                  必须
                </span>
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* 主内容区域 */}
      <main className="apple-container apple-section">
        {/* Hero 区域 - 欢迎标题 */}
        <div className="apple-animate-on-scroll text-center mb-16 pt-8">
          <h2 className="apple-heading-hero mb-4">
            字幕翻译，重新定义
          </h2>
          <p className="apple-body-large max-w-2xl mx-auto mb-8">
            支持音视频转录、SRT 翻译、术语管理。本地处理，隐私安全。
          </p>
        </div>

        {/* 上传区域 - 突出显示 */}
        <div className="apple-animate-on-scroll apple-delay-100 mb-16">
          <div className="apple-card-large p-12">
            <BatchFileUpload />
          </div>
        </div>

        {/* 文件列表 */}
        {files.length > 0 && (
          <div className="apple-animate-on-scroll apple-delay-200">
            <SubtitleFileList
              onEditFile={handleEditFile}
            />
          </div>
        )}
      </main>

      {/* 底部信息 */}
      <footer className="apple-container apple-section">
        <div className="apple-body-small text-center text-gray-500">
          <p>SRT 字幕翻译 • 音视频转录 • 本地处理 • 隐私安全</p>
        </div>
      </footer>

      {/* 模态框 */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
      <TermsManager
        isOpen={isTermsOpen}
        onClose={() => setIsTermsOpen(false)}
      />
      <HistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
      />
      <GuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
      />
      <SubtitleEditor
        isOpen={isEditingModalOpen}
        onClose={handleCloseEditModal}
        fileId={editingFileId || ''}
      />
      <HelpButton onClick={() => setIsGuideOpen(true)} />
    </div>
  );
};
