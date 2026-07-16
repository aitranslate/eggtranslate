import { describe, it, expect } from 'vitest';
import {
  isTranscriptionApiConfigured,
  shouldGuardTranslationStart,
  shouldGuardTranscriptionStart,
  resolveFullPathGuard,
  isMediaImportFileName,
} from '../taskGuards';

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

  it('isTranscriptionApiConfigured / isMediaImportFileName', () => {
    expect(isTranscriptionApiConfigured('  sk  ')).toBe(true);
    expect(isTranscriptionApiConfigured('')).toBe(false);
    expect(isMediaImportFileName('a.mp4')).toBe(true);
    expect(isMediaImportFileName('b.MP3')).toBe(true);
    expect(isMediaImportFileName('c.srt')).toBe(false);
  });
});
