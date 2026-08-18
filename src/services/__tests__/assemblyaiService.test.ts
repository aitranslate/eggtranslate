import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSubmit = vi.fn();
const mockGet = vi.fn();

vi.mock('assemblyai', () => ({
  AssemblyAI: class {
    transcripts = {
      submit: mockSubmit,
      get: mockGet,
    };
  },
}));

import { assemblyaiService } from '../assemblyaiService';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { fingerprintApiKey } from '@/services/checkpoint';

function completedTranscript(id: string) {
  return {
    id,
    status: 'completed' as const,
    language_code: 'en',
    speech_model_used: 'universal-2',
    words: [
      { text: 'Hello', start: 0, end: 400, confidence: 0.9 },
      { text: 'world', start: 400, end: 800, confidence: 0.8 },
    ],
  };
}

describe('assemblyaiService.transcribeAudio', () => {
  beforeEach(() => {
    mockSubmit.mockReset();
    mockGet.mockReset();
    useTranscriptionStore.setState({ apiKeys: 'sk-testkey' });
  });

  it('submits then persists id via onSubmitted before polling', async () => {
    mockSubmit.mockResolvedValue({
      id: 'tid-new',
      status: 'queued',
    });
    mockGet.mockResolvedValue(completedTranscript('tid-new'));
    const onSubmitted = vi.fn();

    const result = await assemblyaiService.transcribeAudio(
      new File(['x'], 'a.mp3', { type: 'audio/mpeg' }),
      { onSubmitted }
    );

    expect(onSubmitted).toHaveBeenCalledWith({
      transcriptId: 'tid-new',
      keyFingerprint: fingerprintApiKey('sk-testkey'),
    });
    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(result.transcriptId).toBe('tid-new');
    expect(result.words.map((w) => w.text)).toEqual(['Hello', 'world']);
    expect(result.words[0].start).toBe(0);
    expect(result.words[0].end).toBe(0.4);
  });

  it('resumes by GET and does not submit again', async () => {
    mockGet.mockResolvedValue(completedTranscript('tid-old'));

    const result = await assemblyaiService.transcribeAudio(null, {
      resumeTranscriptId: 'tid-old',
      resumeKeyFingerprint: fingerprintApiKey('sk-testkey'),
    });

    expect(mockSubmit).not.toHaveBeenCalled();
    expect(mockGet).toHaveBeenCalledWith('tid-old');
    expect(result.transcriptId).toBe('tid-old');
    expect(result.language).toBe('en');
  });

  it('resubmits when resume GET 404s and audio is available', async () => {
    mockGet.mockRejectedValue(new Error('404 not found'));
    mockSubmit.mockResolvedValue(completedTranscript('tid-2'));

    const result = await assemblyaiService.transcribeAudio(
      new File(['x'], 'a.mp3', { type: 'audio/mpeg' }),
      { resumeTranscriptId: 'gone' }
    );

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    expect(result.transcriptId).toBe('tid-2');
  });
});
