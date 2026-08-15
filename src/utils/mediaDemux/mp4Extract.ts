/**
 * 轻量 ISOBMFF 音轨抽取 → AAC ADTS Blob
 *
 * - 支持 File/Blob **分片流式**喂给 mp4box，禁止对大视频 file.arrayBuffer()
 * - 抽出的 AAC 帧立刻打成 ADTS 片段，不堆积完整视频、不解码 PCM
 * - keepMdatData=false，避免 1GB mdat 常驻堆
 */
import { createFile, MP4BoxBuffer, type Sample, type Track } from 'mp4box';
import { logger } from '@/utils/logger';
import { buildAdtsConfigFromAsc, buildAdtsFrame, type AacAdtsConfig } from './adts';
import { extractAudioSpecificConfig } from './esds';



/** 流式读盘块大小：2MB，平衡 IO 与峰值内存 */
const STREAM_CHUNK = 2 * 1024 * 1024;
/** 多少 AAC 帧合并成一块 ADTS，减少 Blob part 数量 */
const ADTS_BATCH_FRAMES = 128;

interface ExtractedAdtsAudio {
  blob: Blob;
  mime: 'audio/aac';
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  frameCount: number;
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

async function readBlobSlice(blob: Blob, start: number, end: number): Promise<ArrayBuffer> {
  return blob.slice(start, end).arrayBuffer();
}

/**
 * 从 File/Blob/ArrayBuffer 抽取 AAC → ADTS。
 * 大文件务必传 File/Blob，走流式路径。
 */
export async function extractAacAdtsFromIsoBmff(
  source: File | Blob | ArrayBuffer,
  options?: {
    onProgress?: (ratio: number) => void;
    /** 仅 ArrayBuffer 时可选，用于超时估算 */
    byteLengthHint?: number;
  }
): Promise<ExtractedAdtsAudio | null> {
  const totalBytes =
    source instanceof ArrayBuffer
      ? source.byteLength
      : (source as Blob).size || options?.byteLengthHint || 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (v: ExtractedAdtsAudio | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const fail = (e: unknown) => {
      if (settled) return;
      settled = true;
      reject(e instanceof Error ? e : new Error(String(e)));
    };

    // keepMdatData=false：不要把整段 mdat 留在堆上
    const mp4 = createFile(false);
    let audioTrack: Track | null = null;
    let expected = 0;
    let codec = '';
    let sampleRate = 44100;
    let channels = 2;
    let adtsConfig: AacAdtsConfig | null = null;
    let gotSamples = 0;
    let lastGotAt = Date.now();
    let streamDone = false;

    const adtsParts: BlobPart[] = [];
    let batch: Uint8Array[] = [];
    let batchBytes = 0;

    const flushBatch = () => {
      if (!batch.length) return;
      const merged = new Uint8Array(batchBytes);
      let off = 0;
      for (const b of batch) {
        merged.set(b, off);
        off += b.byteLength;
      }
      adtsParts.push(merged);
      batch = [];
      batchBytes = 0;
    };

    const buildResult = (): ExtractedAdtsAudio | null => {
      flushBatch();
      if (!adtsParts.length) return null;
      const blob = new Blob(adtsParts, { type: 'audio/aac' });
      logger.info(
        `[demux] AAC→ADTS 完成: ${gotSamples} 帧 → ${(blob.size / 1024 / 1024).toFixed(2)}MB (${codec})`
      );
      return {
        blob,
        mime: 'audio/aac',
        codec,
        sampleRate,
        numberOfChannels: channels,
        frameCount: gotSamples,
      };
    };

    const tryComplete = (force = false) => {
      if (settled) return;
      if (!force && expected > 0 && gotSamples < expected) return;
      if (!force && !streamDone && expected === 0) return;
      settle(buildResult());
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
        nbSamples: Math.max(100, Math.min(500, expected || 500)),
      });
      mp4.start();
    };

    mp4.onSamples = (_id, _user, samples: Sample[]) => {
      if (!audioTrack || settled) return;
      for (const sample of samples) {
        if (!sample.data || sample.data.byteLength === 0) continue;
        if (!adtsConfig) {
          const desc = extractAudioSpecificConfig(sample.description);
          adtsConfig = buildAdtsConfigFromAsc(
            desc || new Uint8Array([0x12, 0x10]),
            sampleRate,
            channels
          );
        }
        try {
          // 立刻封装 ADTS；不再保留 raw frame 列表
          const frame = buildAdtsFrame(sample.data, adtsConfig);
          batch.push(frame);
          batchBytes += frame.byteLength;
          if (batch.length >= ADTS_BATCH_FRAMES) flushBatch();
        } catch (e) {
          fail(e);
          return;
        }
        gotSamples++;
        lastGotAt = Date.now();
      }
      if (expected > 0) {
        options?.onProgress?.(Math.min(0.99, gotSamples / expected));
      } else if (totalBytes > 0) {
        // 无 nb_samples 时用读取进度（由外部 stream 更新更准；这里保守）
        options?.onProgress?.(Math.min(0.95, gotSamples / 100000));
      }
      if (expected > 0 && gotSamples >= expected && streamDone) {
        options?.onProgress?.(1);
        tryComplete(true);
      }
    };

    const feedDone = () => {
      streamDone = true;
      try {
        mp4.flush();
      } catch (e) {
        fail(e);
        return;
      }
      const waitStart = Date.now();
      const maxWaitMs = Math.min(180_000, Math.max(8_000, totalBytes / 100));
      const poll = () => {
        if (settled) return;
        if (expected > 0 && gotSamples >= expected) {
          options?.onProgress?.(1);
          tryComplete(true);
          return;
        }
        const idle = Date.now() - lastGotAt;
        const waited = Date.now() - waitStart;
        if (gotSamples > 0 && idle > 400) {
          options?.onProgress?.(1);
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
      queueMicrotask(poll);
    };

    const run = async () => {
      try {
        if (source instanceof ArrayBuffer) {
          const buf = MP4BoxBuffer.fromArrayBuffer(source, 0);
          mp4.appendBuffer(buf);
          options?.onProgress?.(0.5);
          feedDone();
          return;
        }

        const blob = source as Blob;
        const size = blob.size;
        let offset = 0;
        // mp4box 可能要求按 next offset 读；从 0 顺序喂即可覆盖常见 progressive/flat mp4
        while (offset < size) {
          if (settled) return;
          const end = Math.min(offset + STREAM_CHUNK, size);
          const chunk = await readBlobSlice(blob, offset, end);
          const buf = MP4BoxBuffer.fromArrayBuffer(chunk, offset);
          const next = mp4.appendBuffer(buf);
          // appendBuffer 返回下一期望文件位置；若给出更合理的 next 则跟随
          if (typeof next === 'number' && next > offset) {
            offset = next;
          } else {
            offset = end;
          }
          if (size > 0) {
            // 读盘进度最多到 0.85，余量留给抽帧
            options?.onProgress?.(Math.min(0.85, (offset / size) * 0.85));
          }
          // 让出主线程，避免长时间阻塞导致页假死
          await new Promise((r) => setTimeout(r, 0));
        }
        feedDone();
      } catch (e) {
        fail(e);
      }
    };

    void run();
  });
}

export function shouldTryIsoBmffDemux(
  file: { name?: string; type?: string },
  head?: Uint8Array
): boolean {
  return looksLikeIsoBmff(file.name || '', file.type || '', head);
}
