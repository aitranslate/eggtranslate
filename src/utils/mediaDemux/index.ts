/**
 * 轻量媒体 demux：流式抽 AAC 音轨 → ADTS，不做解码/重编码
 */
export {
  extractAacAdtsFromIsoBmff,
  extractAudioFromIsoBmff,
  shouldTryIsoBmffDemux,
  extractAudioSpecificConfig,
} from './mp4Extract';
export type { ExtractedAdtsAudio } from './mp4Extract';
export {
  parseAudioSpecificConfig,
  buildAdtsFrame,
  buildAdtsConfigFromAsc,
  sampleRateToIndex,
  ADTS_SAMPLE_RATES,
} from './adts';
