/**
 * MP3 转码（主线程协调 + Worker 编码）
 *
 * 主线程：AudioContext.decodeAudioData（浏览器限制必须在主线程）
 * Worker：降采样 + MP3 编码（纯计算，不阻塞 UI）
 */
import { logger } from '@/utils/logger';

type AudioContextCtor = typeof AudioContext;
interface AudioContextWindow {
  AudioContext: AudioContextCtor;
  webkitAudioContext: AudioContextCtor;
}

export async function convertToMP3(
  file: File,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const w = window as unknown as AudioContextWindow;
  const AudioContextCtor = w.AudioContext || w.webkitAudioContext;
  const audioCtx = new AudioContextCtor();

  try {
    // 1. 主线程解码（浏览器 API，无法移到 Worker）
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    // 2. 提取单声道 Float32 数据
    const rawData = audioBuffer.getChannelData(0);
    const sourceSampleRate = audioBuffer.sampleRate;
    const targetSampleRate = 16000;

    // 3. 拷贝一份给 Worker（原始 data 是共享的，不能直接 transfer）
    const dataCopy = new Float32Array(rawData);

    // 4. 创建 Worker，transfer 数据（零拷贝）
    const worker = new Worker(
      new URL('./mp3Worker.ts', import.meta.url),
      { type: 'module' }
    );

    const result = await new Promise<Blob>((resolve, reject) => {
      worker.onmessage = (e) => {
        const msg = e.data;
        switch (msg.type) {
          case 'progress':
            onProgress?.(msg.progress);
            break;
          case 'done':
            // 与转录链路统一用 audio/mpeg（audio/mp3 在部分浏览器不规范）
            resolve(new Blob([msg.buffer], { type: 'audio/mpeg' }));
            worker.terminate();
            break;
          case 'error':
            reject(new Error(msg.message));
            worker.terminate();
            break;
        }
      };

      worker.onerror = (err) => {
        reject(new Error(err.message || 'Worker 错误'));
        worker.terminate();
      };

      worker.postMessage(
        {
          type: 'encode',
          data: dataCopy,
          sourceSampleRate,
          targetSampleRate,
        },
        [dataCopy.buffer]
      );
    });

    return result;
  } catch (error) {
    logger.error('转码失败:', error);
    throw error;
  } finally {
    await audioCtx.close();
  }
}
