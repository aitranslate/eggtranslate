import type { AacAdtsConfig } from './adts';

/** demux 抽出的 AAC 帧（未解码） */
export interface AacTrackPayload {
  frames: Uint8Array[];
  description: Uint8Array;
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  adtsConfig: AacAdtsConfig;
}
