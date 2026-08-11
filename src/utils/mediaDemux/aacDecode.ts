/**
 * AAC access unit → AudioBuffer
 * 优先 WebCodecs（长文件更稳），回落 ADTS + decodeAudioData
 */
import { logger } from '@/utils/logger';
import {
  buildAdtsFrame,
  concatUint8,
  parseAudioSpecificConfig,
  sampleRateToIndex,
  type AacAdtsConfig,
} from './adts';

export interface AacTrackPayload {
  frames: Uint8Array[];
  /** DecoderSpecificInfo / AudioSpecificConfig */
  description: Uint8Array;
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  adtsConfig: AacAdtsConfig;
}

function hasWebCodecsAudio(): boolean {
  return typeof AudioDecoder !== 'undefined' && typeof EncodedAudioChunk !== 'undefined';
}

function waitForDecoderQueue(decoder: AudioDecoder, maxSize: number): Promise<void> {
  if (decoder.decodeQueueSize <= maxSize) return Promise.resolve();
  return new Promise((resolve) => {
    const tick = () => {
      if (decoder.decodeQueueSize <= maxSize) resolve();
      else setTimeout(tick, 8);
    };
    tick();
  });
}

/**
 * WebCodecs 按帧解码 AAC → AudioBuffer
 */
async function decodeWithWebCodecs(
  payload: AacTrackPayload,
  audioCtx: AudioContext,
  onProgress?: (r: number) => void
): Promise<AudioBuffer> {
  const { frames, description, codec, sampleRate, numberOfChannels } = payload;
  if (!frames.length) throw new Error('没有 AAC 帧');

  const channelChunks: Float32Array[][] = Array.from(
    { length: Math.max(1, numberOfChannels) },
    () => []
  );
  let totalFrames = 0;
  let outSampleRate = sampleRate;
  let decodeErr: Error | null = null;

  const decoder = new AudioDecoder({
    output: (audioData) => {
      try {
        outSampleRate = audioData.sampleRate || outSampleRate;
        const n = audioData.numberOfFrames;
        const chCount = audioData.numberOfChannels;
        for (let c = 0; c < channelChunks.length; c++) {
          const planeIndex = Math.min(c, chCount - 1);
          const opts: AudioDataCopyToOptions = {
            planeIndex,
            format: 'f32-planar',
          };
          const nbytes = audioData.allocationSize(opts);
          const ab = new ArrayBuffer(nbytes);
          audioData.copyTo(ab, opts);
          channelChunks[c].push(new Float32Array(ab));
        }
        totalFrames += n;
      } catch (e) {
        decodeErr = e instanceof Error ? e : new Error(String(e));
      } finally {
        audioData.close();
      }
    },
    error: (e) => {
      decodeErr = e instanceof Error ? e : new Error(String(e));
    },
  });

  const descCopy = description.buffer.slice(
    description.byteOffset,
    description.byteOffset + description.byteLength
  );

  const codecStr = codec && codec.startsWith('mp4a') ? codec : 'mp4a.40.2';
  decoder.configure({
    codec: codecStr,
    sampleRate,
    numberOfChannels: Math.max(1, numberOfChannels),
    description: descCopy,
  });

  const total = frames.length;
  let ts = 0;
  const frameDurationUs = Math.round((1024 / sampleRate) * 1_000_000);

  for (let i = 0; i < total; i++) {
    if (decodeErr) break;
    await waitForDecoderQueue(decoder, 12);
    if (decodeErr) break;

    decoder.decode(
      new EncodedAudioChunk({
        type: 'key',
        timestamp: ts,
        duration: frameDurationUs,
        data: frames[i],
      })
    );
    ts += frameDurationUs;

    if (i % 300 === 0) onProgress?.(Math.min(0.95, i / total));
  }

  await decoder.flush();
  try {
    decoder.close();
  } catch {
    /* ignore */
  }

  if (decodeErr) throw decodeErr;
  if (totalFrames <= 0) throw new Error('WebCodecs 未输出任何音频');

  const planar: Float32Array[] = channelChunks.map((parts) => {
    let len = 0;
    for (const p of parts) len += p.length;
    const merged = new Float32Array(len);
    let off = 0;
    for (const p of parts) {
      merged.set(p, off);
      off += p.length;
    }
    return merged;
  });

  const length = planar[0]?.length ?? 0;
  const ch = planar.length;
  const buffer = audioCtx.createBuffer(ch, Math.max(1, length), outSampleRate);
  for (let c = 0; c < ch; c++) {
    buffer.copyToChannel(planar[c], c);
  }
  onProgress?.(1);
  logger.info(
    `[demux] WebCodecs 解码完成: ${(length / outSampleRate).toFixed(1)}s @ ${outSampleRate}Hz ch=${ch}`
  );
  return buffer;
}

/**
 * ADTS 拼流 + decodeAudioData
 */
async function decodeWithAdts(
  payload: AacTrackPayload,
  audioCtx: AudioContext,
  onProgress?: (r: number) => void
): Promise<AudioBuffer> {
  onProgress?.(0.15);
  const adtsFrames: Uint8Array[] = new Array(payload.frames.length);
  for (let i = 0; i < payload.frames.length; i++) {
    adtsFrames[i] = buildAdtsFrame(payload.frames[i], payload.adtsConfig);
    if (i % 500 === 0) onProgress?.(0.15 + (0.5 * i) / payload.frames.length);
  }
  onProgress?.(0.7);
  const merged = concatUint8(adtsFrames);
  const copy = merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength);
  const audioBuffer = await audioCtx.decodeAudioData(copy);
  onProgress?.(1);
  logger.info(`[demux] ADTS+decodeAudioData 完成: ${audioBuffer.duration.toFixed(1)}s`);
  return audioBuffer;
}

/**
 * 将抽取的 AAC 解码为 AudioBuffer。
 */
export async function decodeAacPayload(
  payload: AacTrackPayload,
  audioCtx: AudioContext,
  onProgress?: (r: number) => void
): Promise<AudioBuffer> {
  if (hasWebCodecsAudio()) {
    try {
      return await decodeWithWebCodecs(payload, audioCtx, onProgress);
    } catch (e) {
      logger.warn('[demux] WebCodecs 失败，回落 ADTS', e);
    }
  }
  return decodeWithAdts(payload, audioCtx, onProgress);
}

export function buildAdtsConfigFromAsc(
  asc: Uint8Array,
  fallbackRate: number,
  fallbackCh: number
): AacAdtsConfig {
  try {
    if (asc.byteLength >= 2) return parseAudioSpecificConfig(asc);
  } catch {
    /* fallthrough */
  }
  return {
    audioObjectType: 2,
    sampleRateIndex: sampleRateToIndex(fallbackRate),
    channelConfig: Math.min(7, Math.max(1, fallbackCh)),
  };
}
