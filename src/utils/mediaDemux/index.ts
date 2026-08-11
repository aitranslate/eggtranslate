/**
 * 轻量媒体 demux 入口（非 FFmpeg）
 */
export {
  extractAudioFromIsoBmff,
  shouldTryIsoBmffDemux,
  extractAudioSpecificConfig,
} from './mp4Extract';
export type { ExtractedAudio } from './mp4Extract';
export { decodeAacPayload } from './aacDecode';
export type { AacTrackPayload } from './aacDecode';
export {
  parseAudioSpecificConfig,
  buildAdtsFrame,
  sampleRateToIndex,
  ADTS_SAMPLE_RATES,
} from './adts';
