import { describe, it, expect } from 'vitest';
import {
  isTranscriptionApiConfigured,
  shouldGuardTranslationStart,
  shouldGuardTranscriptionStart,
  resolveFullPathGuard,
  isMediaImportFileName,
  needsTranscriptionWork,
} from '../taskGuards';
import type { FilePhases } from '@/types';

describe('taskGuards', () => {
  it('shouldGuardTranslationStart', () => {
    expect(shouldGuardTranslationStart(false, 'translate')).toBe(true);
    expect(shouldGuardTranslationStart(false, 'full')).toBe(true);
    expect(shouldGuardTranslationStart(false, 'batch')).toBe(true);
    expect(shouldGuardTranslationStart(false, 'transcribe')).toBe(false);
    expect(shouldGuardTranslationStart(true, 'translate')).toBe(false);
  });

  it('shouldGuardTranscriptionStart', () => {
    expect(shouldGuardTranscriptionStart('', 'transcribe')).toBe(true);
    expect(shouldGuardTranscriptionStart('sk', 'transcribe')).toBe(false);
    expect(shouldGuardTranscriptionStart('', 'translate')).toBe(false);
  });

  it('resolveFullPathGuard prioritizes transcription', () => {
    expect(
      resolveFullPathGuard({
        isTranslationConfigured: false,
        transcriptionApiKeys: '',
      })
    ).toBe('transcription');
    expect(
      resolveFullPathGuard({
        isTranslationConfigured: false,
        transcriptionApiKeys: 'sk',
      })
    ).toBe('translation');
    expect(
      resolveFullPathGuard({
        isTranslationConfigured: true,
        transcriptionApiKeys: 'sk',
      })
    ).toBeNull();
  });

  it('needsTranscriptionWork resumes when asrReady or transcriptId with no entries', () => {
    const base: FilePhases = {
      workflow: 'transcribe',
      converting: { status: 'completed', progress: 100, tokens: 0 },
      transcribing: { status: 'completed', progress: 100, tokens: 0 },
      translating: { status: 'upcoming', progress: 0, tokens: 0 },
    };
    expect(
      needsTranscriptionWork({
        fileType: 'audio',
        entryCount: 0,
        phases: base,
      })
    ).toBe(false);
    expect(
      needsTranscriptionWork({
        fileType: 'audio',
        entryCount: 0,
        aiSegmentationEnabled: true,
        phases: {
          ...base,
          transcribing: { ...base.transcribing, asrReady: true },
          segmenting: { status: 'failed', progress: 0, tokens: 0 },
        },
      })
    ).toBe(true);
    expect(
      needsTranscriptionWork({
        fileType: 'audio',
        entryCount: 0,
        phases: {
          ...base,
          transcribing: { ...base.transcribing, asrReady: true },
        },
      })
    ).toBe(false);
    expect(
      needsTranscriptionWork({
        fileType: 'audio',
        entryCount: 0,
        phases: {
          ...base,
          transcribing: { ...base.transcribing, transcriptId: 'abc' },
        },
      })
    ).toBe(true);
    expect(
      needsTranscriptionWork({
        fileType: 'audio',
        entryCount: 8,
        phases: {
          ...base,
          transcribing: { ...base.transcribing, asrReady: true },
        },
      })
    ).toBe(false);
    expect(
      needsTranscriptionWork({
        fileType: 'srt',
        entryCount: 0,
        phases: base,
      })
    ).toBe(false);
  });

  it('isTranscriptionApiConfigured / isMediaImportFileName', () => {
    expect(isTranscriptionApiConfigured('  sk  ')).toBe(true);
    expect(isTranscriptionApiConfigured('')).toBe(false);
    expect(isMediaImportFileName('a.mp4')).toBe(true);
    expect(isMediaImportFileName('b.MP3')).toBe(true);
    expect(isMediaImportFileName('c.srt')).toBe(false);
  });
});
