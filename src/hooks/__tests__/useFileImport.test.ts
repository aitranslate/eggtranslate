// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { isSupportedImportFile, importModKeyLabel, useFileImport } from '../useFileImport';

const selectFileMock = vi.fn();
const openEditorMock = vi.fn();

vi.mock('@/services/filesService', () => ({
  addFile: vi.fn(async (file: File) => `id-${file.name}`),
  selectFile: (...args: unknown[]) => selectFileMock(...args),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: {
    getState: () => ({ openEditor: openEditorMock }),
  },
}));

vi.mock('@/hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn() }),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn((..._a: unknown[]) => 'progress-toast'),
  },
}));

import { addFile } from '@/services/filesService';
import toast from 'react-hot-toast';

describe('isSupportedImportFile', () => {
  it('accepts srt and common media extensions', () => {
    expect(isSupportedImportFile(new File([], 'a.srt'))).toBe(true);
    expect(isSupportedImportFile(new File([], 'a.mp4'))).toBe(true);
    expect(isSupportedImportFile(new File([], 'a.wav'))).toBe(true);
  });

  it('rejects unknown extensions', () => {
    expect(isSupportedImportFile(new File([], 'a.pdf'))).toBe(false);
    expect(isSupportedImportFile(new File([], 'noext'))).toBe(false);
  });
});

describe('importModKeyLabel', () => {
  it('returns Ctrl or ⌘ depending on platform', () => {
    const label = importModKeyLabel();
    expect(label === 'Ctrl' || label === '⌘').toBe(true);
  });
});

describe('useFileImport.importFiles', () => {
  beforeEach(() => {
    vi.mocked(addFile).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.loading).mockClear();
    selectFileMock.mockClear();
    openEditorMock.mockClear();
  });

  it('skips unsupported files and toasts', async () => {
    const { result } = renderHook(() => useFileImport());
    await act(async () => {
      await result.current.importFiles([new File(['x'], 'bad.pdf')]);
    });
    expect(addFile).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(selectFileMock).not.toHaveBeenCalled();
  });

  it('imports supported files sequentially via addFile', async () => {
    const order: string[] = [];
    vi.mocked(addFile).mockImplementation(async (file: File) => {
      order.push(`start:${file.name}`);
      await Promise.resolve();
      order.push(`end:${file.name}`);
      return `id-${file.name}`;
    });

    const { result } = renderHook(() => useFileImport());
    await act(async () => {
      await result.current.importFiles([
        new File(['a'], 'a.srt'),
        new File(['b'], 'b.srt'),
      ]);
    });

    expect(addFile).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['start:a.srt', 'end:a.srt', 'start:b.srt', 'end:b.srt']);
    // 多文件：进度 toast + 选中最后成功项并打开工作区
    expect(toast.loading).toHaveBeenCalled();
    expect(selectFileMock).toHaveBeenCalledWith('id-b.srt');
    expect(openEditorMock).toHaveBeenCalled();
  });
});
