/**
 * selectFile 是导入后自动选中的 shipped 入口
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { selectFile } from '../filesService';
import { useFilesStore } from '@/stores/filesStore';

describe('selectFile (import auto-select entry)', () => {
  beforeEach(() => {
    useFilesStore.setState({ tasks: [], selectedFileId: null });
  });

  it('updates selectedFileId in filesStore', () => {
    selectFile('file-abc');
    expect(useFilesStore.getState().selectedFileId).toBe('file-abc');
    selectFile(null);
    expect(useFilesStore.getState().selectedFileId).toBeNull();
  });
});
