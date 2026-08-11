import { describe, it, expect } from 'vitest';
import {
  parseAudioSpecificConfig,
  buildAdtsFrame,
  sampleRateToIndex,
  ADTS_SAMPLE_RATES,
} from '../mediaDemux/adts';
import { extractAudioSpecificConfig } from '../mediaDemux/mp4Extract';

describe('parseAudioSpecificConfig', () => {
  it('parses AAC-LC 44100 stereo (common ASC)', () => {
    // AOT=2, freqIdx=4 (44100), channels=2 → 0x12 0x10
    const asc = new Uint8Array([0x12, 0x10]);
    const cfg = parseAudioSpecificConfig(asc);
    expect(cfg.audioObjectType).toBe(2);
    expect(cfg.sampleRateIndex).toBe(4);
    expect(cfg.channelConfig).toBe(2);
    expect(ADTS_SAMPLE_RATES[cfg.sampleRateIndex]).toBe(44100);
  });
});

describe('buildAdtsFrame', () => {
  it('prefixes 7-byte header and preserves payload', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const frame = buildAdtsFrame(payload, {
      audioObjectType: 2,
      sampleRateIndex: 4,
      channelConfig: 2,
    });
    expect(frame.byteLength).toBe(12);
    expect(frame[0]).toBe(0xff);
    expect(frame[1] & 0xf0).toBe(0xf0);
    expect(Array.from(frame.slice(7))).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('sampleRateToIndex', () => {
  it('maps 44100 and 48000', () => {
    expect(sampleRateToIndex(44100)).toBe(4);
    expect(sampleRateToIndex(48000)).toBe(3);
  });
});

describe('extractAudioSpecificConfig', () => {
  it('walks esds descriptor tree for tag=5', () => {
    const asc = new Uint8Array([0x12, 0x10]);
    const description = {
      esds: {
        esd: {
          descs: [
            {
              tag: 4,
              descs: [{ tag: 5, data: asc, descs: [] }],
            },
          ],
        },
      },
    };
    const out = extractAudioSpecificConfig(description);
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual([0x12, 0x10]);
  });
});
