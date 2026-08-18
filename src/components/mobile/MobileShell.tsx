/**
 * 移动端壳：列表是驾驶舱，编辑器是检修间。
 *
 * - 顶栏：项目 / 术语 / 历史
 * - 点卡片 = 选中（底坞跟这条）；点箭头 = 打开字幕
 * - 底坞只在项目列表，随选中任务发令
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
import { ExportButton } from '@/components/common/ExportButton';
import { MobileTaskCard } from '@/components/mobile/MobileTaskCard';
import { MobileTaskDock } from '@/components/mobile/MobileTaskDock';
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
import { exportFile } from '@/services/SubtitleExporter';
import { importSampleSubtitle } from '@/utils/importSampleSubtitle';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import type { ExportFormat } from '@/utils/fileExport';
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
  const mobileEditorOpen = useWorkspaceStore((s) => s.mobileEditorOpen);
  const openEditor = useWorkspaceStore((s) => s.openEditor);
  const openMobileEditor = useWorkspaceStore((s) => s.openMobileEditor);
  const closeMobileEditor = useWorkspaceStore((s) => s.closeMobileEditor);
  const openSettings = useWorkspaceStore((s) => s.openSettings);
  const openTerms = useWorkspaceStore((s) => s.openTerms);
  const openHistory = useWorkspaceStore((s) => s.openHistory);

  const theme = useThemeStore((s) => s.theme);
  const { handleError } = useErrorHandler();

  useEffect(() => {
    if (settingsOpen) setSettingsMounted(true);
  }, [settingsOpen]);

  const queueMeta = useMemo(() => {
    const map = new Map<string, number>();
    taskQueue.forEach((id, i) => map.set(id, i + 1));
    return map;
  }, [taskQueue]);

  const inDetail = stage === 'editor' && mobileEditorOpen && !!selectedFileId;
  const inList = stage === 'editor' && !inDetail;
  const hasTasks = files.length > 0;

  useEffect(() => {
    if (mobileEditorOpen && !selectedFileId) closeMobileEditor();
  }, [mobileEditorOpen, selectedFileId, closeMobileEditor]);

  useEffect(() => {
    if (!inList || !hasTasks) return;
    if (selectedFileId && files.some((f) => f.id === selectedFileId)) return;
    setSelectedFileId(files[0].id);
  }, [inList, hasTasks, selectedFileId, files, setSelectedFileId]);

  const handleSelectTask = useCallback(
    (file: SubtitleFileMetadata) => {
      setSelectedFileId(file.id);
    },
    [setSelectedFileId]
  );

  const handleOpenTask = useCallback(
    (file: SubtitleFileMetadata) => {
      setSelectedFileId(file.id);
      openMobileEditor();
    },
    [setSelectedFileId, openMobileEditor]
  );

  const handleBack = useCallback(() => {
    closeMobileEditor();
  }, [closeMobileEditor]);

  const handleSample = useCallback(async () => {
    setSampleLoading(true);
    try {
      const id = await importSampleSubtitle();
      if (id) {
        setSelectedFileId(id);
        openMobileEditor();
        toast.success('已导入示例字幕');
      }
    } catch (err) {
      handleError(err, { context: { operation: '导入示例' } });
    } finally {
      setSampleLoading(false);
    }
  }, [handleError, setSelectedFileId, openMobileEditor]);

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

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (!selectedFile) return;
      try {
        await exportFile(selectedFile.taskId, selectedFile.name, format);
        toast.success('导出成功');
      } catch (error) {
        handleError(error, { context: { operation: '导出', fileName: selectedFile.name } });
      }
    },
    [selectedFile, handleError]
  );

  const title = useMemo(() => {
    if (stage === 'terms') return '术语';
    if (stage === 'history') return '历史';
    if (inDetail) return selectedFile?.name || '任务';
    return '蛋蛋字幕翻译';
  }, [stage, inDetail, selectedFile?.name]);

  /**
   * 布局契约：`.m-shell` 只放壳层槽位（顶栏 / 主区 / 底坞）。
   * 设置抽屉等浮层放在壳外，避免 Suspense 占位挤进 flex 列把底栏顶歪。
   */
  return (
    <>
    <div className="m-shell apple-style" data-theme={theme}>
      {fileInput}

      <header className="m-top">
        {inDetail ? (
          <>
            <div className="m-top-left">
              <button
                type="button"
                className="m-icon-btn"
                onClick={handleBack}
                aria-label="返回"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <h1 className="m-top-title">{title}</h1>
            </div>
            <div className="m-top-right">
              <div className="m-top-export">
                <ExportButton
                  variant="icon"
                  disabled={(selectedFile?.entryCount ?? 0) === 0}
                  hasTranslation={(selectedFile?.translatedCount ?? 0) > 0}
                  onSelect={(fmt) => void handleExport(fmt)}
                />
              </div>
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
          </>
        ) : (
          <>
            <nav className="m-nav" aria-label="主导航">
              <button
                type="button"
                className={`m-nav-item ${stage === 'editor' ? 'is-active' : ''}`}
                onClick={openEditor}
              >
                <FolderKanban className="h-3.5 w-3.5" />
                项目
              </button>
              <button
                type="button"
                className={`m-nav-item ${stage === 'terms' ? 'is-active' : ''}`}
                onClick={openTerms}
              >
                <BookOpen className="h-3.5 w-3.5" />
                术语{termsCount > 0 ? ` ${termsCount}` : ''}
              </button>
              <button
                type="button"
                className={`m-nav-item ${stage === 'history' ? 'is-active' : ''}`}
                onClick={openHistory}
              >
                <History className="h-3.5 w-3.5" />
                历史{historyCount > 0 ? ` ${historyCount}` : ''}
              </button>
            </nav>
            <h1 className="m-top-title m-top-title-sr">{title}</h1>
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
          </>
        )}
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
                        selected={selectedFileId === file.id}
                        isQueued={isQueued}
                        queuePosition={queuePosition}
                        isActive={isActive}
                        onSelect={handleSelectTask}
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
          </div>
        )}
      </main>

      {inList && hasTasks && !settingsOpen && <MobileTaskDock file={selectedFile ?? null} />}

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
