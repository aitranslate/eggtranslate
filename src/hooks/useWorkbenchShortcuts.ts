/**
 * 工作台快捷键：
 * - Ctrl/Cmd+O：导入文件（唯一业务快捷键）
 * - Esc：关设置 / 回工作区 / 取消选中（有弹层时让位给弹层）
 */

import { useEffect } from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useFilesStore } from '@/stores/filesStore';

/** 其它组件已自行处理 Esc 的浮层（确认框 / 导出菜单等） */
export function hasEscPriorityOverlay(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.querySelector('[role="alertdialog"]')) return true;
  if (document.querySelector('[role="menu"]')) return true;
  return false;
}

export function useWorkbenchShortcuts(options: {
  onOpenFiles: () => void;
  enabled?: boolean;
}) {
  const { onOpenFiles, enabled = true } = options;
  const closeSettings = useWorkspaceStore((s) => s.closeSettings);
  const settingsOpen = useWorkspaceStore((s) => s.settingsOpen);
  const openEditor = useWorkspaceStore((s) => s.openEditor);
  const stage = useWorkspaceStore((s) => s.stage);
  const selectedFileId = useFilesStore((s) => s.selectedFileId);
  const setSelectedFileId = useFilesStore((s) => s.setSelectedFileId);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const inField =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target?.isContentEditable;

      // Esc：弹层优先 → 关设置 → 回工作区 → 取消任务选中
      if (e.key === 'Escape' && !inField) {
        if (hasEscPriorityOverlay()) {
          // ConfirmDialog / ExportMenu 自行处理
          return;
        }
        if (settingsOpen) {
          e.preventDefault();
          closeSettings();
          return;
        }
        if (stage !== 'editor') {
          e.preventDefault();
          openEditor();
          return;
        }
        if (selectedFileId) {
          e.preventDefault();
          setSelectedFileId(null);
        }
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key.toLowerCase() === 'o' && !e.shiftKey && !e.altKey) {
        // 输入框内不抢浏览器「打开」心智；非输入区才导入
        if (inField) return;
        e.preventDefault();
        onOpenFiles();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    enabled,
    onOpenFiles,
    closeSettings,
    settingsOpen,
    openEditor,
    stage,
    selectedFileId,
    setSelectedFileId,
  ]);
}
