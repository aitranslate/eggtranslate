import { describe, expect, it } from 'vitest';
import {
  LOCAL_ASR_MODELS,
  mapLocalWords,
  modelById,
  modelUrl,
  sizeLabel,
} from '@/services/localAsrService';

describe('localAsrService', () => {
  it('builds the official ModelScope URL for every release', () => {
    for (const model of LOCAL_ASR_MODELS) {
      expect(modelUrl(model.id)).toBe(
        'https://modelscope.cn/models/ConwayResearch/' +
          model.repo +
          '/resolve/master/' +
          model.file
      );
    }
  });

  it('labels sizes the way the model cards do', () => {
    expect(sizeLabel(179_524_845)).toBe('180 MB');
    expect(sizeLabel(163_398_645)).toBe('163 MB');
    expect(sizeLabel(1_254_196_636)).toBe('1.25 GB');
  });

  it('falls back to the default model for an unknown id', () => {
    expect(modelById('plus').label).toBe('Bark 3.0 Plus');
    // 运行时兜底：旧配置里的未知值不应该炸
    expect(modelById('nope' as never).label).toBe(LOCAL_ASR_MODELS[0].label);
  });

  it('maps wasm words to the pipeline shape, seconds untouched', () => {
    const words = mapLocalWords([
      { text: 'All', start: 1.67, end: 1.83 },
      { text: ',', start: 1.83, end: 1.9 },
      { text: 'right,', start: 1.83, end: 2.23 },
    ]);
    expect(words).toEqual([
      { text: 'All', start: 1.67, end: 1.83 },
      { text: 'right,', start: 1.83, end: 2.23 },
    ]);
  });

  it('keeps punctuation attached to words, drops non-speech tokens', () => {
    const words = mapLocalWords([
      { text: '-', start: 0, end: 0.08 },
      { text: "'", start: 0.08, end: 0.16 },
      { text: '2022.', start: 0.16, end: 0.4 },
    ]);
    expect(words.map((w) => w.text)).toEqual(['2022.']);
  });
});
