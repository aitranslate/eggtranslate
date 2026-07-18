import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Settings,
  BookOpen,
  History,
  Moon,
  Sun,
  Volume2,
  VolumeX,
  LayoutList,
} from 'lucide-react';
import { SubtitleFileList } from './SubtitleFileList';
import { SubtitleEditor } from './SubtitleEditor';
import {
  LazyHistoryModal,
  LazyMobileShell,
  LazySettingsModal,
  LazySurface,
  LazyTermsManager,
  SurfaceFallback,
} from './lazySurfaces';
import { prefetchMobileShell } from './lazyPrefetch';
import { StatusBar } from './StatusBar';
import { EmptyWorkspaceHero } from '@/components/EmptyWorkspaceHero';
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
import { useActiveJobBeforeUnload } from '@/hooks/useActiveJobGuard';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { importSampleSubtitle } from '@/utils/importSampleSubtitle';
import { SubtitleFileMetadata } from '@/types';

const stageMotion = {
  initial: { opacity: 0, y: 5 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.15, ease: [0.4, 0, 0.2, 1] as const },
};

export const MainApp: React.FC = () => {
  /** 首次打开后保持设置组件挂载，避免关抽屉丢掉未保存草稿 */
  const [settingsMounted, setSettingsMounted] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);

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
  const { handleError } = useErrorHandler();

  // 一判为移动端立刻预取壳 chunk，Suspense 几乎不展示「加载中」
  useEffect(() => {
    if (!isMobile) return;
    void prefetchMobileShell();
  }, [isMobile]);

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

  // 任务进行中拦截刷新/关页
  useActiveJobBeforeUnload(true);

  // 默认进入工作区（不自动弹设置；未配置时顶栏仍有「必须」提示）
  useEffect(() => {
    openEditor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (settingsOpen) setSettingsMounted(true);
  }, [settingsOpen]);

  const handleSample = useCallback(async () => {
    setSampleLoading(true);
    try {
      const id = await importSampleSubtitle();
      if (id) {
        setSelectedFileId(id);
        openEditor();
        toast.success('已导入示例字幕');
      }
    } catch (err) {
      handleError(err, { context: { operation: '导入示例' } });
    } finally {
      setSampleLoading(false);
    }
  }, [handleError, setSelectedFileId, openEditor]);

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
    return (
      <>
        {/* beforeunload 已在上方 hook 注册（mobile 与 desktop 共用 MainApp 挂载） */}
        {/* 桌面冷启动不拉 MobileShell 依赖图 */}
        <LazySurface fallback={<SurfaceFallback label="加载中…" />}>
          <LazyMobileShell openFilePicker={openFilePicker} fileInput={fileInput} />
        </LazySurface>
      </>
    );
  }

  /**
   * 布局契约：`.workbench` 只放网格槽位（顶栏 / 侧栏 / 主舞台 / 状态栏）。
   * 设置、菜单、引导等浮层必须是 workbench 的**兄弟节点**，不能当 grid 子项——
   * 否则 Suspense 占位或未 portal 的节点会生成隐式第 4 行，把状态栏顶上去。
   */
  return (
    <>
    <div
      className={`workbench apple-style${isDragging ? ' is-file-drag' : ''}`}
      data-theme={theme}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {fileInput}

      <header className="wb-topbar">
        <div className="wb-brand">
          <img
            className="wb-brand-logo"
            src="/favicon.svg"
            alt=""
            width={20}
            height={20}
            draggable={false}
          />
          <span className="wb-brand-title">蛋蛋字幕翻译</span>
          <span className="wb-brand-ver">v2.0</span>
        </div>

        {/* 主导航：标题栏正中分段控件（工作区 / 术语 / 历史） */}
        <nav className="wb-top-nav hidden md:flex" aria-label="主导航">
          <div className="wb-seg wb-seg-nav">
            <button
              type="button"
              className={showEditor && !settingsOpen ? 'is-active' : ''}
              onClick={() => handleNav('editor')}
              title="工作区"
            >
              <LayoutList className="h-3.5 w-3.5" />
              工作区
            </button>

            <button
              type="button"
              className={stage === 'terms' ? 'is-active' : ''}
              onClick={() => handleNav('terms')}
              title="术语"
            >
              <BookOpen className="h-3.5 w-3.5" />
              术语
              {termsCount > 0 && <span className="wb-nav-badge">{termsCount}</span>}
            </button>

            <button
              type="button"
              className={stage === 'history' ? 'is-active' : ''}
              onClick={() => handleNav('history')}
              title="历史"
            >
              <History className="h-3.5 w-3.5" />
              历史
              {historyCount > 0 && (
                <span className="wb-nav-badge">{historyCount}</span>
              )}
            </button>
          </div>
        </nav>

        <div className="wb-top-actions">
          <div className="hidden md:flex items-center gap-0.5">
            <button
              type="button"
              className="wb-nav-btn wb-nav-btn-icon"
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
              className="wb-nav-btn wb-nav-btn-icon"
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

            <span className="wb-top-sep" aria-hidden />

            <button
              type="button"
              className={`wb-nav-btn ${settingsOpen ? 'active' : ''} ${!isConfigured ? 'warn' : ''}`}
              onClick={() => openSettings()}
              title="设置"
            >
              <span className="wb-nav-dot" aria-hidden />
              <Settings className="h-3.5 w-3.5" />
              <span className="wb-nav-label">设置</span>
              {!isConfigured && <span className="wb-nav-badge">必须</span>}
            </button>
          </div>
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
              <LazySurface>
                <LazyTermsManager variant="panel" />
              </LazySurface>
            </motion.div>
          )}

          {stage === 'history' && (
            <motion.div key="history" className="wb-stage-inner" {...stageMotion}>
              <LazySurface>
                <LazyHistoryModal variant="panel" />
              </LazySurface>
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
              <EmptyWorkspaceHero
                isDragging={isDragging}
                fileCount={fileCount}
                isConfigured={isConfigured}
                sampleLoading={sampleLoading}
                importShortcut={importShortcut}
                onImport={openFilePicker}
                onSample={() => void handleSample()}
                onConfigure={() => openSettings('translation')}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <StatusBar />
    </div>

    {/* 浮层：在布局壳外，不参与 workbench grid */}
    {settingsMounted && (
      <LazySurface fallback={null}>
        <LazySettingsModal isOpen={settingsOpen} />
      </LazySurface>
    )}
    </>
  );
};
