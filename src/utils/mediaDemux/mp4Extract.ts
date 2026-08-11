/**
 * 轻量 ISOBMFF（mp4/m4a/mov/…）音轨抽取 → 可 decodeAudioData 的缓冲。
 * 使用 mp4box.js demux，不碰视频轨、不上 FFmpeg。
 */
import { createFile, MP4BoxBuffer, type Sample, type Track } from 'mp4box';
import { logger } from '@/utils/logger';
import {
  buildAdtsFrame,
  concatUint8,
  parseAudioSpecificConfig,
  sampleRateToIndex,
  type AacAdtsConfig,
} from './adts';

export interface ExtractedAudio {
  buffer: ArrayBuffer;
  mime: string;
  codec: string;
  via: 'aac-adts';
}

function looksLikeIsoBmff(name: string, type: string, magic?: Uint8Array): boolean {
  const n = (name || '').toLowerCase();
  const t = (type || '').toLowerCase();
  if (
    t.includes('mp4') ||
    t.includes('m4a') ||
    t.includes('quicktime') ||
    t === 'audio/x-m4a' ||
    t === 'video/x-m4v'
  ) {
    return true;
  }
  if (/\.(mp4|m4a|m4v|mov|3gp|3g2|f4v|ismv|isma)$/i.test(n)) return true;
  if (magic && magic.byteLength >= 12) {
    const tag = String.fromCharCode(magic[4], magic[5], magic[6], magic[7]);
    if (tag === 'ftyp') return true;
  }
  return false;
}

/** 从 mp4a sample description / esds 取出 DecoderSpecificInfo（AudioSpecificConfig） */
export function extractAudioSpecificConfig(description: unknown): Uint8Array | null {
  if (!description || typeof description !== 'object') return null;
  const desc = description as {
    esds?: {
      esd?: {
        descs?: Array<{
          tag?: number;
          data?: Uint8Array;
          descs?: Array<{ tag?: number; data?: Uint8Array; descs?: unknown[] }>;
        }>;
      };
      data?: Uint8Array;
    };
  };

  const walk = (nodes: unknown): Uint8Array | null => {
    if (!Array.isArray(nodes)) return null;
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const n = node as {
        tag?: number;
        data?: Uint8Array;
        descs?: unknown[];
      };
      if (n.tag === 5 && n.data && n.data.byteLength > 0) {
        return n.data instanceof Uint8Array ? n.data : new Uint8Array(n.data as ArrayBuffer);
      }
      const nested = walk(n.descs);
      if (nested) return nested;
    }
    return null;
  };

  if (desc.esds?.esd?.descs) {
    const fromTree = walk(desc.esds.esd.descs);
    if (fromTree) return fromTree;
  }

  const raw = desc.esds?.data;
  if (raw && raw.byteLength > 4) {
    for (let i = 0; i < raw.byteLength - 2; i++) {
      if (raw[i] !== 0x05) continue;
      let j = i + 1;
      while (j < raw.byteLength && raw[j] === 0x80) j++;
      if (j >= raw.byteLength) break;
      const len = raw[j];
      const start = j + 1;
      if (len > 0 && start + len <= raw.byteLength) {
        return raw.subarray(start, start + len);
      }
    }
  }
  return null;
}

function isAacCodec(codec: string): boolean {
  const c = (codec || '').toLowerCase();
  if (c.startsWith('mp4a.40.')) {
    const ot = c.slice('mp4a.40.'.length);
    if (ot === '34') return false; // MP3-in-MP4
    return true;
  }
  return c === 'aac' || c.includes('mp4a.40');
}

function resolveAdtsConfig(track: Track, description: unknown): AacAdtsConfig {
  const asc = extractAudioSpecificConfig(description);
  if (asc && asc.byteLength >= 2) {
    try {
      const cfg = parseAudioSpecificConfig(asc);
      if (cfg.sampleRateIndex > 12 && track.audio?.sample_rate) {
        cfg.sampleRateIndex = sampleRateToIndex(track.audio.sample_rate);
      }
      if ((!cfg.channelConfig || cfg.channelConfig > 7) && track.audio?.channel_count) {
        cfg.channelConfig = Math.min(7, track.audio.channel_count);
      }
      return cfg;
    } catch (e) {
      logger.warn('[demux] 解析 AudioSpecificConfig 失败，回退 track 元数据', e);
    }
  }

  const rate = track.audio?.sample_rate || 44100;
  const ch = track.audio?.channel_count || 2;
  let aot = 2;
  const m = /^mp4a\.40\.(\d+)$/i.exec(track.codec || '');
  if (m) {
    const n = parseInt(m[1], 10) || 2;
    // SBR/PS 的 ADTS core 仍用 AAC-LC
    aot = n === 5 || n === 29 ? 2 : Math.min(4, Math.max(1, n));
  }

  return {
    audioObjectType: aot,
    sampleRateIndex: sampleRateToIndex(rate),
    channelConfig: Math.min(7, Math.max(1, ch)),
  };
}

/**
 * 从完整 ISOBMFF 缓冲抽取 AAC 音轨 → ADTS。
 */
export async function extractAudioFromIsoBmff(
  arrayBuffer: ArrayBuffer,
  options?: {
    onProgress?: (ratio: number) => void;
  }
): Promise<ExtractedAudio | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (value: ExtractedAudio | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const mp4 = createFile(true);
    let audioTrack: Track | null = null;
    let adtsCfg: AacAdtsConfig | null = null;
    const frames: Uint8Array[] = [];
    let gotSamples = 0;
    let expected = 0;
    let codec = '';

    const tryComplete = (force = false) => {
      if (settled) return;
      if (!force && expected > 0 && gotSamples < expected) return;
      if (!frames.length) {
        settle(null);
        return;
      }
      try {
        options?.onProgress?.(1);
        const merged = concatUint8(frames);
        const copy = merged.buffer.slice(
          merged.byteOffset,
          merged.byteOffset + merged.byteLength
        );
        logger.info(
          `[demux] AAC 抽取完成: ${gotSamples} 帧 → ${(copy.byteLength / 1024 / 1024).toFixed(2)}MB ADTS (${codec})`
        );
        settle({
          buffer: copy,
          mime: 'audio/aac',
          codec,
          via: 'aac-adts',
        });
      } catch (e) {
        fail(e);
      }
    };

    mp4.onError = (module, message) => {
      logger.warn('[demux] mp4box', module, message);
    };

    mp4.onReady = (info) => {
      const tracks = info.audioTracks || [];
      if (tracks.length === 0) {
        settle(null);
        return;
      }
      audioTrack = tracks.find((t) => isAacCodec(t.codec)) || tracks[0];
      codec = audioTrack.codec || '';
      expected = audioTrack.nb_samples || 0;

      if (!isAacCodec(codec)) {
        logger.info(`[demux] 音轨编码暂不支持轻量抽取: ${codec}`);
        settle(null);
        return;
      }

      // 大批次减少回调次数；mp4box 会按轨道实际样本吐出
      mp4.setExtractionOptions(audioTrack.id, undefined, {
        nbSamples: Math.max(100, Math.min(1000, expected || 1000)),
      });
      mp4.start();
    };

    mp4.onSamples = (_id, _user, samples: Sample[]) => {
      if (!audioTrack || settled) return;
      for (const sample of samples) {
        if (!sample.data || sample.data.byteLength === 0) continue;
        if (!adtsCfg) {
          adtsCfg = resolveAdtsConfig(audioTrack, sample.description);
        }
        try {
          frames.push(buildAdtsFrame(sample.data, adtsCfg));
        } catch (e) {
          fail(e);
          return;
        }
        gotSamples++;
      }
      if (expected > 0) {
        options?.onProgress?.(Math.min(0.99, gotSamples / expected));
      }
      if (expected > 0 && gotSamples >= expected) {
        tryComplete(true);
      }
    };

    try {
      const buf = MP4BoxBuffer.fromArrayBuffer(arrayBuffer, 0);
      mp4.appendBuffer(buf);
      mp4.flush();
    } catch (e) {
      fail(e);
      return;
    }

    // flush 同步路径上可能已收齐；否则短暂等待尾包
    queueMicrotask(() => {
      if (settled) return;
      if (frames.length && (expected === 0 || gotSamples >= expected)) {
        tryComplete(true);
        return;
      }
      setTimeout(() => {
        if (!settled) tryComplete(true);
      }, 50);
    });
  });
}

export function shouldTryIsoBmffDemux(
  file: { name?: string; type?: string },
  head?: Uint8Array
): boolean {
  return looksLikeIsoBmff(file.name || '', file.type || '', head);
}
