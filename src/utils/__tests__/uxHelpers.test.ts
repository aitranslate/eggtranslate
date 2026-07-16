import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatImportProgress,
  formatImportSummary,
  formatMatchCount,
  getFailedPhaseError,
  hasActivePhase,
  shouldShowTaskErrorDetail,
  isExportFormat,
  readLastExportFormat,
  shouldConfirmDiscardSettings,
  shouldPromptBeforeUnload,
  swapLanguages,
  unsupportedImportMessage,
  writeLastExportFormat,
  LAST_EXPORT_FORMAT_KEY,
} from '../uxHelpers';
import type { FilePhases } from '@/types';

function emptyPhases(overrides?: Partial<FilePhases>): FilePhases {
  return {
    workflow: 'translate',
    converting: { status: 'upcoming', progress: 0, tokens: 0 },
    transcribing: { status: 'upcoming', progress: 0, tokens: 0 },
    translating: { status: 'upcoming', progress: 0, tokens: 0 },
    ...overrides,
  };
}

describe('uxHelpers', () => {
  describe('import messages', () => {
    it('lists supported extensions in unsupported message', () => {
      const msg = unsupportedImportMessage();
      expect(msg).toContain('.srt');
      expect(msg).toContain('.mp4');
      expect(msg).toMatch(/不支持/);
    });

    it('formatImportProgress clamps and formats n/N', () => {
      expect(formatImportProgress(2, 5)).toBe('导入中 2/5…');
      expect(formatImportProgress(0, 3)).toBe('导入中 0/3…');
      expect(formatImportProgress(9, 3)).toBe('导入中 3/3…');
    });

    it('formatImportSummary covers ok/fail combos', () => {
      expect(formatImportSummary(3, 0)).toBe('已导入 3 个文件');
      expect(formatImportSummary(0, 2)).toBe('2 个文件导入失败');
      expect(formatImportSummary(2, 1)).toBe('已导入 2 个，失败 1 个');
    });
  });

  describe('settings / leave guards', () => {
    it('shouldConfirmDiscardSettings only when dirty', () => {
      expect(shouldConfirmDiscardSettings(true)).toBe(true);
      expect(shouldConfirmDiscardSettings(false)).toBe(false);
    });

    it('shouldPromptBeforeUnload only when active job', () => {
      expect(shouldPromptBeforeUnload(true)).toBe(true);
      expect(shouldPromptBeforeUnload(false)).toBe(false);
    });
  });

  describe('phases', () => {
    it('hasActivePhase detects any active stage', () => {
      expect(hasActivePhase(emptyPhases())).toBe(false);
      expect(
        hasActivePhase(
          emptyPhases({
            translating: { status: 'active', progress: 10, tokens: 0 },
          })
        )
      ).toBe(true);
      expect(
        hasActivePhase(
          emptyPhases({
            transcribing: { status: 'active', progress: 50, tokens: 0 },
          })
        )
      ).toBe(true);
    });

    it('getFailedPhaseError prefers translating then transcribing', () => {
      expect(getFailedPhaseError(emptyPhases())).toBeNull();

      const onlyConvert = emptyPhases({
        converting: {
          status: 'failed',
          progress: 0,
          tokens: 0,
          errorMessage: 'encode fail',
        },
      });
      expect(getFailedPhaseError(onlyConvert)).toEqual({
        phase: 'converting',
        message: 'encode fail',
      });

      const both = emptyPhases({
        converting: {
          status: 'failed',
          progress: 0,
          tokens: 0,
          errorMessage: 'encode fail',
        },
        translating: {
          status: 'failed',
          progress: 40,
          tokens: 0,
          errorMessage: '401 Unauthorized',
        },
      });
      expect(getFailedPhaseError(both)?.message).toBe('401 Unauthorized');
      expect(getFailedPhaseError(both)?.phase).toBe('translating');

      const noMsg = emptyPhases({
        translating: { status: 'failed', progress: 0, tokens: 0 },
      });
      expect(getFailedPhaseError(noMsg)?.message).toBe('任务失败');
    });

    it('shouldShowTaskErrorDetail hides generic 任务失败 noise', () => {
      expect(shouldShowTaskErrorDetail({ message: '任务失败' })).toBe(false);
      expect(shouldShowTaskErrorDetail({ message: '失败' })).toBe(false);
      expect(shouldShowTaskErrorDetail({ message: '401 Unauthorized' })).toBe(true);
      expect(shouldShowTaskErrorDetail(null)).toBe(false);
    });
  });

  describe('export format persistence', () => {
    let mem: Record<string, string>;
    let storage: Storage;

    beforeEach(() => {
      mem = {};
      storage = {
        getItem: (k: string) => (k in mem ? mem[k] : null),
        setItem: (k: string, v: string) => {
          mem[k] = v;
        },
        removeItem: (k: string) => {
          delete mem[k];
        },
        clear: () => {
          mem = {};
        },
        key: () => null,
        length: 0,
      };
    });

    it('isExportFormat validates known formats', () => {
      expect(isExportFormat('trans')).toBe(true);
      expect(isExportFormat('package')).toBe(true);
      expect(isExportFormat('nope')).toBe(false);
      expect(isExportFormat(null)).toBe(false);
    });

    it('read/write last export format via storage', () => {
      expect(readLastExportFormat(storage)).toBe('trans');
      writeLastExportFormat('src_trans', storage);
      expect(mem[LAST_EXPORT_FORMAT_KEY]).toBe('src_trans');
      expect(readLastExportFormat(storage)).toBe('src_trans');
      mem[LAST_EXPORT_FORMAT_KEY] = 'bogus';
      expect(readLastExportFormat(storage, 'src')).toBe('src');
    });
  });

  describe('editor helpers', () => {
    it('formatMatchCount only when filter active', () => {
      expect(formatMatchCount(5, false)).toBeNull();
      expect(formatMatchCount(0, true)).toBe('0 条匹配');
      expect(formatMatchCount(12, true)).toBe('12 条匹配');
    });

    it('swapLanguages swaps source and target', () => {
      expect(swapLanguages('English', '简体中文')).toEqual({
        sourceLanguage: '简体中文',
        targetLanguage: 'English',
      });
    });
  });
});
