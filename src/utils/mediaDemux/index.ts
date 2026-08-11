/**
 * 轻量媒体 demux 入口（非 FFmpeg）
 * 当前：ISOBMFF(mp4/m4a/mov/…) → AAC ADTS
 */
export {
  extractAudioFromIsoBmff,
  shouldTryIsoBmffDemux,
  extractAudioSpecificConfig,
} from './mp4Extract';
export type { ExtractedAudio } from './mp4Extract';
export {
  parseAudioSpecificConfig,
  buildAdtsFrame,
  sampleRateToIndex,
  ADTS_SAMPLE_RATES,
} from './adts';
