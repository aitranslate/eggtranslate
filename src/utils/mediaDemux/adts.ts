/**
 * AAC AudioSpecificConfig → ADTS 帧封装（轻量，无 FFmpeg）
 * 供 MP4/M4A 抽轨后交给 decodeAudioData。
 */

/** ADTS 采样率表（MPEG-4） */
export const ADTS_SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
] as const;

export interface AacAdtsConfig {
  /** MPEG-4 Audio Object Type，AAC-LC=2 */
  audioObjectType: number;
  sampleRateIndex: number;
  channelConfig: number;
}

/**
 * 从 AudioSpecificConfig（esds DecoderSpecificInfo）解析 ADTS 参数。
 * 仅读基础 2 字节字段；SBR/PS 扩展不影响 ADTS 头里的 core 配置。
 */
export function parseAudioSpecificConfig(asc: Uint8Array): AacAdtsConfig {
  if (!asc || asc.length < 2) {
    throw new Error('AudioSpecificConfig 过短');
  }
  const aot = (asc[0] >> 3) & 0x1f;
  let sampleRateIndex = ((asc[0] & 0x07) << 1) | ((asc[1] >> 7) & 0x01);
  let channelConfig: number;
  let offsetBits = 16; // 已消耗 2 字节

  // sampleRateIndex === 15 → 24-bit explicit frequency（极少见）
  if (sampleRateIndex === 0x0f) {
    if (asc.length < 5) throw new Error('AudioSpecificConfig 显式采样率不完整');
    // 跳过 24 bit frequency
    offsetBits = 16 + 24;
    const bytePos = Math.floor(offsetBits / 8);
    const bitPos = offsetBits % 8;
    // channel config 紧随其后 4 bit — 简化：从字节边界不可靠时回退
    channelConfig = (asc[bytePos] >> (4 - bitPos)) & 0x0f;
    // 对显式频率，ADTS 仍需要一个 index；用 44100 占位并由上层纠正
    sampleRateIndex = 4;
  } else {
    channelConfig = (asc[1] >> 3) & 0x0f;
  }

  // AOT=31 扩展（少见）
  let audioObjectType = aot;
  if (aot === 31) {
    if (asc.length < 3) throw new Error('扩展 AudioObjectType 不完整');
    audioObjectType = 32 + ((asc[1] & 0x07) << 3) + ((asc[2] >> 5) & 0x07);
  }

  return { audioObjectType, sampleRateIndex, channelConfig };
}

/** 按 Hz 找最近的 ADTS sampleRateIndex */
export function sampleRateToIndex(sampleRate: number): number {
  let best = 4; // 44100
  let bestDiff = Infinity;
  for (let i = 0; i < ADTS_SAMPLE_RATES.length; i++) {
    const d = Math.abs(ADTS_SAMPLE_RATES[i] - sampleRate);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

/**
 * 给一帧 raw AAC access unit 加上 7 字节 ADTS 头。
 */
export function buildAdtsFrame(
  aacFrame: Uint8Array,
  cfg: AacAdtsConfig
): Uint8Array {
  const frameLength = aacFrame.byteLength + 7;
  if (frameLength > 0x1fff) {
    throw new Error('AAC 帧过大，无法写入 ADTS');
  }

  // ADTS profile = AOT - 1（AOT 1=Main→0, 2=LC→1, 3=SSR→2, 4=LTP→3）
  const aot = Math.min(4, Math.max(1, cfg.audioObjectType));
  const profile = (aot - 1) & 0x3;
  const sfi = cfg.sampleRateIndex & 0x0f;
  const ch = cfg.channelConfig & 0x07;

  const header = new Uint8Array(7);
  // syncword 0xFFF + ID=0(MPEG-4) + layer=0 + protection_absent=1
  header[0] = 0xff;
  header[1] = 0xf1;
  header[2] =
    ((profile & 0x3) << 6) |
    ((sfi & 0x0f) << 2) |
    ((ch >> 2) & 0x1);
  header[3] = ((ch & 0x3) << 6) | ((frameLength >> 11) & 0x3);
  header[4] = (frameLength >> 3) & 0xff;
  header[5] = ((frameLength & 0x7) << 5) | 0x1f;
  header[6] = 0xfc; // buffer fullness + number_of_raw_data_blocks=0

  const out = new Uint8Array(frameLength);
  out.set(header, 0);
  out.set(aacFrame, 7);
  return out;
}

/** 合并多帧 ADTS */
export function concatUint8(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
