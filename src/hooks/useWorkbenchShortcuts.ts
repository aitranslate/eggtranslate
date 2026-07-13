/**
 * 工作台快捷键：Ctrl/Cmd+O 上传、Ctrl/Cmd+, 设置、Esc 关闭抽屉/回工作区
 */

import { useEffect } from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';

export function useWorkbenchShortcuts(options: {
  onOpenFiles: () => void;
  enabled?: boolean;
}) {
  const { onOpenFiles, enabled = true } = options;
  const openSettings = useWorkspaceStore((s) => s.openSettings);
  const closeSettings = useWorkspaceStore((s) => s.closeSettings);
  const settingsOpen = useWorkspaceStore((s) => s.settingsOpen);
  const openEditor = useWorkspaceStore((s) => s.openEditor);
  const openTerms = useWorkspaceStore((s) => s.openTerms);
  const openHistory = useWorkspaceStore((s) => s.openHistory);
  const stage = useWorkspaceStore((s) => s.stage);

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

      const mod = e.metaKey || e.ctrlKey;

      // Esc：优先关设置抽屉，再回工作区
      if (e.key === 'Escape' && !inField) {
        if (settingsOpen) {
          e.preventDefault();
          closeSettings();
          return;
        }
        if (stage !== 'editor') {
          e.preventDefault();
          openEditor();
        }
        return;
      }

      if (!mod) return;

      if (e.key.toLowerCase() === 'o' && !e.shiftKey) {
        e.preventDefault();
        onOpenFiles();
        return;
      }

      if (e.key === ',') {
        e.preventDefault();
        openSettings();
        return;
      }

      if (e.key.toLowerCase() === 't' && e.shiftKey) {
        e.preventDefault();
        openTerms();
        return;
      }

      if (e.key.toLowerCase() === 'h' && e.shiftKey) {
        e.preventDefault();
        openHistory();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    enabled,
    onOpenFiles,
    openSettings,
    closeSettings,
    settingsOpen,
    openEditor,
    openTerms,
    openHistory,
    stage,
  ]);
}
