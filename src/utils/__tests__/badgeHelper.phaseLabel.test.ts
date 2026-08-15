import { describe, it, expect } from 'vitest';
import { resolveTranslatePhaseLabel } from '../badgeHelper';

describe('resolveTranslatePhaseLabel', () => {
  it('always uses 翻译', () => {
    expect(resolveTranslatePhaseLabel()).toBe('翻译');
  });
});
