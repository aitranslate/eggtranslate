import { Mp3Encoder } from '@breezystack/lamejs';

export async function convertToMP3(
  file: File,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  // 1. 创建 AudioContext
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  
  try {
    // 2. 将文件转为 ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    
    // 3. 解码音频 (注意：1-2GB 的视频如果音频流也很长，这里仍然有内存风险)
    // 如果浏览器报错 "out of memory"，说明必须换成 WebCodecs 流式处理
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    // 4. 提取单声道数据
    const rawData = audioBuffer.getChannelData(0);
    const sourceSampleRate = audioBuffer.sampleRate;
    const targetSampleRate = 16000; // AssemblyAI 推荐 16k

    // 5. 降采样
    const downsampledData = downsampleBuffer(rawData, sourceSampleRate, targetSampleRate);

    // 6. 初始化编码器 (单声道, 采样率, 比特率)
    const mp3encoder = new Mp3Encoder(1, targetSampleRate, 64);
    
    const bufferSize = 1152;
    const mp3Data: Uint8Array[] = [];

    // 7. 分块编码
    for (let i = 0; i < downsampledData.length; i += bufferSize) {
      const chunk = downsampledData.subarray(i, i + bufferSize);
      const mp3buf = mp3encoder.encodeBuffer(chunk);
      if (mp3buf.length > 0) {
        mp3Data.push(new Uint8Array(mp3buf));
      }

      if (onProgress && i % (bufferSize * 100) === 0) {
        onProgress(i / downsampledData.length);
      }
      
      // 每 500 个块释放一次主线程，防止 UI 冻结
      if (i % (bufferSize * 500) === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    const lastBuf = mp3encoder.flush();
    if (lastBuf.length > 0) {
      mp3Data.push(new Uint8Array(lastBuf));
    }

    if (onProgress) onProgress(1);

    return new Blob(mp3Data, { type: 'audio/mp3' });

  } catch (error) {
    console.error('转码失败:', error);
    throw error;
  } finally {
    // 释放资源
    await audioCtx.close();
  }
}

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