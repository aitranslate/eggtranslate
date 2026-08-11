/**
 * MP3 转码共用的纯音频数学（主线程 / Worker / 单测均可 import）
 */

/** 与转录链路一致：16 kHz */
export const MP3_TARGET_SR = 16000;
/** 语音识别足够：64 kbps mono */
export const MP3_TARGET_BITRATE = 64;
export const LAME_FRAME_SAMPLES = 1152;

export function convertFloat32ToInt16(buffer: Float32Array): Int16Array {
  const result = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    result[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return result;
}

/**
 * 块平均降采样：比逐点取样更抗混叠，语音清晰度更好。
 */
export function downsampleBuffer(
  buffer: Float32Array,
  srcRate: number,
  destRate: number
): Int16Array {
  if (destRate === srcRate) return convertFloat32ToInt16(buffer);
  if (destRate <= 0 || srcRate <= 0) {
    throw new Error('无效采样率');
  }

  const ratio = srcRate / destRate;
  const outLen = Math.max(1, Math.round(buffer.length / ratio));
  const result = new Int16Array(outLen);

  for (let i = 0; i < outLen; i++) {
    const start = Math.round(i * ratio);
    const end = Math.min(buffer.length, Math.round((i + 1) * ratio));
    if (start >= buffer.length) {
      result[i] = 0;
      continue;
    }
    let sum = 0;
    const hi = end > start ? end : start + 1;
    for (let j = start; j < hi && j < buffer.length; j++) {
      sum += buffer[j];
    }
    const avg = sum / Math.max(1, hi - start);
    const s = Math.max(-1, Math.min(1, avg));
    result[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return result;
}

/**
 * 多声道 → 单声道 Float32（平均混合）。
 */
export function mixToMono(audioBuffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = audioBuffer;
  if (numberOfChannels <= 1) {
    const src = audioBuffer.getChannelData(0);
    const out = new Float32Array(length);
    out.set(src);
    return out;
  }

  const out = new Float32Array(length);
  const channels: Float32Array[] = [];
  for (let c = 0; c < numberOfChannels; c++) {
    channels.push(audioBuffer.getChannelData(c));
  }
  const inv = 1 / numberOfChannels;
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (let c = 0; c < numberOfChannels; c++) {
      sum += channels[c][i];
    }
    out[i] = sum * inv;
  }
  return out;
}
