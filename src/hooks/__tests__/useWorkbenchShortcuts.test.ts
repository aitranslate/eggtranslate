// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { hasEscPriorityOverlay, useWorkbenchShortcuts } from '../useWorkbenchShortcuts';

const closeSettings = vi.fn();
const openEditor = vi.fn();
const setSelectedFileId = vi.fn();
const onOpenFiles = vi.fn();

const workspace = {
  closeSettings,
  openEditor,
  openTerms: vi.fn(),
  openHistory: vi.fn(),
  settingsOpen: false,
  stage: 'editor' as 'editor' | 'terms' | 'history',
};

const files = {
  selectedFileId: 'task-1' as string | null,
  setSelectedFileId,
};

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: (sel: (s: typeof workspace) => unknown) => sel(workspace),
}));

vi.mock('@/stores/filesStore', () => ({
  useFilesStore: (sel: (s: typeof files) => unknown) => sel(files),
}));

function pressEsc() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

describe('hasEscPriorityOverlay', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('detects alertdialog', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'alertdialog');
    document.body.appendChild(el);
    expect(hasEscPriorityOverlay()).toBe(true);
  });

  it('detects open menu', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'menu');
    document.body.appendChild(el);
    expect(hasEscPriorityOverlay()).toBe(true);
  });

  it('is false when no overlay', () => {
    expect(hasEscPriorityOverlay()).toBe(false);
  });
});

describe('useWorkbenchShortcuts Esc cascade', () => {
  beforeEach(() => {
    cleanup();
    closeSettings.mockClear();
    openEditor.mockClear();
    setSelectedFileId.mockClear();
    onOpenFiles.mockClear();
    workspace.settingsOpen = false;
    workspace.stage = 'editor';
    files.selectedFileId = 'task-1';
    document.body.innerHTML = '';
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('clears selection when editor has a selected task', () => {
    const { unmount } = renderHook(() => useWorkbenchShortcuts({ onOpenFiles }));
    pressEsc();
    expect(setSelectedFileId).toHaveBeenCalledWith(null);
    expect(closeSettings).not.toHaveBeenCalled();
    unmount();
  });

  it('does not clear selection when alertdialog is open', () => {
    const el = document.createElement('div');
    el.setAttribute('role', 'alertdialog');
    document.body.appendChild(el);

    const { unmount } = renderHook(() => useWorkbenchShortcuts({ onOpenFiles }));
    pressEsc();
    expect(setSelectedFileId).not.toHaveBeenCalled();
    unmount();
  });

  it('closes settings before clearing selection', () => {
    workspace.settingsOpen = true;
    const { unmount } = renderHook(() => useWorkbenchShortcuts({ onOpenFiles }));
    pressEsc();
    expect(closeSettings).toHaveBeenCalled();
    expect(setSelectedFileId).not.toHaveBeenCalled();
    unmount();
  });

  it('imports on Ctrl+O', () => {
    const { unmount } = renderHook(() => useWorkbenchShortcuts({ onOpenFiles }));
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'o', ctrlKey: true, bubbles: true })
    );
    expect(onOpenFiles).toHaveBeenCalled();
    unmount();
  });
});
