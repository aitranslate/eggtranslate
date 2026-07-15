import React, { useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Settings,
  BookOpen,
  History,
  Menu,
  FileText,
  Upload,
  Moon,
  Sun,
  Volume2,
  VolumeX,
  LayoutList,
} from 'lucide-react';
import { SubtitleFileList } from './SubtitleFileList';
import { SubtitleEditor } from './SubtitleEditor';
import { SettingsModal } from './SettingsModal';
import { TermsManager } from './TermsManager';
import { HistoryModal } from './HistoryModal';
import { StatusBar } from './StatusBar';
import { MobileMenu } from './MobileMenu';
import { useFileCount, useFilesStore } from '@/stores/filesStore';
import { useIsTranslationConfigured } from '@/stores/translationConfigStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useTermsStore } from '@/stores/termsStore';
import { useWorkspaceStore, type StageMode } from '@/stores/workspaceStore';
import { useThemeStore } from '@/stores/themeStore';
import { useSoundStore } from '@/stores/soundStore';
import { playAppSound } from '@/utils/appSound';
import { useWorkbenchShortcuts } from '@/hooks/useWorkbenchShortcuts';
import { useFileImport } from '@/hooks/useFileImport';
import { useIsMobile } from '@/hooks/useIsMobile';
import { MobileShell } from '@/components/mobile/MobileShell';
import { SubtitleFileMetadata } from '@/types';

const stageMotion = {
  initial: { opacity: 0, y: 5 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.15, ease: [0.4, 0, 0.2, 1] as const },
};

export const MainApp: React.FC = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  const fileCount = useFileCount();
  const selectedFileId = useFilesStore((s) => s.selectedFileId);
  const setSelectedFileId = useFilesStore((s) => s.setSelectedFileId);
  const isConfigured = useIsTranslationConfigured();
  const historyCount = useHistoryStore((s) => s.history.length);
  const termsCount = useTermsStore((s) => s.terms.length);

  const stage = useWorkspaceStore((s) => s.stage);
  const settingsOpen = useWorkspaceStore((s) => s.settingsOpen);
  const setStage = useWorkspaceStore((s) => s.setStage);
  const openEditor = useWorkspaceStore((s) => s.openEditor);
  const openSettings = useWorkspaceStore((s) => s.openSettings);
  const openTerms = useWorkspaceStore((s) => s.openTerms);
  const openHistory = useWorkspaceStore((s) => s.openHistory);

  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const soundEnabled = useSoundStore((s) => s.soundEnabled);
  const setSoundEnabled = useSoundStore((s) => s.setSoundEnabled);
  const isMobile = useIsMobile();

  /** 开关音效；打开时播一声确认，方便立刻验证听得到 */
  const handleToggleSound = useCallback(() => {
    const next = !useSoundStore.getState().soundEnabled;
    setSoundEnabled(next);
    if (next) playAppSound('confirm');
  }, [setSoundEnabled]);

  const {
    fileInputRef,
    isDragging,
    openFilePicker,
    onFileInputChange,
    onDragOver,
    onDragLeave,
    onDrop,
    accept,
    modKeyLabel,
  } = useFileImport();

  const importShortcut = `${modKeyLabel}+O`;

  // 默认进入工作区（不自动弹设置；未配置时顶栏仍有「必须」提示）
  useEffect(() => {
    openEditor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectTask = useCallback(
    (file: SubtitleFileMetadata) => {
      setSelectedFileId(file.id);
      openEditor();
    },
    [setSelectedFileId, openEditor]
  );

  /** 取消选中 → 回到可导入的空工作区 */
  const clearTaskSelection = useCallback(() => {
    setSelectedFileId(null);
    openEditor();
  }, [setSelectedFileId, openEditor]);

  /**
   * 点任务列表空白取消选中；点任务行 / 工具条 / 控件不处理
   */
  const handleTasksAreaClick = useCallback(
    (e: React.MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.wb-proj')) return;
      if (t.closest('.wb-tasks-head')) return;
      if (t.closest('.wb-tasks-actions')) return;
      if (t.closest('button, a, input, select, textarea, label')) return;
      if (!selectedFileId) return;
      clearTaskSelection();
    },
    [selectedFileId, clearTaskSelection]
  );

  const handleNav = useCallback(
    (mode: StageMode) => {
      setStage(mode);
    },
    [setStage]
  );

  useWorkbenchShortcuts({ onOpenFiles: openFilePicker, enabled: !isMobile });

  const showEditor = stage === 'editor';
  const showEmptyWorkspace = showEditor && !selectedFileId;

  const fileInput = (
    <input
      id="wb-file-import"
      ref={fileInputRef}
      type="file"
      accept={accept}
      multiple
      className="sr-only"
      tabIndex={-1}
      aria-label="导入字幕或音视频"
      onChange={onFileInputChange}
    />
  );

  if (isMobile) {
    return <MobileShell openFilePicker={openFilePicker} fileInput={fileInput} />;
  }

  return (
    <div className="workbench apple-style" data-theme={theme}>
      {fileInput}

      <header className="wb-topbar">
        <div className="wb-brand">
          <img
            className="wb-brand-logo"
            src="/favicon.svg"
            alt=""
            width={24}
            height={24}
            draggable={false}
          />
          <span className="wb-brand-title">蛋蛋字幕翻译</span>
          <span className="wb-brand-ver">v2.0</span>
        </div>

        <div className="wb-top-actions">
          <div className="hidden md:flex items-center gap-1">
            <button
              type="button"
              className={`wb-nav-btn ${showEditor && !settingsOpen ? 'active' : ''}`}
              onClick={() => handleNav('editor')}
              title="工作区"
            >
              <LayoutList className="h-3.5 w-3.5" />
              <span className="wb-nav-label">工作区</span>
            </button>

            <span className="wb-top-sep" aria-hidden />

            <button
              type="button"
              className={`wb-nav-btn ${stage === 'terms' ? 'active' : ''}`}
              onClick={() => handleNav('terms')}
              title="术语"
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span className="wb-nav-label">术语</span>
              {termsCount > 0 && <span className="wb-nav-badge">{termsCount}</span>}
            </button>

            <button
              type="button"
              className={`wb-nav-btn ${stage === 'history' ? 'active' : ''}`}
              onClick={() => handleNav('history')}
              title="历史"
            >
              <History className="h-3.5 w-3.5" />
              <span className="wb-nav-label">历史</span>
              {historyCount > 0 && (
                <span className="wb-nav-badge">{historyCount}</span>
              )}
            </button>

            {/* 导航与系统偏好分隔：主题/音效 → 设置置最右 */}
            <span className="wb-top-sep" aria-hidden />

            <button
              type="button"
              className="wb-nav-btn"
              onClick={toggleTheme}
              title={theme === 'dark' ? '浅色' : '深色'}
              aria-label="切换主题"
            >
              {theme === 'dark' ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
            </button>

            <button
              type="button"
              className="wb-nav-btn"
              onClick={handleToggleSound}
              title={soundEnabled ? '关闭音效' : '开启音效'}
              aria-label={soundEnabled ? '关闭音效' : '开启音效'}
              aria-pressed={soundEnabled}
            >
              {soundEnabled ? (
                <Volume2 className="h-3.5 w-3.5" />
              ) : (
                <VolumeX className="h-3.5 w-3.5" />
              )}
            </button>

            <button
              type="button"
              className={`wb-nav-btn ${settingsOpen ? 'active' : ''} ${!isConfigured ? 'warn' : ''}`}
              onClick={openSettings}
              title="设置"
            >
              <span className="wb-nav-dot" aria-hidden />
              <Settings className="h-3.5 w-3.5" />
              <span className="wb-nav-label">设置</span>
              {!isConfigured && <span className="wb-nav-badge">必须</span>}
            </button>
          </div>

          <button
            type="button"
            className="md:hidden wb-nav-btn"
            onClick={toggleTheme}
            aria-label="切换主题"
          >
            {theme === 'dark' ? (
              <Sun className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            className="md:hidden wb-nav-btn"
            onClick={handleToggleSound}
            aria-label={soundEnabled ? '关闭音效' : '开启音效'}
            aria-pressed={soundEnabled}
          >
            {soundEnabled ? (
              <Volume2 className="h-3.5 w-3.5" />
            ) : (
              <VolumeX className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(true)}
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-[8px]"
            style={{ background: 'var(--wb-panel-2)', color: 'var(--wb-text-2)' }}
            aria-label="打开菜单"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </header>

      <aside className="wb-sidebar">
        <div className="wb-tasks" onClick={handleTasksAreaClick}>
          {/* 侧栏头+列表由 SubtitleFileList 统一：项目 | [+] [全部开始] [导出] [清空] */}
          <SubtitleFileList
            variant="sidebar"
            selectedFileId={selectedFileId}
            onSelectFile={handleSelectTask}
            onImport={openFilePicker}
            importShortcut={importShortcut}
          />
        </div>
      </aside>

      {/* 主舞台始终是工作区 / 术语 / 历史 — 设置不占用 */}
      <main className="wb-stage">
        <AnimatePresence mode="wait">
          {stage === 'terms' && (
            <motion.div key="terms" className="wb-stage-inner" {...stageMotion}>
              <TermsManager variant="panel" />
            </motion.div>
          )}

          {stage === 'history' && (
            <motion.div key="history" className="wb-stage-inner" {...stageMotion}>
              <HistoryModal variant="panel" />
            </motion.div>
          )}

          {showEditor && selectedFileId && (
            <motion.div
              key={`editor-${selectedFileId}`}
              className="wb-stage-inner"
              {...stageMotion}
            >
              <SubtitleEditor variant="panel" fileId={selectedFileId} />
            </motion.div>
          )}

          {showEmptyWorkspace && (
            <motion.div key="empty" className="wb-stage-inner" {...stageMotion}>
              <div
                className={`wb-stage-empty wb-stage-drop ${isDragging ? 'is-drag' : ''}`}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                <div className="wb-stage-empty-icon">
                  {isDragging ? (
                    <Upload className="h-5 w-5" />
                  ) : (
                    <FileText className="h-5 w-5" />
                  )}
                </div>
                <h3>
                  {isDragging
                    ? '松开以导入'
                    : fileCount > 0
                      ? '选择一个项目'
                      : '导入文件开始'}
                </h3>
                <p>
                  {fileCount > 0
                    ? '从左侧打开任务，或导入新文件'
                    : '支持 SRT / 音视频，可拖入此处'}
                </p>
                <div className="wb-stage-empty-actions">
                  <button
                    type="button"
                    className="wb-stage-cta"
                    onClick={openFilePicker}
                    title={`${importShortcut} 导入`}
                  >
                    导入文件
                    <span className="wb-stage-cta-keys" aria-hidden>
                      {importShortcut}
                    </span>
                  </button>
                  {!isConfigured && (
                    <button type="button" className="wb-stage-cta secondary" onClick={openSettings}>
                      配置 API
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <StatusBar />

      {/* 右侧设置抽屉：浮在工作区之上 */}
      <SettingsModal isOpen={settingsOpen} />

      <MobileMenu
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        termsCount={termsCount}
        historyCount={historyCount}
        isSettingsRequired={!isConfigured}
        onOpenWorkspace={openEditor}
        onOpenTerms={openTerms}
        onOpenHistory={openHistory}
        onOpenSettings={openSettings}
      />
    </div>
  );
};
