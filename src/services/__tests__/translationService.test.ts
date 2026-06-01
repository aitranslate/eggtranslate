import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFilesStore } from '@/stores/filesStore';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { startTranslation } from '../translationService';

vi.mock('localforage', () => ({
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(undefined),
    removeItem: () => Promise.resolve(undefined),
  },
}));

const makeFile = (taskId: string, translating: 'completed' | 'upcoming' = 'upcoming', splitting: 'completed' | 'upcoming' = 'upcoming') => ({
  id: `file_${taskId}`,
  taskId,
  name: `${taskId}.srt`,
  fileType: 'srt' as const,
  fileSize: 100,
  lastModified: 0,
  entryCount: 10,
  translatedCount: 0,
  tokensUsed: 0,
  entriesVersion: 0,
  phases: {
    workflow: 'translate' as const,
    converting: { status: 'completed' as const, progress: 100, tokens: 0 },
    transcribing: { status: 'completed' as const, progress: 100, tokens: 0 },
    translating: { status: translating, progress: translating === 'completed' ? 100 : 0, tokens: 0 },
    splitting: { status: splitting, progress: splitting === 'completed' ? 100 : 0, tokens: 0 },
  },
});

describe('translationService', () => {
  beforeEach(() => {
    useFilesStore.setState({ tasks: [] });
    useTranslationConfigStore.setState({
      isConfigured: false,
      isTranslating: false,
      config: {
        baseURL: '',
        apiKey: '',
        model: '',
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        batchSize: 20,
        contextBefore: 5,
        contextAfter: 3,
        threadCount: 4,
      },
    });
  });

  it('returns null when file not found', async () => {
    const result = await startTranslation('non-existent');
    expect(result).toBeNull();
  });

  it('returns null when translation not configured', async () => {
    useFilesStore.setState({ tasks: [makeFile('t1')] as any });
    const result = await startTranslation('file_t1');
    expect(result).toBeNull();
  });

  it('returns null when translation already completed', async () => {
    useFilesStore.setState({
      tasks: [makeFile('t1', 'completed', 'completed')] as any,
    });
    useTranslationConfigStore.setState({ isConfigured: true } as any);

    const result = await startTranslation('file_t1');
    expect(result).toBeNull();
  });
});
