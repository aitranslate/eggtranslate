import { describe, it, expect } from 'vitest';
import { FFMPEG_CACHE_NAME, isFfmpegCacheName } from '../convertToMP3';

describe('isFfmpegCacheName', () => {
  it('keeps current FFmpeg cache name', () => {
    expect(FFMPEG_CACHE_NAME).toBe('egg-ffmpeg-core-v1');
    expect(isFfmpegCacheName(FFMPEG_CACHE_NAME)).toBe(true);
  });

  it('keeps future egg-ffmpeg-core* versions', () => {
    expect(isFfmpegCacheName('egg-ffmpeg-core-v2')).toBe(true);
  });

  it('allows deleting legacy SW / workbox caches', () => {
    expect(isFfmpegCacheName('workbox-precache-v2')).toBe(false);
    expect(isFfmpegCacheName('eggtranslate-shell')).toBe(false);
  });
});
