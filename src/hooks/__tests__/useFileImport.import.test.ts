/**
 * 驱动 shipped useFileImport 的纯函数 + import 路径约定
 * （auto-select / 进度文案由 uxHelpers + useFileImport 实现）
 */
import { describe, it, expect } from 'vitest';
import { isSupportedImportFile, importModKeyLabel } from '../useFileImport';
import {
  formatImportProgress,
  formatImportSummary,
  unsupportedImportMessage,
} from '@/utils/uxHelpers';

describe('useFileImport support surface', () => {
  it('accepts srt and media by extension', () => {
    expect(isSupportedImportFile(new File([''], 'a.srt'))).toBe(true);
    expect(isSupportedImportFile(new File([''], 'a.mp3'))).toBe(true);
    expect(isSupportedImportFile(new File([''], 'a.mp4'))).toBe(true);
    expect(isSupportedImportFile(new File([''], 'a.docx'))).toBe(false);
  });

  it('importModKeyLabel returns a non-empty modifier label', () => {
    const label = importModKeyLabel();
    expect(label === 'Ctrl' || label === '⌘').toBe(true);
  });

  it('multi-file progress helpers used by importFiles', () => {
    expect(formatImportProgress(1, 2)).toContain('1/2');
    expect(formatImportSummary(2, 0)).toContain('2');
    expect(unsupportedImportMessage()).toContain('srt');
  });
});
