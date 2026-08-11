/**
 * 为 AssemblyAI 准备上传用音频（设计原则）
 *
 * 1. 小体积、浏览器能解的音频 → 压成 16k mono MP3
 * 2. 视频 / 大文件 → **禁止**整文件进内存解码；流式 demux 只抽 AAC
 * 3. 纯音频解不了 → 原文件直传（不读入 RAM）
 * 4. 绝不上传视频轨
 */
import { logger } from '@/utils/logger';
import { convertToMP3 } from '@/utils/convertToMP3';
import {
  extractAacAdtsFromIsoBmff,
  shouldTryIsoBmffDemux,
} from '@/utils/mediaDemux';

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

/** 超过此体积不再尝试浏览器 PCM 重编码（避免 arrayBuffer + decode 爆内存） */
export const MAX_REENCODE_BYTES = 64 * 1024 * 1024;

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

function shouldAttemptReencode(file: File): boolean {
  if (isLikelyVideo(file)) return false;
  if (file.size > MAX_REENCODE_BYTES) return false;
  return true;
}

/**
 * 导入阶段唯一入口：得到「给 ASR 上传」的音频 Blob（尽量小，且不含视频）。
 */
export async function prepareAsrAudio(
  file: File,
  onProgress?: (progress: number) => void
): Promise<AsrAudioResult> {
  // ① 仅对「小文件 + 非视频」尝试 MP3 重编码
  if (shouldAttemptReencode(file)) {
    try {
      onProgress?.(0.02);
      const mp3 = await convertToMP3(file, (p) => onProgress?.(p));
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
  } else {
    logger.info(
      `[asr-prepare] 跳过重编码（视频或 >${(MAX_REENCODE_BYTES / 1024 / 1024) | 0}MB）: ${file.name} ${(file.size / 1024 / 1024).toFixed(1)}MB`
    );
  }

  // ② 视频 / ISOBMFF：流式 demux AAC，绝不 file.arrayBuffer() 整包
  onProgress?.(0.05);
  const headCap = Math.min(16, file.size);
  const headBuf =
    headCap > 0
      ? new Uint8Array(await file.slice(0, headCap).arrayBuffer())
      : new Uint8Array();

  if (isLikelyVideo(file) || shouldTryIsoBmffDemux(file, headBuf)) {
    try {
      const extracted = await extractAacAdtsFromIsoBmff(file, {
        onProgress: (r) => onProgress?.(0.05 + 0.9 * Math.min(1, Math.max(0, r))),
      });
      if (extracted && extracted.blob.size > 0) {
        onProgress?.(1);
        logger.info(
          `[asr-prepare] demux AAC 直传: ${file.name} → ${(extracted.blob.size / 1024 / 1024).toFixed(2)}MB (${extracted.codec})`
        );
        return {
          blob: extracted.blob,
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

  // ③ 纯音频：原 File 直传（零拷贝引用，不读入 RAM）
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
    '无法得到可上传的音频（未抽到 AAC 音轨）。请导出 MP3/M4A/AAC 后再导入，或换含 AAC 音轨的 MP4。'
  );
}
