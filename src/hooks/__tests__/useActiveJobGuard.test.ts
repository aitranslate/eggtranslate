import { describe, it, expect } from 'vitest';
import { hasActivePhase, shouldPromptBeforeUnload } from '@/utils/uxHelpers';
import type { FilePhases } from '@/types';

/** 与 useActiveJobGuard / useIsActiveJob 相同的判定核心 */
function isActiveJob(opts: {
  isTranslating: boolean;
  activeTaskId: string | null;
  phasesList: Array<FilePhases | undefined>;
}): boolean {
  const anyPhase = opts.phasesList.some((p) => hasActivePhase(p));
  return Boolean(opts.isTranslating || opts.activeTaskId || anyPhase);
}

describe('active job leave guard (shipped helpers)', () => {
  const idle: FilePhases = {
    workflow: 'translate',
    converting: { status: 'completed', progress: 100, tokens: 0 },
    transcribing: { status: 'completed', progress: 100, tokens: 0 },
    translating: { status: 'upcoming', progress: 0, tokens: 0 },
  };

  const running: FilePhases = {
    ...idle,
    translating: { status: 'active', progress: 20, tokens: 10 },
  };

  it('prompts only when translating, queue active, or phase active', () => {
    expect(
      shouldPromptBeforeUnload(
        isActiveJob({ isTranslating: false, activeTaskId: null, phasesList: [idle] })
      )
    ).toBe(false);

    expect(
      shouldPromptBeforeUnload(
        isActiveJob({ isTranslating: true, activeTaskId: null, phasesList: [idle] })
      )
    ).toBe(true);

    expect(
      shouldPromptBeforeUnload(
        isActiveJob({ isTranslating: false, activeTaskId: 't1', phasesList: [idle] })
      )
    ).toBe(true);

    expect(
      shouldPromptBeforeUnload(
        isActiveJob({ isTranslating: false, activeTaskId: null, phasesList: [running] })
      )
    ).toBe(true);
  });
});
