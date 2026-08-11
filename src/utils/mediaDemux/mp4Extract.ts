/**
 * 轻量 ISOBMFF（mp4/m4a/mov/…）音轨抽取。
 * 使用 mp4box.js demux，不碰视频轨、不上 FFmpeg。
 */
import { createFile, MP4BoxBuffer, type Sample, type Track } from 'mp4box';
import { logger } from '@/utils/logger';
import { buildAdtsConfigFromAsc } from './adts';
import type { AacTrackPayload } from './aacTypes';
import { extractAudioSpecificConfig } from './esds';

export { extractAudioSpecificConfig } from './esds';

export interface ExtractedAudio {
  mime: string;
  codec: string;
  via: 'aac-frames';
  /** 未解码的 AAC 帧，供 ADTS 封装后直传 ASR */
  aac?: AacTrackPayload;
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

function isAacCodec(codec: string): boolean {
  const c = (codec || '').toLowerCase();
  if (c.startsWith('mp4a.40.')) {
    if (c.slice('mp4a.40.'.length) === '34') return false;
    return true;
  }
  return c === 'aac' || c.includes('mp4a.40');
}

/**
 * 从完整 ISOBMFF 缓冲抽取 AAC 帧。
 * 完成条件：收到全部 nb_samples，或 flush 后短时内不再增长。
 */
export async function extractAudioFromIsoBmff(
  arrayBuffer: ArrayBuffer,
  options?: {
    onProgress?: (ratio: number) => void;
  }
): Promise<ExtractedAudio | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (v: ExtractedAudio | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      reject(e instanceof Error ? e : new Error(String(e)));
    };

    const mp4 = createFile(true);
    let audioTrack: Track | null = null;
    let expected = 0;
    let codec = '';
    let sampleRate = 44100;
    let channels = 2;
    let description: Uint8Array | null = null;
    const frames: Uint8Array[] = [];
    let gotSamples = 0;
    let lastGotAt = Date.now();

    const buildResult = (): ExtractedAudio | null => {
      if (!frames.length || !description) return null;
      const adtsConfig = buildAdtsConfigFromAsc(description, sampleRate, channels);
      const aac: AacTrackPayload = {
        frames,
        description,
        codec: codec || 'mp4a.40.2',
        sampleRate,
        numberOfChannels: channels,
        adtsConfig,
      };
      logger.info(
        `[demux] AAC 抽取完成: ${gotSamples} 帧, ${sampleRate}Hz / ${channels}ch (${codec})`
      );
      return {
        mime: 'audio/aac',
        codec,
        via: 'aac-frames',
        aac,
      };
    };

    const tryComplete = (force = false) => {
      if (settled) return;
      if (!force && expected > 0 && gotSamples < expected) return;
      const result = buildResult();
      settle(result);
    };

    mp4.onError = (module, message) => {
      logger.warn('[demux] mp4box', module, message);
    };

    mp4.onReady = (info) => {
      const tracks = info.audioTracks || [];
      if (!tracks.length) {
        settle(null);
        return;
      }
      audioTrack = tracks.find((t) => isAacCodec(t.codec)) || tracks[0];
      codec = audioTrack.codec || '';
      expected = audioTrack.nb_samples || 0;
      sampleRate = audioTrack.audio?.sample_rate || 44100;
      channels = audioTrack.audio?.channel_count || 2;

      if (!isAacCodec(codec)) {
        logger.info(`[demux] 音轨编码暂不支持轻量抽取: ${codec}`);
        settle(null);
        return;
      }

      mp4.setExtractionOptions(audioTrack.id, undefined, {
        nbSamples: Math.max(200, Math.min(2000, expected || 500)),
      });
      mp4.start();
    };

    mp4.onSamples = (_id, _user, samples: Sample[]) => {
      if (!audioTrack || settled) return;
      for (const sample of samples) {
        if (!sample.data || sample.data.byteLength === 0) continue;
        if (!description) {
          description = extractAudioSpecificConfig(sample.description);
          if (!description) {
            // 最小 ASC：AAC-LC + rate + ch（由 adtsConfig 回退）
            description = new Uint8Array([0x12, 0x10]);
          }
        }
        // 拷贝帧数据，避免 mp4box 复用底层缓冲
        frames.push(sample.data.slice());
        gotSamples++;
        lastGotAt = Date.now();
      }
      if (expected > 0) {
        options?.onProgress?.(Math.min(0.99, gotSamples / expected));
      }
      if (expected > 0 && gotSamples >= expected) {
        options?.onProgress?.(1);
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

    // 收齐：已满 expected，或 flush 后 200ms 无新样本
    const waitStart = Date.now();
    const maxWaitMs = Math.min(120_000, Math.max(5_000, arrayBuffer.byteLength / 50));

    const poll = () => {
      if (settled) return;
      if (expected > 0 && gotSamples >= expected) {
        tryComplete(true);
        return;
      }
      const idle = Date.now() - lastGotAt;
      const waited = Date.now() - waitStart;
      if (gotSamples > 0 && idle > 250) {
        tryComplete(true);
        return;
      }
      if (waited > maxWaitMs) {
        if (gotSamples > 0) tryComplete(true);
        else settle(null);
        return;
      }
      setTimeout(poll, 50);
    };

    queueMicrotask(() => {
      if (!settled) poll();
    });
  });
}

export function shouldTryIsoBmffDemux(
  file: { name?: string; type?: string },
  head?: Uint8Array
): boolean {
  return looksLikeIsoBmff(file.name || '', file.type || '', head);
}
