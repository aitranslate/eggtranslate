/**
 * 精简 WebCodecs 音频类型（部分 TS lib.dom 未含全量）
 */
interface AudioDataCopyToOptions {
  planeIndex?: number;
  frameOffset?: number;
  frameCount?: number;
  format?: 'u8' | 's16' | 's32' | 'f32' | 'u8-planar' | 's16-planar' | 's32-planar' | 'f32-planar';
}

interface AudioData {
  readonly sampleRate: number;
  readonly numberOfFrames: number;
  readonly numberOfChannels: number;
  readonly format: string | null;
  readonly timestamp: number;
  readonly duration: number | null;
  allocationSize(options: AudioDataCopyToOptions): number;
  copyTo(destination: AllowSharedBufferSource, options: AudioDataCopyToOptions): void;
  close(): void;
}

interface EncodedAudioChunkInit {
  type: 'key' | 'delta';
  timestamp: number;
  duration?: number;
  data: AllowSharedBufferSource;
}

declare class EncodedAudioChunk {
  constructor(init: EncodedAudioChunkInit);
  readonly type: 'key' | 'delta';
  readonly timestamp: number;
  readonly duration: number | null;
  readonly byteLength: number;
  copyTo(destination: AllowSharedBufferSource): void;
}

interface AudioDecoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: AllowSharedBufferSource;
}

interface AudioDecoderInit {
  output: (data: AudioData) => void;
  error: (error: DOMException) => void;
}

declare class AudioDecoder {
  constructor(init: AudioDecoderInit);
  readonly decodeQueueSize: number;
  readonly state: 'unconfigured' | 'configured' | 'closed';
  configure(config: AudioDecoderConfig): void;
  decode(chunk: EncodedAudioChunk): void;
  flush(): Promise<void>;
  reset(): void;
  close(): void;
  static isConfigSupported(
    config: AudioDecoderConfig
  ): Promise<{ supported: boolean; config: AudioDecoderConfig }>;
}
