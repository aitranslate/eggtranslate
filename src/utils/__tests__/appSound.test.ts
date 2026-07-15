import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useSoundStore } from '@/stores/soundStore';
import { playAppSound, __resetAppSoundForTests } from '../appSound';

describe('playAppSound', () => {
  beforeEach(() => {
    __resetAppSoundForTests();
    useSoundStore.setState({ soundEnabled: true });
  });

  afterEach(() => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
  });

  it('does not construct AudioContext when sound is disabled', () => {
    useSoundStore.setState({ soundEnabled: false });
    let constructed = 0;
    (globalThis as { AudioContext?: new () => unknown }).AudioContext = class {
      constructor() {
        constructed += 1;
      }
    };

    playAppSound('success');
    playAppSound('error');
    expect(constructed).toBe(0);
  });

  it('is a no-op when AudioContext is missing', () => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    expect(() => playAppSound('success')).not.toThrow();
  });
});

describe('useSoundStore', () => {
  it('toggles soundEnabled', () => {
    useSoundStore.setState({ soundEnabled: true });
    useSoundStore.getState().toggleSound();
    expect(useSoundStore.getState().soundEnabled).toBe(false);
    useSoundStore.getState().toggleSound();
    expect(useSoundStore.getState().soundEnabled).toBe(true);
  });
});
