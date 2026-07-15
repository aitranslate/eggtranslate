import { describe, it, expect, vi } from 'vitest';
import {
  collectExportEligibleTaskIds,
  deriveChecklistSteps,
  hasFinishedOnceEvidence,
  isChecklistComplete,
  isMediaImportFileName,
  isTipCompleted,
  isTranscriptionApiConfigured,
  nextUnacknowledgedExportTaskId,
  pruneAcknowledgedTaskIds,
  resolveEmptyWorkspaceCopy,
  resolveEmptyWorkspaceMode,
  resolveFullPathGuard,
  resolveSampleFollowUpTip,
  seedAcknowledgedExportTaskIds,
  setupGuardCopy,
  shouldGuardTranscriptionStart,
  shouldGuardTranslationStart,
  shouldShowChecklist,
  tipCopy,
  tryShowExportFormatsTip,
} from '../onboarding';

describe('onboarding helpers', () => {
  describe('shouldGuardTranslationStart', () => {
    it('guards translate/full/batch when not configured', () => {
      expect(shouldGuardTranslationStart(false, 'translate')).toBe(true);
      expect(shouldGuardTranslationStart(false, 'full')).toBe(true);
      expect(shouldGuardTranslationStart(false, 'batch')).toBe(true);
    });

    it('does not guard pure transcribe', () => {
      expect(shouldGuardTranslationStart(false, 'transcribe')).toBe(false);
    });

    it('does not guard when configured', () => {
      expect(shouldGuardTranslationStart(true, 'translate')).toBe(false);
      expect(shouldGuardTranslationStart(true, 'batch')).toBe(false);
    });
  });

  describe('shouldGuardTranscriptionStart', () => {
    it('guards transcribe/full when keys missing', () => {
      expect(shouldGuardTranscriptionStart('', 'transcribe')).toBe(true);
      expect(shouldGuardTranscriptionStart(null, 'full')).toBe(true);
    });

    it('does not guard pure translate', () => {
      expect(shouldGuardTranscriptionStart('', 'translate')).toBe(false);
    });

    it('does not guard when keys present', () => {
      expect(shouldGuardTranscriptionStart('key', 'transcribe')).toBe(false);
    });
  });

  describe('resolveFullPathGuard', () => {
    it('prioritizes transcription over translation', () => {
      expect(
        resolveFullPathGuard({
          isTranslationConfigured: false,
          transcriptionApiKeys: '',
        })
      ).toBe('transcription');
      expect(
        resolveFullPathGuard({
          isTranslationConfigured: false,
          transcriptionApiKeys: 'aa',
        })
      ).toBe('translation');
      expect(
        resolveFullPathGuard({
          isTranslationConfigured: true,
          transcriptionApiKeys: 'aa',
        })
      ).toBeNull();
    });
  });

  describe('isTranscriptionApiConfigured', () => {
    it('false when keys empty', () => {
      expect(isTranscriptionApiConfigured('')).toBe(false);
      expect(isTranscriptionApiConfigured('   ')).toBe(false);
      expect(isTranscriptionApiConfigured(null)).toBe(false);
    });

    it('true when keys present', () => {
      expect(isTranscriptionApiConfigured('sk-xxx')).toBe(true);
    });
  });

  describe('empty workspace state machine', () => {
    it('fresh unconfigured prioritizes sample and mentions both paths', () => {
      const copy = resolveEmptyWorkspaceCopy({
        isDragging: false,
        fileCount: 0,
        isConfigured: false,
      });
      expect(copy.mode).toBe('fresh_unconfigured');
      expect(copy.primary).toBe('sample');
      expect(copy.showConfigure).toBe(true);
      expect(copy.title).toMatch(/转录|翻译/);
      expect(copy.description).toMatch(/音视频|转录/);
    });

    it('configured empty prioritizes import', () => {
      const copy = resolveEmptyWorkspaceCopy({
        isDragging: false,
        fileCount: 0,
        isConfigured: true,
      });
      expect(copy.mode).toBe('configured_empty');
      expect(copy.primary).toBe('import');
      expect(copy.showConfigure).toBe(false);
      expect(copy.description).toMatch(/AssemblyAI|转录/);
    });

    it('has files unselected', () => {
      expect(
        resolveEmptyWorkspaceMode({ isDragging: false, fileCount: 2, isConfigured: true })
      ).toBe('has_files_unselected');
    });

    it('dragging overrides', () => {
      const copy = resolveEmptyWorkspaceCopy({
        isDragging: true,
        fileCount: 0,
        isConfigured: false,
      });
      expect(copy.mode).toBe('dragging');
      expect(copy.title).toMatch(/松开/);
    });
  });

  describe('checklist', () => {
    it('includes optional transcription step', () => {
      const steps = deriveChecklistSteps({
        isConfigured: true,
        isTranscriptionConfigured: false,
        fileCount: 1,
        hasFinishedOnce: false,
      });
      expect(steps.find((s) => s.id === 'configure')?.done).toBe(true);
      const tx = steps.find((s) => s.id === 'configure_transcription');
      expect(tx?.optional).toBe(true);
      expect(tx?.done).toBe(false);
      expect(tx?.settingsFocus).toBe('transcription');
      expect(steps.find((s) => s.id === 'import')?.done).toBe(true);
      expect(steps.find((s) => s.id === 'finish')?.done).toBe(false);
      // 可选未完成不阻塞
      expect(isChecklistComplete(steps)).toBe(false); // finish 未完成
    });

    it('complete when required done even if transcription optional incomplete', () => {
      const steps = deriveChecklistSteps({
        isConfigured: true,
        isTranscriptionConfigured: false,
        fileCount: 2,
        hasFinishedOnce: true,
      });
      expect(isChecklistComplete(steps)).toBe(true);
      expect(shouldShowChecklist({ dismissed: false, steps })).toBe(false);
      expect(shouldShowChecklist({ dismissed: false, steps, forceShow: true })).toBe(true);
    });

    it('hidden when dismissed', () => {
      const steps = deriveChecklistSteps({
        isConfigured: false,
        isTranscriptionConfigured: false,
        fileCount: 0,
        hasFinishedOnce: false,
      });
      expect(shouldShowChecklist({ dismissed: true, steps })).toBe(false);
      expect(shouldShowChecklist({ dismissed: false, steps })).toBe(true);
      expect(shouldShowChecklist({ dismissed: true, steps, forceShow: true })).toBe(false);
    });
  });

  describe('finish evidence', () => {
    it('any of history / export / translate / transcribe phase', () => {
      expect(
        hasFinishedOnceEvidence({
          historyCount: 0,
          hasExported: false,
          anyTranslationCompleted: false,
          anyTranscriptionCompleted: true,
        })
      ).toBe(true);
      expect(
        hasFinishedOnceEvidence({
          historyCount: 0,
          hasExported: false,
          anyTranslationCompleted: false,
        })
      ).toBe(false);
    });
  });

  describe('tips and guards copy', () => {
    it('sample follow-up depends on config', () => {
      expect(resolveSampleFollowUpTip(true)).toBe('after_sample_configured');
      expect(resolveSampleFollowUpTip(false)).toBe('after_sample_unconfigured');
    });

    it('media and export tips', () => {
      expect(tipCopy('after_media_import').actionFocus).toBe('transcription');
      expect(tipCopy('export_formats').title).toMatch(/导出/);
      expect(isTipCompleted(['export_formats'], 'export_formats')).toBe(true);
    });

    it('setup guard copy for both kinds', () => {
      expect(setupGuardCopy('transcription').title).toMatch(/转录/);
      expect(setupGuardCopy('translation').title).toMatch(/翻译/);
    });
  });

  describe('isMediaImportFileName', () => {
    it('detects media vs srt', () => {
      expect(isMediaImportFileName('a.mp4')).toBe(true);
      expect(isMediaImportFileName('b.MP3')).toBe(true);
      expect(isMediaImportFileName('c.srt')).toBe(false);
    });
  });

  describe('export tip tracking', () => {
    const phases = (tx: string, tr: string) => ({
      translating: { status: tx },
      transcribing: { status: tr },
    });

    it('seeds both translate and transcribe completed', () => {
      const tasks = [
        { taskId: 'a', phases: phases('completed', 'upcoming') },
        { taskId: 'b', phases: phases('upcoming', 'completed') },
        { taskId: 'c', phases: phases('upcoming', 'upcoming') },
      ];
      const seed = seedAcknowledgedExportTaskIds(tasks);
      expect(seed.has('a')).toBe(true);
      expect(seed.has('b')).toBe(true);
      expect(seed.has('c')).toBe(false);
      expect(collectExportEligibleTaskIds(tasks)).toEqual(['a', 'b']);
    });

    it('nextUnacknowledged and prune', () => {
      expect(nextUnacknowledgedExportTaskId(['a', 'b'], new Set(['a']))).toBe('b');
      expect(nextUnacknowledgedExportTaskId(['a'], new Set(['a']))).toBeNull();
      const pruned = pruneAcknowledgedTaskIds(new Set(['a', 'gone']), new Set(['a']));
      expect([...pruned]).toEqual(['a']);
    });

    it('tryShowExportFormatsTip only acknowledges on success or permanent skip', () => {
      const showOk = vi.fn().mockReturnValue(true);
      const r1 = tryShowExportFormatsTip({
        eligibleIds: ['t1'],
        acknowledged: new Set(),
        completedTips: [],
        showTipIfNew: showOk,
      });
      expect(r1.shown).toBe(true);
      expect(r1.acknowledged.has('t1')).toBe(true);

      const showBusy = vi.fn().mockReturnValue(false);
      const r2 = tryShowExportFormatsTip({
        eligibleIds: ['t2'],
        acknowledged: new Set(),
        completedTips: [],
        showTipIfNew: showBusy,
      });
      expect(r2.shown).toBe(false);
      expect(r2.acknowledged.has('t2')).toBe(false);

      const r3 = tryShowExportFormatsTip({
        eligibleIds: ['t3', 't4'],
        acknowledged: new Set(),
        completedTips: ['export_formats'],
        showTipIfNew: vi.fn(),
      });
      expect(r3.shown).toBe(false);
      expect(r3.acknowledged.has('t3')).toBe(true);
      expect(r3.acknowledged.has('t4')).toBe(true);
    });

    it('finish step label does not require 导出 wording', () => {
      const steps = deriveChecklistSteps({
        isConfigured: true,
        isTranscriptionConfigured: false,
        fileCount: 1,
        hasFinishedOnce: true,
      });
      expect(steps.find((s) => s.id === 'finish')?.label).not.toMatch(/并导出/);
    });
  });
});
