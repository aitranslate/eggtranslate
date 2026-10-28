import { describe, expect, it } from 'vitest';
import {
  LOCAL_ASR_MODELS,
  formatAdapterName,
  isRepetitive,
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

  it('renders the WebGPU adapter the way the settings panel shows it', () => {
    expect(formatAdapterName({ vendor: 'nvidia', architecture: 'pascal' })).toBe('NVIDIA Pascal');
    expect(formatAdapterName({ vendor: 'intel', architecture: 'xe-lpg' })).toBe('Intel Xe Lpg');
    expect(formatAdapterName({ vendor: 'amd', architecture: 'rdna-2' })).toBe('AMD Rdna 2');
    expect(formatAdapterName({})).toBe('WebGPU 适配器');
  });

  it('flags a decoder that loops on the same word', () => {
    const loop = Array.from({ length: 40 }, () => ({ text: 'tamb' }));
    expect(isRepetitive(loop)).toBe(true);
    expect(isRepetitive([{ text: 'no' }, { text: 'no' }, { text: 'thanks' }])).toBe(false);
    // 断句里的正常重复（"no no"）不算打转
    expect(isRepetitive(Array.from({ length: 5 }, () => ({ text: 'no' })))).toBe(false);
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