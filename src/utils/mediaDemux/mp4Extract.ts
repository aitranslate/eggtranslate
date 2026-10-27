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

interface TopLevelBox {
  type: string;
  start: number;
  size: number;
}

/**
 * 扫顶层 box（只读每个 box 的 8/16 字节头，数据靠 seek 跳过）。
 *
 * 需要它是因为 **moov 可能在文件末尾**（非 faststart 的 mp4，例如大多数
 * 录屏 / 下载的视频）。mp4box 不开 keepMdatData 时，moov 之前的样本会被直接
 * 丢掉，于是顺序读完整份文件一个样本都抽不到——先扫出 moov 的位置，把它先喂进去，
 * 再按顺序喂 mdat，才能正常抽帧，而且不必把整段 mdat 留在堆上。
 */
export async function scanTopLevelBoxes(blob: Blob, limit = 64): Promise<TopLevelBox[]> {
  const boxes: TopLevelBox[] = [];
  let pos = 0;
  for (let i = 0; i < limit && pos + 8 <= blob.size; i += 1) {
    const head = new DataView(await readBlobSlice(blob, pos, Math.min(pos + 16, blob.size)));
    if (head.byteLength < 8) break;
    let size = head.getUint32(0);
    const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
    let header = 8;
    if (size === 1 && head.byteLength >= 16) {
      header = 16;
      size = Number(head.getBigUint64(8));
    } else if (size === 0) {
      size = blob.size - pos;
    }
    if (!Number.isFinite(size) || size < header || pos + size > blob.size) break;
    boxes.push({ type, start: pos, size });
    pos += size;
  }
  return boxes;
}

/**
 * 从 File/Blob/ArrayBuffer 抽取 AAC → ADTS。
 * 大文件务必传 File/Blob，走流式路径。
 */
/** 抽取的三个阶段：读盘 → 抽帧 → 收尾（flush 后等 mp4box 吐最后一批） */
export type DemuxPhase = 'read' | 'extract' | 'finalize';

export async function extractAacAdtsFromIsoBmff(
  source: File | Blob | ArrayBuffer,
  options?: {
    /**
     * 进度回调。ratio 单调不减，phase 说明当前在干什么：
     * 读盘占 0-0.45，抽帧占 0.45-0.95，收尾 0.99，完成 1。
     */
    onProgress?: (ratio: number, phase: DemuxPhase) => void;
    /** 仅 ArrayBuffer 时可选，用于超时估算 */
    byteLengthHint?: number;
  }
): Promise<ExtractedAdtsAudio | null> {
  const totalBytes =
    source instanceof ArrayBuffer
      ? source.byteLength
      : (source as Blob).size || options?.byteLengthHint || 0;

  // 进度必须是单调的：读盘和抽帧两路回调交替触发，回退会让用户看到百分比倒退
  let lastRatio = 0;
  const emit = (ratio: number, phase: DemuxPhase) => {
    const next = Math.min(1, Math.max(lastRatio, ratio));
    lastRatio = next;
    options?.onProgress?.(next, phase);
  };

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
        emit(0.45 + 0.5 * Math.min(1, gotSamples / expected), 'extract');
      } else {
        // 没有 nb_samples：按已抽帧数保守估，读盘阶段已经占住 0-0.45
        emit(0.45 + 0.5 * Math.min(1, gotSamples / 100_000), 'extract');
      }
      if (expected > 0 && gotSamples >= expected && streamDone) {
        emit(1, 'finalize');
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
      // 文件读完了，但 mp4box 还扣着最后一批样本：别再涨数字，切成「整理音频」
      emit(0.99, 'finalize');
      const waitStart = Date.now();
      // 有样本进来时给足缓冲；一个样本都没有说明这份容器抽不出来，立刻放弃，
      // 交给 prepareAsrAudio 走"原文件直传"（原来这里会干等 180 s）。
      const maxWaitMs = Math.min(180_000, Math.max(8_000, totalBytes / 100));
      const noSampleWaitMs = 1_500;
      const poll = () => {
        if (settled) return;
        if (expected > 0 && gotSamples >= expected) {
          emit(1, 'finalize');
          tryComplete(true);
          return;
        }
        const idle = Date.now() - lastGotAt;
        const waited = Date.now() - waitStart;
        if (gotSamples > 0 && idle > 400) {
          emit(1, 'finalize');
          tryComplete(true);
          return;
        }
        if (gotSamples === 0 && waited > noSampleWaitMs) {
          settle(null);
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
          emit(0.45, 'extract');
          feedDone();
          return;
        }

        const blob = source as Blob;
        const size = blob.size;
        const boxes = await scanTopLevelBoxes(blob);
        const moov = boxes.find((b) => b.type === 'moov');
        if (moov) {
          // 索引先到，后面 mdat 里的样本才会被 mp4box 收下
          const ftyp = boxes.find((b) => b.type === 'ftyp');
          if (ftyp) {
            const head = await readBlobSlice(blob, ftyp.start, ftyp.start + ftyp.size);
            mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(head, ftyp.start));
          }
          const index = await readBlobSlice(blob, moov.start, moov.start + moov.size);
          mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(index, moov.start));
        }

        let offset = 0;
        while (offset < size) {
          if (settled) return;
          if (moov && offset >= moov.start && offset < moov.start + moov.size) {
            offset = moov.start + moov.size;
            continue;
          }
          let end = Math.min(offset + STREAM_CHUNK, size);
          if (moov && offset < moov.start && end > moov.start) end = moov.start;
          const chunk = await readBlobSlice(blob, offset, end);
          const buf = MP4BoxBuffer.fromArrayBuffer(chunk, offset);
          const next = mp4.appendBuffer(buf);
          // appendBuffer 返回下一期望文件位置；若给出更合理的 next 则跟随
          if (typeof next === 'number' && next > offset && next <= size) {
            offset = next;
          } else {
            offset = end;
          }
          if (size > 0) {
            // 读盘只占前 45%，后面的进度留给真正耗时的抽帧
            emit(0.45 * Math.min(1, offset / size), 'read');
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
