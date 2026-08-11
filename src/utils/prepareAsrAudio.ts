/**
 * 为 AssemblyAI 准备上传用音频（设计原则）
 *
 * 1. 能廉价压成小 MP3（浏览器原生解码 + lamejs）→ 压，上传最快
 * 2. 压不了的视频 → 只 demux 抽出 AAC 音轨（ADTS），不解码、不重编码
 * 3. 压不了的纯音频 → 原文件直传（AssemblyAI 本身支持多种音频）
 * 4. 绝不上传整段视频轨
 */
import { logger } from '@/utils/logger';
import { convertToMP3 } from '@/utils/convertToMP3';
import {
  extractAudioFromIsoBmff,
  shouldTryIsoBmffDemux,
  type AacTrackPayload,
} from '@/utils/mediaDemux';
import { buildAdtsFrame, concatUint8 } from '@/utils/mediaDemux/adts';

export type AsrAudioVia = 'mp3-reencode' | 'demux-aac' | 'original-audio';

export interface AsrAudioResult {
  blob: Blob;
  mime: string;
  fileName: string;
  via: AsrAudioVia;
}

export interface AsrAudioMeta {
  mime: string;
  fileName: string;
  via: AsrAudioVia;
}

function isLikelyAudioOnly(file: File): boolean {
  const t = (file.type || '').toLowerCase();
  const n = (file.name || '').toLowerCase();
  if (t.startsWith('video/')) return false;
  if (t.startsWith('audio/')) return true;
  return /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma|aiff|aif)$/i.test(n);
}

function isLikelyVideo(file: File): boolean {
  const t = (file.type || '').toLowerCase();
  const n = (file.name || '').toLowerCase();
  if (t.startsWith('video/')) return true;
  return /\.(mp4|mov|m4v|webm|mkv|avi|wmv|flv|ts|mpeg|mpg|3gp)$/i.test(n);
}

function aacPayloadToAdtsBlob(payload: AacTrackPayload): Blob {
  const parts = new Array<Uint8Array>(payload.frames.length);
  for (let i = 0; i < payload.frames.length; i++) {
    parts[i] = buildAdtsFrame(payload.frames[i], payload.adtsConfig);
  }
  const merged = concatUint8(parts);
  // 独立拷贝，避免底层大缓冲挂住
  const copy = merged.slice();
  return new Blob([copy], { type: 'audio/aac' });
}

/**
 * 导入阶段唯一入口：得到「给 ASR 上传」的音频 Blob（尽量小，且不含视频）。
 */
export async function prepareAsrAudio(
  file: File,
  onProgress?: (progress: number) => void
): Promise<AsrAudioResult> {
  // ① 优先：原生可解 → 统一小 MP3（体积最小、上传最快）
  try {
    onProgress?.(0.02);
    const mp3 = await convertToMP3(file, (p) => {
      // 重编码路径占满 0–1
      onProgress?.(p);
    });
    return {
      blob: mp3,
      mime: 'audio/mpeg',
      fileName: 'audio.mp3',
      via: 'mp3-reencode',
    };
  } catch (reencodeErr) {
    logger.info(
      `[asr-prepare] 跳过 MP3 重编码: ${file.name}`,
      reencodeErr instanceof Error ? reencodeErr.message : reencodeErr
    );
  }

  // ② 视频 / ISOBMFF：只抽 AAC 音轨，不解码
  onProgress?.(0.15);
  const headCap = Math.min(16, file.size);
  const headBuf = new Uint8Array(await file.slice(0, headCap).arrayBuffer());
  if (isLikelyVideo(file) || shouldTryIsoBmffDemux(file, headBuf)) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      onProgress?.(0.25);
      const extracted = await extractAudioFromIsoBmff(arrayBuffer, {
        onProgress: (r) => onProgress?.(0.25 + 0.7 * Math.min(1, Math.max(0, r))),
      });
      if (extracted?.aac?.frames?.length) {
        const blob = aacPayloadToAdtsBlob(extracted.aac);
        onProgress?.(1);
        logger.info(
          `[asr-prepare] demux AAC 直传: ${file.name} → ${(blob.size / 1024 / 1024).toFixed(2)}MB (${extracted.codec})`
        );
        return {
          blob,
          mime: 'audio/aac',
          fileName: 'audio.aac',
          via: 'demux-aac',
        };
      }
      logger.info(`[asr-prepare] demux 未得到 AAC 音轨: ${file.name}`);
    } catch (demuxErr) {
      logger.warn(
        `[asr-prepare] demux 失败: ${file.name}`,
        demuxErr instanceof Error ? demuxErr.message : demuxErr
      );
    }
  }

  // ③ 纯音频：原样直传（AssemblyAI 支持多格式）
  if (isLikelyAudioOnly(file)) {
    onProgress?.(1);
    const mime = file.type || 'application/octet-stream';
    logger.info(
      `[asr-prepare] 原音频直传: ${file.name} ${(file.size / 1024 / 1024).toFixed(2)}MB`
    );
    return {
      blob: file,
      mime,
      fileName: file.name || 'audio.bin',
      via: 'original-audio',
    };
  }

  throw new Error(
    '无法得到可上传的音频（浏览器不能转码，也抽不出 AAC 音轨）。请导出 MP3/M4A/AAC 后再导入。'
  );
}
