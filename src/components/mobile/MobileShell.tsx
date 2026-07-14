/**
 * 移动端专用壳：列表 ↔ 详情，设置全屏抽屉
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  History,
  Menu,
  Moon,
  Plus,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { SubtitleEditor } from '@/components/SubtitleEditor';
import { SettingsModal } from '@/components/SettingsModal';
import { TermsManager } from '@/components/TermsManager';
import { HistoryModal } from '@/components/HistoryModal';
import { MobileMenu } from '@/components/MobileMenu';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { MobileTaskCard } from '@/components/mobile/MobileTaskCard';
import { MobileDetailBar } from '@/components/mobile/MobileDetailBar';
import { useFiles, useSelectedFile, useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { useIsTranslationConfigured } from '@/stores/translationConfigStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useTermsStore } from '@/stores/termsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useThemeStore } from '@/stores/themeStore';
import { clearAll } from '@/services/filesService';
import { enqueueAllUncompleted } from '@/services/queueService';
import { importSampleSubtitle } from '@/utils/importSampleSubtitle';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import type { SubtitleFileMetadata } from '@/types';

export interface MobileShellProps {
  openFilePicker: () => void;
  fileInput: React.ReactNode;
}

export const MobileShell: React.FC<MobileShellProps> = ({ openFilePicker, fileInput }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const files = useFiles();
  const selectedFileId = useFilesStore((s) => s.selectedFileId);
  const setSelectedFileId = useFilesStore((s) => s.setSelectedFileId);
  const selectedFile = useSelectedFile();
  const isConfigured = useIsTranslationConfigured();
  const historyCount = useHistoryStore((s) => s.history.length);
  const termsCount = useTermsStore((s) => s.terms.length);
  const taskQueue = useQueueStore((s) => s.taskQueue);
  const activeTaskId = useQueueStore((s) => s.activeTaskId);

  const stage = useWorkspaceStore((s) => s.stage);
  const settingsOpen = useWorkspaceStore((s) => s.settingsOpen);
  const openEditor = useWorkspaceStore((s) => s.openEditor);
  const openSettings = useWorkspaceStore((s) => s.openSettings);
  const openTerms = useWorkspaceStore((s) => s.openTerms);
  const openHistory = useWorkspaceStore((s) => s.openHistory);

  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const { handleError } = useErrorHandler();

  const queueMeta = useMemo(() => {
    const map = new Map<string, number>();
    taskQueue.forEach((id, i) => map.set(id, i + 1));
    return map;
  }, [taskQueue]);

  const inDetail = stage === 'editor' && !!selectedFileId;
  const inList = stage === 'editor' && !selectedFileId;

  const handleOpenTask = useCallback(
    (file: SubtitleFileMetadata) => {
      setSelectedFileId(file.id);
      openEditor();
    },
    [setSelectedFileId, openEditor]
  );

  const handleBack = useCallback(() => {
    setSelectedFileId(null);
    openEditor();
  }, [setSelectedFileId, openEditor]);

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

  const handleClearAll = useCallback(async () => {
    try {
      await clearAll();
      toast.success('已清空');
    } catch (err) {
      handleError(err, { context: { operation: '清空' } });
    } finally {
      setShowClearConfirm(false);
    }
  }, [handleError]);

  const title = useMemo(() => {
    if (stage === 'terms') return '术语';
    if (stage === 'history') return '历史';
    if (inDetail) return selectedFile?.name || '任务';
    return '项目';
  }, [stage, inDetail, selectedFile?.name]);

  return (
    <div className="m-shell apple-style" data-theme={theme}>
      {fileInput}

      <header className="m-top">
        <div className="m-top-left">
          {inDetail || stage !== 'editor' ? (
            <button
              type="button"
              className="m-icon-btn"
              onClick={() => {
                if (stage !== 'editor') openEditor();
                else handleBack();
              }}
              aria-label="返回"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : (
            <img
              src="/favicon.svg"
              alt=""
              width={28}
              height={28}
              className="m-logo"
              draggable={false}
            />
          )}
          <div className="m-top-titles">
            <h1 className="m-top-title">{title}</h1>
            {inList && files.length > 0 && (
              <span className="m-top-sub">{files.length} 个任务</span>
            )}
          </div>
        </div>
        <div className="m-top-right">
          {!inDetail && (
            <button
              type="button"
              className="m-icon-btn"
              onClick={openFilePicker}
              aria-label="导入文件"
            >
              <Plus className="h-5 w-5" strokeWidth={2.25} />
            </button>
          )}
          <button
            type="button"
            className="m-icon-btn"
            onClick={toggleTheme}
            aria-label="切换主题"
          >
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
          <button
            type="button"
            className={`m-icon-btn ${!isConfigured ? 'warn' : ''}`}
            onClick={openSettings}
            aria-label="设置"
          >
            <Settings className="h-5 w-5" />
            {!isConfigured && <span className="m-dot-warn" />}
          </button>
          <button
            type="button"
            className="m-icon-btn"
            onClick={() => setMenuOpen(true)}
            aria-label="菜单"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {!isConfigured && inList && (
        <button type="button" className="m-banner" onClick={openSettings}>
          <span>未配置翻译 API，点此设置</span>
          <Settings className="h-3.5 w-3.5 opacity-70" />
        </button>
      )}

      <main className="m-main">
        {stage === 'terms' && (
          <div className="m-panel">
            <TermsManager variant="panel" />
          </div>
        )}

        {stage === 'history' && (
          <div className="m-panel">
            <HistoryModal variant="panel" />
          </div>
        )}

        {inList && (
          <div className="m-list">
            <div className="m-hero">
              <button type="button" className="m-hero-primary" onClick={openFilePicker}>
                <Upload className="h-5 w-5" />
                导入文件
              </button>
              <button
                type="button"
                className="m-hero-secondary"
                onClick={() => void handleSample()}
                disabled={sampleLoading}
              >
                <Sparkles className="h-4 w-4" />
                {sampleLoading ? '导入中…' : '试用示例字幕'}
              </button>
              <p className="m-hero-hint">支持 SRT / 音视频，点选即可（无需拖拽）</p>
            </div>

            {files.length > 0 && (
              <div className="m-list-tools">
                <button
                  type="button"
                  className="m-chip-btn primary"
                  onClick={() => enqueueAllUncompleted()}
                >
                  全部开始
                </button>
                <button
                  type="button"
                  className="m-chip-btn"
                  onClick={() => setShowClearConfirm(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  清空
                </button>
              </div>
            )}

            <div className="m-task-list">
              {files.length === 0 ? (
                <div className="m-empty-list">暂无项目，导入后显示在这里</div>
              ) : (
                files.map((file) => {
                  const queuePosition = queueMeta.get(file.id) ?? 0;
                  const isActive = activeTaskId === file.id;
                  const isQueued = queuePosition > 0 && !isActive;
                  return (
                    <MobileTaskCard
                      key={file.id}
                      file={file}
                      isQueued={isQueued}
                      queuePosition={queuePosition}
                      isActive={isActive}
                      onOpen={handleOpenTask}
                    />
                  );
                })
              )}
            </div>
          </div>
        )}

        {inDetail && selectedFileId && (
          <div className="m-detail">
            <div className="m-detail-editor">
              <SubtitleEditor variant="panel" fileId={selectedFileId} />
            </div>
            {selectedFile && <MobileDetailBar file={selectedFile} />}
          </div>
        )}
      </main>

      {inList && (
        <nav className="m-tabbar" aria-label="主导航">
          <button type="button" className="m-tab is-active" onClick={openEditor}>
            <span>项目</span>
          </button>
          <button type="button" className="m-tab" onClick={openTerms}>
            <BookOpen className="h-4 w-4" />
            <span>术语{termsCount > 0 ? ` ${termsCount}` : ''}</span>
          </button>
          <button type="button" className="m-tab" onClick={openHistory}>
            <History className="h-4 w-4" />
            <span>历史{historyCount > 0 ? ` ${historyCount}` : ''}</span>
          </button>
        </nav>
      )}

      <SettingsModal isOpen={settingsOpen} />

      <MobileMenu
        isOpen={menuOpen}
        onClose={() => setMenuOpen(false)}
        termsCount={termsCount}
        historyCount={historyCount}
        isSettingsRequired={!isConfigured}
        onOpenWorkspace={openEditor}
        onOpenTerms={openTerms}
        onOpenHistory={openHistory}
        onOpenSettings={openSettings}
      />

      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={() => void handleClearAll()}
        title="清空全部项目？"
        message="将删除所有任务与本地字幕数据，不可恢复。"
        confirmText="清空"
        tone="danger"
      />

    </div>
  );
};
