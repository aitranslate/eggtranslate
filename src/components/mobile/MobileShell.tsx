/**
 * 移动端专用壳：列表 ↔ 详情，设置全屏抽屉
 *
 * 信息架构：
 * - 顶栏只负责导航 / 设置；主题与音效在设置「外观」
 * - 空列表是一块空态；有任务后只留紧凑工具条
 * - 详情底栏常驻主操作（见 MobileDetailBar）
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  FolderKanban,
  History,
  Settings,
  Trash2,
  Upload,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { SubtitleEditor } from '@/components/SubtitleEditor';
import {
  LazyHistoryModal,
  LazySettingsModal,
  LazySurface,
  LazyTermsManager,
} from '@/components/lazySurfaces';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { MobileTaskCard } from '@/components/mobile/MobileTaskCard';
import { MobileDetailBar } from '@/components/mobile/MobileDetailBar';
import { MobileListEmpty } from '@/components/mobile/MobileListEmpty';
import { useFiles, useSelectedFile, useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { useIsTranslationConfigured } from '@/stores/translationConfigStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useTermsStore } from '@/stores/termsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useThemeStore } from '@/stores/themeStore';
import { clearAll } from '@/services/filesService';
import { startAllUncompleted } from '@/services/startTask';
import { importSampleSubtitle } from '@/utils/importSampleSubtitle';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import type { SubtitleFileMetadata } from '@/types';

export interface MobileShellProps {
  openFilePicker: () => void;
  fileInput: React.ReactNode;
}

export const MobileShell: React.FC<MobileShellProps> = ({ openFilePicker, fileInput }) => {
  const [sampleLoading, setSampleLoading] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [settingsMounted, setSettingsMounted] = useState(false);

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
  const { handleError } = useErrorHandler();

  const [logoShake, setLogoShake] = useState(false);
  const shakeBrandLogo = useCallback(() => {
    setLogoShake(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setLogoShake(true));
    });
  }, []);

  useEffect(() => {
    if (settingsOpen) setSettingsMounted(true);
  }, [settingsOpen]);

  const queueMeta = useMemo(() => {
    const map = new Map<string, number>();
    taskQueue.forEach((id, i) => map.set(id, i + 1));
    return map;
  }, [taskQueue]);

  const inDetail = stage === 'editor' && !!selectedFileId;
  const inList = stage === 'editor' && !selectedFileId;
  const hasTasks = files.length > 0;

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
    return '蛋蛋字幕翻译';
  }, [stage, inDetail, selectedFile?.name]);

  const titleSub = useMemo(() => {
    if (!inList) return null;
    const ver = `v${__APP_VERSION__}`;
    if (hasTasks) return `${ver} · ${files.length} 个任务`;
    return ver;
  }, [inList, hasTasks, files.length]);

  /**
   * 布局契约：`.m-shell` 只放壳层槽位（顶栏 / 主区 / 底栏）。
   * 设置抽屉等浮层放在壳外，避免 Suspense 占位挤进 flex 列把底栏顶歪。
   */
  return (
    <>
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
            <button
              type="button"
              className={`m-logo-btn${logoShake ? ' is-shake' : ''}`}
              title={`蛋蛋字幕翻译 v${__APP_VERSION__}`}
              aria-label={`蛋蛋字幕翻译 v${__APP_VERSION__}`}
              onClick={shakeBrandLogo}
              onAnimationEnd={() => setLogoShake(false)}
            >
              <img
                src="/favicon.svg"
                alt=""
                width={28}
                height={28}
                className="m-logo"
                draggable={false}
              />
            </button>
          )}
          <div className="m-top-titles">
            <h1 className="m-top-title">{title}</h1>
            {titleSub ? <span className="m-top-sub">{titleSub}</span> : null}
          </div>
        </div>
        <div className="m-top-right">
          <button
            type="button"
            className={`m-icon-btn ${!isConfigured ? 'warn' : ''}`}
            onClick={() => openSettings()}
            aria-label="设置"
          >
            <Settings className="h-5 w-5" />
            {!isConfigured && <span className="m-dot-warn" />}
          </button>
        </div>
      </header>

      {!isConfigured && inList && hasTasks && (
        <button type="button" className="m-banner" onClick={() => openSettings('translation')}>
          <span>未配置翻译 API，点此设置</span>
          <Settings className="h-3.5 w-3.5 opacity-70" />
        </button>
      )}

      <main className="m-main">
        {stage === 'terms' && (
          <div className="m-panel">
            <LazySurface>
              <LazyTermsManager variant="panel" />
            </LazySurface>
          </div>
        )}

        {stage === 'history' && (
          <div className="m-panel">
            <LazySurface>
              <LazyHistoryModal variant="panel" />
            </LazySurface>
          </div>
        )}

        {inList && (
          <div className="m-list">
            {!hasTasks ? (
              <MobileListEmpty
                isConfigured={isConfigured}
                sampleLoading={sampleLoading}
                onConfigure={() => openSettings('translation')}
                onImport={openFilePicker}
                onSample={() => void handleSample()}
              />
            ) : (
              <>
                <div className="m-list-tools">
                  <button type="button" className="m-chip-btn primary" onClick={openFilePicker}>
                    <Upload className="h-3.5 w-3.5" />
                    导入
                  </button>
                  <button
                    type="button"
                    className="m-chip-btn"
                    onClick={() => startAllUncompleted()}
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

                <div className="m-task-list">
                  {files.map((file) => {
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
                  })}
                </div>
              </>
            )}
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

      {/* 主路径用底栏；术语/历史时也显示便于切换 */}
      {(inList || stage === 'terms' || stage === 'history') && !settingsOpen && (
        <nav className="m-tabbar" aria-label="主导航">
          <button
            type="button"
            className={`m-tab ${stage === 'editor' ? 'is-active' : ''}`}
            onClick={openEditor}
          >
            <FolderKanban className="h-4 w-4" />
            <span>项目</span>
          </button>
          <button
            type="button"
            className={`m-tab ${stage === 'terms' ? 'is-active' : ''}`}
            onClick={openTerms}
          >
            <BookOpen className="h-4 w-4" />
            <span>术语{termsCount > 0 ? ` ${termsCount}` : ''}</span>
          </button>
          <button
            type="button"
            className={`m-tab ${stage === 'history' ? 'is-active' : ''}`}
            onClick={openHistory}
          >
            <History className="h-4 w-4" />
            <span>历史{historyCount > 0 ? ` ${historyCount}` : ''}</span>
          </button>
        </nav>
      )}

    </div>

    {/* 浮层：在 m-shell 外，不参与壳层 flex 布局 */}
    {settingsMounted && (
      <LazySurface fallback={null}>
        <LazySettingsModal isOpen={settingsOpen} />
      </LazySurface>
    )}

    <ConfirmDialog
      isOpen={showClearConfirm}
      onClose={() => setShowClearConfirm(false)}
      onConfirm={() => void handleClearAll()}
      title="清空全部项目？"
      message="将删除所有任务与本地字幕数据，不可恢复。"
      confirmText="清空"
      tone="danger"
    />

    </>
  );
};
