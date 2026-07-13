import React, { useState, useCallback, useEffect } from 'react';
import {
  Settings,
  BookOpen,
  History,
  Menu
} from 'lucide-react';
import { BatchFileUpload } from './BatchFileUpload';
import { SubtitleFileList } from './SubtitleFileList';
import { SubtitleEditor } from './SubtitleEditor';
import { SettingsModal } from './SettingsModal';
import { TermsManager } from './TermsManager';
import { HistoryModal } from './HistoryModal';
import { PWAInstallBanner } from './PWAInstallBanner';
import { MobileMenu } from './MobileMenu';
import { useFileCount } from '@/stores/filesStore';
import { useIsTranslationConfigured } from '@/stores/translationConfigStore';
import { useHistoryStore } from '@/stores/historyStore';
import { SubtitleFileMetadata } from '@/types';
import { useTermsStore } from '@/stores/termsStore';

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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [isEditingModalOpen, setIsEditingModalOpen] = useState(false);
  // Only length — progress/entry content must not re-render the shell
  const fileCount = useFileCount();
  const isConfigured = useIsTranslationConfigured();
  const history = useHistoryStore((state) => state.history);
  const terms = useTermsStore((state) => state.terms);

  useScrollAnimation();

  const handleEditFile = useCallback((file: SubtitleFileMetadata) => {
    setEditingFileId(file.id);
    setIsEditingModalOpen(true);
  }, []);

  const handleCloseEditModal = useCallback(async () => {
    // Stores auto-persist, no need for manual forcePersistAllData
    setIsEditingModalOpen(false);
    setEditingFileId(null);
  }, []);

  return (
    <div className="apple-style min-h-screen w-full">
      {/* Apple 风格导航栏 */}
      <nav className="apple-navbar">
        <div className="apple-navbar-content">
          <div className="flex items-center gap-2">
            <h1 className="apple-heading-small">蛋蛋字幕翻译</h1>
            <span className="hidden md:inline-block px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded-full">v1.2</span>
          </div>

          {/* 桌面端：水平按钮组（≥768px 显示） */}
          <div className={`hidden md:flex items-center gap-3 ${isEditingModalOpen ? 'pointer-events-none opacity-50' : ''}`}>
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

          {/* 移动端：汉堡按钮（<768px 显示） */}
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className={`md:hidden w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 ${isEditingModalOpen ? 'pointer-events-none opacity-50' : ''}`}
            aria-label="打开菜单"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </nav>

      {/* 主内容区域 */}
      <main className="apple-container apple-section">
        {/* Hero：静态文案，避免首屏 framer 逐字弹簧 */}
        <div className="text-center mb-16 pt-8">
          <h2 className="apple-heading-hero mb-4">字幕翻译，重新定义</h2>
          <p className="apple-body-large max-w-2xl mx-auto mb-8">
            支持音视频转录、SRT 翻译、术语管理。本地处理，隐私安全。
          </p>
        </div>

        {/* 上传区域 - 突出显示 */}
        <div className="mb-16">
          <div className="apple-card-large p-12">
            <BatchFileUpload />
          </div>
        </div>

        {/* 文件列表：仅按数量显示，内容更新由列表自身订阅 */}
        {fileCount > 0 && (
          <SubtitleFileList
            onEditFile={handleEditFile}
          />
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
      <SubtitleEditor
        isOpen={isEditingModalOpen}
        onClose={handleCloseEditModal}
        fileId={editingFileId || ''}
      />
      <PWAInstallBanner />
      <MobileMenu
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        termsCount={terms.length}
        historyCount={history.length}
        isSettingsRequired={!isConfigured}
        onOpenTerms={() => setIsTermsOpen(true)}
        onOpenHistory={() => setIsHistoryOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />
    </div>
  );
};
