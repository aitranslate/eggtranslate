import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Settings,
  BookOpen,
  History
} from 'lucide-react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { FileUpload } from './FileUpload';
import { BatchFileUpload } from './BatchFileUpload';
import { SubtitleFileList } from './SubtitleFileList';
import { TranslationControls } from './TranslationControls';
import { SubtitleEditor } from './SubtitleEditor';
import { SettingsModal } from './SettingsModal';
import { TermsManager } from './TermsManager';
import { HistoryModal } from './HistoryModal';
import { HelpButton } from './HelpButton';
import { GuideModal } from './GuideModal';
import { useFiles } from '@/stores/subtitleStore';
import { useIsTranslationConfigured } from '@/stores/translationConfigStore';
import { useHistoryStore } from '@/stores/historyStore';
import { SubtitleFileMetadata } from '@/types';
import { useTermsStore } from '@/stores/termsStore';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { FadeIn } from './motion/FadeIn';

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
  const history = useHistoryStore((state) => state.history);
  const terms = useTermsStore((state) => state.terms);

  const { handleError } = useErrorHandler();
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
            <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-500 rounded-full">v1.1</span>
          </div>

          <div className={`flex items-center gap-6 ${isEditingModalOpen ? 'pointer-events-none opacity-50' : ''}`}>
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
        {/* Hero 区域 - 字符级 stagger 入场 + scroll parallax */}
        <ParallaxHero>
          <div className="text-center mb-16 pt-8">
            <SplitHeading
              text="字幕翻译，重新定义"
              className="apple-heading-hero mb-4"
            />
            <FadeIn delay={0.5} y={8}>
              <p className="apple-body-large max-w-2xl mx-auto mb-8">
                支持音视频转录、SRT 翻译、术语管理。本地处理，隐私安全。
              </p>
            </FadeIn>
          </div>
        </ParallaxHero>

        {/* 上传区域 - 突出显示 */}
        <FadeIn delay={0.7} y={24}>
          <div className="mb-16">
            <div className="apple-card-large p-12">
              <BatchFileUpload />
            </div>
          </div>
        </FadeIn>

        {/* 文件列表 */}
        {files.length > 0 && (
          <FadeIn delay={0.9} y={16}>
            <SubtitleFileList
              onEditFile={handleEditFile}
            />
          </FadeIn>
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

/** Hero 滚动视差：背景渐变在滚动时缓慢上移 */
const ParallaxHero: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 400], [0, -40]);
  return (
    <motion.div ref={ref} style={{ y }}>
      {children}
    </motion.div>
  );
};

/** 字符级 stagger：每个字依次浮入 */
const SplitHeading: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  return (
    <h2 className={className}>
      {text.split('').map((char, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 24, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ delay: i * 0.04, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="inline-block"
          style={{ whiteSpace: char === ' ' ? 'pre' : 'normal' }}
        >
          {char}
        </motion.span>
      ))}
    </h2>
  );
};
