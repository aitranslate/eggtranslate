/**
 * AAC access unit → AudioBuffer
 *
 * 1) WebCodecs 按帧解码（若可用）
 * 2) ADTS 分块 decodeAudioData（长音频整包常被浏览器拒 / OOM）
 * 3) 短音频才尝试整包 ADTS
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

/** ~8–10s @ 44.1k / 1024 samples/frame */
const ADTS_CHUNK_FRAMES = 400;

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

function concatAudioBuffers(audioCtx: AudioContext, parts: AudioBuffer[]): AudioBuffer {
  if (parts.length === 0) throw new Error('没有可拼接的音频块');
  if (parts.length === 1) return parts[0];

  const channels = parts[0].numberOfChannels;
  const sampleRate = parts[0].sampleRate;
  let total = 0;
  for (const p of parts) {
    if (p.numberOfChannels !== channels || p.sampleRate !== sampleRate) {
      throw new Error('音频块声道/采样率不一致，无法拼接');
    }
    total += p.length;
  }

  const out = audioCtx.createBuffer(channels, total, sampleRate);
  for (let c = 0; c < channels; c++) {
    const dest = out.getChannelData(c);
    let offset = 0;
    for (const p of parts) {
      dest.set(p.getChannelData(c), offset);
      offset += p.length;
    }
  }
  return out;
}

function copyAudioDataPlane(audioData: AudioData, planeIndex: number): Float32Array {
  const attempts: AudioDataCopyToOptions[] = [
    { planeIndex, format: 'f32-planar' },
    { planeIndex, format: 'f32' },
    { planeIndex },
  ];
  let lastErr: unknown;
  for (const opts of attempts) {
    try {
      const nbytes = audioData.allocationSize(opts);
      const ab = new ArrayBuffer(nbytes);
      audioData.copyTo(ab, opts);
      const f32 = new Float32Array(ab);
      // interleaved f32: length = frames * channels — 只取该 plane 时 planar 更准
      if (opts.format === 'f32' && audioData.numberOfChannels > 1) {
        const frames = audioData.numberOfFrames;
        const ch = audioData.numberOfChannels;
        const mono = new Float32Array(frames);
        for (let i = 0; i < frames; i++) {
          mono[i] = f32[i * ch + Math.min(planeIndex, ch - 1)] ?? 0;
        }
        return mono;
      }
      return f32;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function decodeWithWebCodecs(
  payload: AacTrackPayload,
  audioCtx: AudioContext,
  onProgress?: (r: number) => void
): Promise<AudioBuffer> {
  const { frames, description, codec, sampleRate, numberOfChannels } = payload;
  if (!frames.length) throw new Error('没有 AAC 帧');

  const chN = Math.max(1, numberOfChannels);
  const channelChunks: Float32Array[][] = Array.from({ length: chN }, () => []);
  let totalFrames = 0;
  let outSampleRate = sampleRate;
  let decodeErr: Error | null = null;

  const decoder = new AudioDecoder({
    output: (audioData) => {
      try {
        outSampleRate = audioData.sampleRate || outSampleRate;
        const n = audioData.numberOfFrames;
        const srcCh = audioData.numberOfChannels;
        for (let c = 0; c < chN; c++) {
          const planeIndex = Math.min(c, srcCh - 1);
          channelChunks[c].push(copyAudioDataPlane(audioData, planeIndex));
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

  const codecStr = codec && codec.startsWith('mp4a') ? codec : 'mp4a.40.2';
  // 尝试完整 ASC 与截断到 2 字节（部分实现只认 2 字节 LC 配置）
  const descCandidates: ArrayBuffer[] = [
    description.buffer.slice(
      description.byteOffset,
      description.byteOffset + description.byteLength
    ),
  ];
  if (description.byteLength > 2) {
    descCandidates.push(
      description.buffer.slice(description.byteOffset, description.byteOffset + 2)
    );
  }

  let configured = false;
  let lastCfgErr: unknown;
  for (const desc of descCandidates) {
    try {
      const config = {
        codec: codecStr,
        sampleRate,
        numberOfChannels: chN,
        description: desc,
      };
      if (typeof AudioDecoder.isConfigSupported === 'function') {
        const support = await AudioDecoder.isConfigSupported(config);
        if (!support.supported) {
          lastCfgErr = new Error(`WebCodecs 不支持 ${codecStr}`);
          continue;
        }
      }
      decoder.configure(config);
      configured = true;
      break;
    } catch (e) {
      lastCfgErr = e;
    }
  }
  if (!configured) {
    try {
      decoder.close();
    } catch {
      /* ignore */
    }
    throw lastCfgErr instanceof Error
      ? lastCfgErr
      : new Error(`WebCodecs 配置失败: ${String(lastCfgErr)}`);
  }

  const total = frames.length;
  let ts = 0;
  const frameDurationUs = Math.round((1024 / sampleRate) * 1_000_000);

  for (let i = 0; i < total; i++) {
    if (decodeErr) break;
    await waitForDecoderQueue(decoder, 12);
    if (decodeErr) break;

    // 每帧独立拷贝，避免底层缓冲被复用
    const frame = frames[i];
    const data = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
    decoder.decode(
      new EncodedAudioChunk({
        type: 'key',
        timestamp: ts,
        duration: frameDurationUs,
        data,
      })
    );
    ts += frameDurationUs;

    if (i % 300 === 0) onProgress?.(Math.min(0.95, i / total));
  }

  try {
    await decoder.flush();
  } catch (e) {
    if (!decodeErr) decodeErr = e instanceof Error ? e : new Error(String(e));
  }
  try {
    decoder.close();
  } catch {
    /* ignore */
  }

  if (decodeErr) throw decodeErr;
  if (totalFrames <= 0) throw new Error('WebCodecs 未输出任何音频');

  const planar = channelChunks.map((parts) => {
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
  const buffer = audioCtx.createBuffer(chN, Math.max(1, length), outSampleRate);
  for (let c = 0; c < chN; c++) {
    buffer.copyToChannel(planar[c], c);
  }
  onProgress?.(1);
  logger.info(
    `[demux] WebCodecs 解码完成: ${(length / outSampleRate).toFixed(1)}s @ ${outSampleRate}Hz ch=${chN}`
  );
  return buffer;
}

function framesToAdtsBuffer(
  frames: Uint8Array[],
  adtsConfig: AacAdtsConfig
): ArrayBuffer {
  const adtsFrames = new Array<Uint8Array>(frames.length);
  for (let i = 0; i < frames.length; i++) {
    adtsFrames[i] = buildAdtsFrame(frames[i], adtsConfig);
  }
  const merged = concatUint8(adtsFrames);
  return merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength);
}

/**
 * 分块 ADTS → decodeAudioData → 拼接
 * 解决整包大 ADTS 在移动浏览器上 "Unable to decode audio data"
 */
async function decodeWithAdtsChunked(
  payload: AacTrackPayload,
  audioCtx: AudioContext,
  onProgress?: (r: number) => void
): Promise<AudioBuffer> {
  const { frames, adtsConfig } = payload;
  if (!frames.length) throw new Error('没有 AAC 帧');

  const parts: AudioBuffer[] = [];
  const total = frames.length;
  let chunkIndex = 0;
  const chunkCount = Math.ceil(total / ADTS_CHUNK_FRAMES);

  for (let start = 0; start < total; start += ADTS_CHUNK_FRAMES) {
    const slice = frames.slice(start, start + ADTS_CHUNK_FRAMES);
    const ab = framesToAdtsBuffer(slice, adtsConfig);
    try {
      const buf = await audioCtx.decodeAudioData(ab);
      parts.push(buf);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 首块就失败：配置/封装问题；中途失败：带上块号
      throw new Error(
        `ADTS 分块解码失败 (#${chunkIndex + 1}/${chunkCount}): ${msg}`
      );
    }
    chunkIndex++;
    onProgress?.(Math.min(0.99, chunkIndex / chunkCount));
  }

  const merged = concatAudioBuffers(audioCtx, parts);
  onProgress?.(1);
  logger.info(
    `[demux] ADTS 分块解码完成: ${chunkCount} 块, ${merged.duration.toFixed(1)}s`
  );
  return merged;
}

async function decodeWithAdtsFull(
  payload: AacTrackPayload,
  audioCtx: AudioContext,
  onProgress?: (r: number) => void
): Promise<AudioBuffer> {
  onProgress?.(0.3);
  const ab = framesToAdtsBuffer(payload.frames, payload.adtsConfig);
  onProgress?.(0.6);
  const audioBuffer = await audioCtx.decodeAudioData(ab);
  onProgress?.(1);
  logger.info(`[demux] ADTS 整包解码完成: ${audioBuffer.duration.toFixed(1)}s`);
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
  const errors: string[] = [];

  if (hasWebCodecsAudio()) {
    try {
      return await decodeWithWebCodecs(payload, audioCtx, onProgress);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      errors.push(`WebCodecs: ${m}`);
      logger.warn('[demux] WebCodecs 失败', e);
    }
  } else {
    errors.push('WebCodecs: 不可用');
  }

  // 长音频优先分块（整包在平板上极易 Unable to decode）
  try {
    return await decodeWithAdtsChunked(payload, audioCtx, onProgress);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    errors.push(`ADTS分块: ${m}`);
    logger.warn('[demux] ADTS 分块失败', e);
  }

  // 短音频再试整包
  if (payload.frames.length <= ADTS_CHUNK_FRAMES * 2) {
    try {
      return await decodeWithAdtsFull(payload, audioCtx, onProgress);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      errors.push(`ADTS整包: ${m}`);
    }
  }

  throw new Error(errors.join(' | '));
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
