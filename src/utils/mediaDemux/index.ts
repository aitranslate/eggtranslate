/**
 * 轻量媒体 demux：只抽音轨，不做解码/重编码
 */
export {
  extractAudioFromIsoBmff,
  shouldTryIsoBmffDemux,
  extractAudioSpecificConfig,
} from './mp4Extract';
export type { ExtractedAudio } from './mp4Extract';
export type { AacTrackPayload } from './aacTypes';
export {
  parseAudioSpecificConfig,
  buildAdtsFrame,
  sampleRateToIndex,
  ADTS_SAMPLE_RATES,
} from './adts';
