/**
 * 将用户上传的音视频文件转换为 WAV 格式 Blob
 * @param file - 用户上传的文件 (mp4, avi, mp3, m4a等)
 * @returns 转换后的 wav 文件
 */
export async function convertToWav(file: File): Promise<Blob> {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // 1. 解码音视频文件 (浏览器原生支持从视频中提取音频流)
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  // 2. 将多声道转为单声道 (ASR 通常只需要单声道，且能减小一倍体积)
  const pcmData = audioBuffer.getChannelData(0); // 获取左声道数据
  const sampleRate = audioBuffer.sampleRate;

  // 3. 封装 WAV 头并返回 Blob
  const wavBuffer = encodeWAV(pcmData, sampleRate);
  audioCtx.close();

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

/**
 * 辅助函数：为原始 PCM 数据添加 WAV 头部 (约44字节)
 */
function encodeWAV(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* file length */
  view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, 1, true);
  /* channel count */
  view.setUint16(22, 1, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * 2, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);

  // 写入 PCM 采样数据
  const offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return buffer;
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
