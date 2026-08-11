import { describe, it, expect } from 'vitest';
import { mixToMono, downsampleBuffer } from '../mp3AudioMath';

function makeBuffer(channels: Float32Array[], sampleRate = 48000): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  return {
    numberOfChannels: channels.length,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: (i: number) => channels[i],
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined,
  } as unknown as AudioBuffer;
}

describe('mixToMono', () => {
  it('copies mono channel', () => {
    const left = new Float32Array([0.5, -0.5, 0.25]);
    const mono = mixToMono(makeBuffer([left]));
    expect(Array.from(mono)).toEqual([0.5, -0.5, 0.25]);
    mono[0] = 0;
    expect(left[0]).toBe(0.5);
  });

  it('averages stereo channels', () => {
    const L = new Float32Array([1, 0, -1]);
    const R = new Float32Array([-1, 0, 1]);
    const mono = mixToMono(makeBuffer([L, R]));
    expect(mono[0]).toBeCloseTo(0);
    expect(mono[1]).toBeCloseTo(0);
    expect(mono[2]).toBeCloseTo(0);
  });
});

describe('downsampleBuffer', () => {
  it('passthrough same rate to int16', () => {
    const src = new Float32Array([0, 0.5, -0.5, 1]);
    const out = downsampleBuffer(src, 16000, 16000);
    expect(out).toBeInstanceOf(Int16Array);
    expect(out.length).toBe(4);
    expect(out[1]).toBeGreaterThan(0);
    expect(out[2]).toBeLessThan(0);
  });

  it('downsamples 48k → 16k by factor ~3', () => {
    const n = 4800;
    const src = new Float32Array(n);
    for (let i = 0; i < n; i++) src[i] = Math.sin(i / 20);
    const out = downsampleBuffer(src, 48000, 16000);
    expect(out.length).toBeGreaterThan(1500);
    expect(out.length).toBeLessThan(1700);
  });
});
