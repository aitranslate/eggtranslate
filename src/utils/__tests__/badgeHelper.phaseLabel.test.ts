import { describe, it, expect } from 'vitest';
import { resolveTranslatePhaseLabel } from '../badgeHelper';

describe('resolveTranslatePhaseLabel', () => {
  it('prefers task translationPath over global switch', () => {
    expect(
      resolveTranslatePhaseLabel({
        translationPath: 'agent',
        agentEnabled: false,
        translatingStatus: 'completed',
      })
    ).toBe('Agent翻译');
    expect(
      resolveTranslatePhaseLabel({
        translationPath: 'batch',
        agentEnabled: true,
        translatingStatus: 'completed',
      })
    ).toBe('翻译');
  });

  it('shows Agent翻译 while agent run is active', () => {
    expect(
      resolveTranslatePhaseLabel({
        agentRunActive: true,
        agentEnabled: false,
        translatingStatus: 'active',
      })
    ).toBe('Agent翻译');
  });

  it('uses config only for upcoming/active without path', () => {
    expect(
      resolveTranslatePhaseLabel({
        agentEnabled: true,
        translatingStatus: 'upcoming',
      })
    ).toBe('Agent翻译');
    expect(
      resolveTranslatePhaseLabel({
        agentEnabled: false,
        translatingStatus: 'upcoming',
      })
    ).toBe('翻译');
  });

  it('defaults completed legacy tasks without path to 翻译', () => {
    expect(
      resolveTranslatePhaseLabel({
        agentEnabled: true,
        translatingStatus: 'completed',
      })
    ).toBe('翻译');
  });
});
