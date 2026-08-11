/**
 * 浏览器原生解码 + 轻量 demux 回落 + Worker 编码
 * → 常见音视频 16 kHz 单声道 MP3
 *
 * 路径：
 * 1) decodeAudioData 直解（最快，覆盖常见音视频）
 * 2) 失败且为 MP4/M4A/MOV 等 → mp4box 只抽 AAC 音轨为 ADTS 再解
 *    （解决 AV1/H.265 等「视频轨拖累 demux」的问题，远轻于 FFmpeg）
 * 3) Worker + lamejs 编码
 *
 * 调用方：filesService.addFile。转录只消费 IndexedDB 里的结果。
 */
import { logger } from '@/utils/logger';
import { MP3_TARGET_SR, mixToMono } from '@/utils/mp3AudioMath';
import {
  extractAudioFromIsoBmff,
  shouldTryIsoBmffDemux,
} from '@/utils/mediaDemux';

export { mixToMono } from '@/utils/mp3AudioMath';

/** 直解 0–12%，demux 12–20%，编码 20–100% */
const DECODE_PROGRESS_END = 0.2;
const DEMUX_PROGRESS_START = 0.1;
const DEMUX_PROGRESS_END = 0.18;

type AudioContextCtor = typeof AudioContext;
interface AudioContextWindow {
  AudioContext?: AudioContextCtor;
  webkitAudioContext?: AudioContextCtor;
}

type WorkerProgress = { type: 'progress'; requestId: number; progress: number };
type WorkerDone = { type: 'done'; requestId: number; buffer: ArrayBuffer };
type WorkerError = { type: 'error'; requestId: number; message: string };
type WorkerMsg = WorkerProgress | WorkerDone | WorkerError;

let queue: Promise<unknown> = Promise.resolve();
let sharedWorker: Worker | null = null;
let nextRequestId = 1;

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function getAudioContextCtor(): AudioContextCtor {
  const w = window as unknown as AudioContextWindow;
  const Ctor = w.AudioContext || w.webkitAudioContext;
  if (!Ctor) {
    throw new Error('当前浏览器不支持音频解码（缺少 AudioContext）');
  }
  return Ctor;
}

function getEncoderWorker(): Worker {
  if (sharedWorker) return sharedWorker;
  sharedWorker = new Worker(new URL('./mp3Worker.ts', import.meta.url), {
    type: 'module',
  });
  sharedWorker.onerror = (err) => {
    logger.warn('[mp3] Worker 异常，下次将重建', err.message);
    try {
      sharedWorker?.terminate();
    } catch {
      /* ignore */
    }
    sharedWorker = null;
  };
  return sharedWorker;
}

/**
 * 预热：尽早加载 Worker + lamejs 模块图，避免首次导入卡在拉包。
 */
export function warmupMp3Encoder(): void {
  if (typeof window === 'undefined') return;
  try {
    getEncoderWorker();
  } catch (e) {
    logger.warn('MP3 编码器预热失败（可忽略）', e);
  }
}

/** @deprecated 兼容旧 import 名 */
export const warmupFfmpeg = warmupMp3Encoder;

function friendlyDecodeError(error: unknown, fileName: string): Error {
  const raw = error instanceof Error ? error.message : String(error);
  const name = error instanceof DOMException ? error.name : '';
  if (
    error instanceof Error &&
    /无法解码|内存不足|音频为空|暂不支持|没有音轨/.test(error.message)
  ) {
    return error;
  }
  if (
    name === 'EncodingError' ||
    name === 'NotSupportedError' ||
    /decode|encoding|notsupported|unable to decode|unable to demux/i.test(raw)
  ) {
    return new Error(
      `无法解码「${fileName}」。可先导出为 MP3/M4A/WAV，或换常见 H.264/AAC 视频后再导入。`
    );
  }
  if (/memory|out of memory|oom|allocation/i.test(raw)) {
    return new Error('文件过大，浏览器内存不足。请先导出音频或压缩后再导入。');
  }
  return error instanceof Error ? error : new Error(raw || '音视频转码失败');
}

async function decodeArrayBuffer(
  audioCtx: AudioContext,
  buffer: ArrayBuffer
): Promise<AudioBuffer> {
  // decodeAudioData 在部分浏览器会 detach 输入 buffer，传入拷贝更安全
  const copy = buffer.slice(0);
  return audioCtx.decodeAudioData(copy);
}

function encodeInWorker(
  mono: Float32Array,
  sourceSampleRate: number,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const worker = getEncoderWorker();
  const requestId = nextRequestId++;

  return new Promise<Blob>((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerMsg>) => {
      const msg = e.data;
      if (!msg || msg.requestId !== requestId) return;

      switch (msg.type) {
        case 'progress': {
          const p =
            DECODE_PROGRESS_END +
            Math.min(1, Math.max(0, msg.progress)) * (1 - DECODE_PROGRESS_END);
          onProgress?.(p);
          break;
        }
        case 'done': {
          cleanup();
          if (!msg.buffer || msg.buffer.byteLength === 0) {
            reject(new Error('编码结果为空'));
            return;
          }
          onProgress?.(1);
          resolve(new Blob([msg.buffer], { type: 'audio/mpeg' }));
          break;
        }
        case 'error': {
          cleanup();
          reject(new Error(msg.message || 'MP3 编码失败'));
          break;
        }
      }
    };

    const onError = (err: ErrorEvent) => {
      cleanup();
      try {
        sharedWorker?.terminate();
      } catch {
        /* ignore */
      }
      sharedWorker = null;
      reject(new Error(err.message || 'MP3 编码 Worker 崩溃'));
    };

    const cleanup = () => {
      worker.removeEventListener('message', onMessage as EventListener);
      worker.removeEventListener('error', onError);
    };

    worker.addEventListener('message', onMessage as EventListener);
    worker.addEventListener('error', onError);

    worker.postMessage(
      {
        type: 'encode',
        requestId,
        data: mono,
        sourceSampleRate,
        targetSampleRate: MP3_TARGET_SR,
      },
      [mono.buffer]
    );
  });
}

/**
 * 直解失败时：对 ISOBMFF 尝试只抽 AAC 再解。
 */
async function decodeWithDemuxFallback(
  audioCtx: AudioContext,
  arrayBuffer: ArrayBuffer,
  file: File,
  onProgress?: (progress: number) => void
): Promise<AudioBuffer> {
  try {
    return await decodeArrayBuffer(audioCtx, arrayBuffer);
  } catch (directErr) {
    const head = new Uint8Array(arrayBuffer, 0, Math.min(16, arrayBuffer.byteLength));
    if (!shouldTryIsoBmffDemux(file, head)) {
      throw directErr;
    }

    logger.info(
      `[mp3] 直解失败，尝试轻量 demux 抽音轨: ${file.name}`,
      directErr instanceof Error ? directErr.message : directErr
    );
    onProgress?.(DEMUX_PROGRESS_START);

    let extracted;
    try {
      extracted = await extractAudioFromIsoBmff(arrayBuffer, {
        onProgress: (r) => {
          onProgress?.(
            DEMUX_PROGRESS_START +
              Math.min(1, Math.max(0, r)) * (DEMUX_PROGRESS_END - DEMUX_PROGRESS_START)
          );
        },
      });
    } catch (demuxErr) {
      logger.warn('[mp3] demux 失败', demuxErr);
      throw directErr;
    }

    if (!extracted) {
      throw directErr;
    }

    try {
      const audioBuffer = await decodeArrayBuffer(audioCtx, extracted.buffer);
      logger.info(
        `[mp3] demux 后再解码成功 (${extracted.via}, ${extracted.codec})`
      );
      return audioBuffer;
    } catch (secondErr) {
      logger.warn('[mp3] demux 后仍无法解码', secondErr);
      throw secondErr;
    }
  }
}

/**
 * 常见音视频 → 16 kHz mono MP3 Blob。
 */
export async function convertToMP3(
  file: File,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  return enqueue(async () => {
    const AudioContextCtor = getAudioContextCtor();
    const audioCtx = new AudioContextCtor();
    const t0 =
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    try {
      onProgress?.(0.02);

      const arrayBuffer = await file.arrayBuffer();
      onProgress?.(0.08);

      const audioBuffer = await decodeWithDemuxFallback(
        audioCtx,
        arrayBuffer,
        file,
        onProgress
      );

      if (!audioBuffer.length || audioBuffer.duration <= 0) {
        throw new Error('音频为空或时长为 0，请检查文件是否含有效音轨');
      }

      onProgress?.(DECODE_PROGRESS_END);

      const mono = mixToMono(audioBuffer);
      const sourceSampleRate = audioBuffer.sampleRate;
      const durationSec = audioBuffer.duration;

      const blob = await encodeInWorker(mono, sourceSampleRate, onProgress);

      const ms =
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
        t0;
      logger.info(
        `[mp3] 完成: ${file.name} ${(file.size / 1024 / 1024).toFixed(1)}MB → ${(blob.size / 1024 / 1024).toFixed(2)}MB，${(ms / 1000).toFixed(1)}s，${durationSec.toFixed(1)}s 素材`
      );

      return blob;
    } catch (error) {
      logger.error('转码失败:', error);
      throw friendlyDecodeError(error, file.name);
    } finally {
      try {
        await audioCtx.close();
      } catch {
        /* ignore */
      }
    }
  });
}
