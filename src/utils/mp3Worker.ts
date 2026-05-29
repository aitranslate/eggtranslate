/**
 * MP3 编码 Web Worker
 * 在独立线程中执行降采样和 MP3 编码，避免阻塞主线程 UI
 */
import { Mp3Encoder } from '@breezystack/lamejs';

interface EncodeMessage {
  type: 'encode';
  data: Float32Array;
  sourceSampleRate: number;
  targetSampleRate: number;
}

interface WorkerProgress {
  type: 'progress';
  progress: number;
}

interface WorkerDone {
  type: 'done';
  buffer: ArrayBuffer;
}

interface WorkerError {
  type: 'error';
  message: string;
}

type WorkerOut = WorkerProgress | WorkerDone | WorkerError;

function downsampleBuffer(buffer: Float32Array, srcRate: number, destRate: number): Int16Array {
  if (destRate === srcRate) return convertFloat32ToInt16(buffer);

  const ratio = srcRate / destRate;
  const result = new Int16Array(Math.round(buffer.length / ratio));

  for (let i = 0; i < result.length; i++) {
    const start = Math.round(i * ratio);
    const end = Math.round((i + 1) * ratio);
    let sum = 0;
    for (let j = start; j < end && j < buffer.length; j++) {
      sum += buffer[j];
    }
    const avg = sum / (end - start);
    const s = Math.max(-1, Math.min(1, avg));
    result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return result;
}

function convertFloat32ToInt16(buffer: Float32Array): Int16Array {
  const result = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return result;
}

function post(msg: WorkerOut): void {
  self.postMessage(msg);
}

self.onmessage = async (e: MessageEvent<EncodeMessage>) => {
  if (e.data.type !== 'encode') return;

  const { data, sourceSampleRate, targetSampleRate } = e.data;

  try {
    // 降采样
    const downsampled = downsampleBuffer(data, sourceSampleRate, targetSampleRate);

    // MP3 编码
    const mp3encoder = new Mp3Encoder(1, targetSampleRate, 128);
    const bufferSize = 1152;
    const chunks: Uint8Array[] = [];

    for (let i = 0; i < downsampled.length; i += bufferSize) {
      const chunk = downsampled.subarray(i, i + bufferSize);
      const mp3buf = mp3encoder.encodeBuffer(chunk);
      if (mp3buf.length > 0) {
        chunks.push(new Uint8Array(mp3buf));
      }

      // 每 100 块报告一次进度
      if (i % (bufferSize * 100) === 0) {
        post({ type: 'progress', progress: i / downsampled.length });
      }
    }

    // flush
    const lastBuf = mp3encoder.flush();
    if (lastBuf.length > 0) {
      chunks.push(new Uint8Array(lastBuf));
    }

    // 合并为单个 ArrayBuffer
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    post({ type: 'progress', progress: 1 });
    post({ type: 'done', buffer: merged.buffer }, [merged.buffer]);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : 'MP3 编码失败' });
  }
};
