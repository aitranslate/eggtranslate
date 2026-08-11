/**
 * MP3 编码 Web Worker
 * 降采样 + lamejs 编码，不阻塞主线程 UI。
 * 支持 requestId，便于主线程复用同一 Worker 串行编码。
 */
import { Mp3Encoder } from '@breezystack/lamejs';
import {
  LAME_FRAME_SAMPLES,
  MP3_TARGET_BITRATE,
  downsampleBuffer,
} from './mp3AudioMath';

interface EncodeMessage {
  type: 'encode';
  requestId: number;
  data: Float32Array;
  sourceSampleRate: number;
  targetSampleRate: number;
}

type WorkerOut =
  | { type: 'progress'; requestId: number; progress: number }
  | { type: 'done'; requestId: number; buffer: ArrayBuffer }
  | { type: 'error'; requestId: number; message: string };

function post(msg: WorkerOut, transfer?: Transferable[]): void {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

self.onmessage = (e: MessageEvent<EncodeMessage>) => {
  if (e.data?.type !== 'encode') return;

  const { requestId, data, sourceSampleRate, targetSampleRate } = e.data;

  try {
    if (!data?.length) {
      post({ type: 'error', requestId, message: '音频数据为空' });
      return;
    }

    const downsampled = downsampleBuffer(data, sourceSampleRate, targetSampleRate);
    const encoder = new Mp3Encoder(1, targetSampleRate, MP3_TARGET_BITRATE);
    const chunks: Uint8Array[] = [];
    const total = downsampled.length;
    const progressEvery = Math.max(
      LAME_FRAME_SAMPLES * 50,
      Math.floor(total / 50) || LAME_FRAME_SAMPLES
    );

    for (let i = 0; i < total; i += LAME_FRAME_SAMPLES) {
      const slice = downsampled.subarray(i, Math.min(i + LAME_FRAME_SAMPLES, total));
      const mp3buf = encoder.encodeBuffer(slice);
      if (mp3buf.length > 0) {
        chunks.push(new Uint8Array(mp3buf));
      }
      if (i % progressEvery < LAME_FRAME_SAMPLES) {
        post({
          type: 'progress',
          requestId,
          progress: Math.min(0.99, i / total),
        });
      }
    }

    const last = encoder.flush();
    if (last.length > 0) {
      chunks.push(new Uint8Array(last));
    }

    let totalLength = 0;
    for (const c of chunks) totalLength += c.length;
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    post({ type: 'progress', requestId, progress: 1 });
    post({ type: 'done', requestId, buffer: merged.buffer }, [merged.buffer]);
  } catch (err) {
    post({
      type: 'error',
      requestId,
      message: err instanceof Error ? err.message : 'MP3 编码失败',
    });
  }
};
