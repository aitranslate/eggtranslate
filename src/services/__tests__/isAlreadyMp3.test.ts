import { describe, it, expect } from 'vitest';
import { isAlreadyMp3 } from '../assemblyaiService';

describe('isAlreadyMp3', () => {
  it('accepts audio/mpeg and audio/mp3', () => {
    expect(isAlreadyMp3({ type: 'audio/mpeg' })).toBe(true);
    expect(isAlreadyMp3({ type: 'audio/mp3' })).toBe(true);
    expect(isAlreadyMp3({ type: 'Audio/MPEG' })).toBe(true);
  });

  it('accepts .mp3 file name', () => {
    expect(isAlreadyMp3({ type: '', name: 'clip.mp3' })).toBe(true);
    expect(isAlreadyMp3({ name: 'CLIP.MP3' })).toBe(true);
  });

  it('rejects non-mp3 media', () => {
    expect(isAlreadyMp3({ type: 'audio/wav', name: 'a.wav' })).toBe(false);
    expect(isAlreadyMp3({ type: 'video/mp4', name: 'a.mp4' })).toBe(false);
    expect(isAlreadyMp3({})).toBe(false);
  });
});
