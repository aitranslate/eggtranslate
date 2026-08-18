import { describe, it, expect } from 'vitest';
import {
  formatTaskPhaseChipLabel,
  getDisplayPhases,
  resolveTranslatePhaseLabel,
} from '../badgeHelper';
import type { FilePhases } from '@/types';

function phases(overrides?: Partial<FilePhases>): FilePhases {
  return {
    workflow: 'translate',
    converting: { status: 'upcoming', progress: 0, tokens: 0 },
    transcribing: { status: 'upcoming', progress: 0, tokens: 0 },
    translating: { status: 'upcoming', progress: 0, tokens: 0 },
    ...overrides,
  };
}

describe('resolveTranslatePhaseLabel', () => {
  it('always uses 翻译', () => {
    expect(resolveTranslatePhaseLabel()).toBe('翻译');
  });
});

describe('getDisplayPhases', () => {
  it('srt only shows translation', () => {
    expect(getDisplayPhases({ fileType: 'srt', phases: phases() })).toEqual([
      'translating',
    ]);
  });

  it('audio/video hide converting and only show segmenting when present', () => {
    expect(getDisplayPhases({ fileType: 'audio', phases: phases() })).toEqual([
      'transcribing',
      'translating',
    ]);
    expect(
      getDisplayPhases({
        fileType: 'video',
        phases: phases({
          segmenting: { status: 'upcoming', progress: 0, tokens: 0 },
        }),
      })
    ).toEqual(['transcribing', 'segmenting', 'translating']);
  });
});

describe('formatTaskPhaseChipLabel', () => {
  it('uses 翻译 n/m when total is known', () => {
    expect(
      formatTaskPhaseChipLabel('translating', { translated: 13, total: 120 })
    ).toBe('翻译 13/120');
  });

  it('shows AI断句 n/m only while that phase is active', () => {
    expect(
      formatTaskPhaseChipLabel('segmenting', {
        status: 'active',
        segmenting: { entryCount: 4, totalEntries: 20 },
        translated: 0,
        total: 0,
      })
    ).toBe('AI断句 4/20');
    expect(
      formatTaskPhaseChipLabel('segmenting', {
        status: 'completed',
        segmenting: { entryCount: 20, totalEntries: 20 },
        translated: 0,
        total: 0,
      })
    ).toBe('AI断句');
  });
});
