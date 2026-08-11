/**
 * 为 AssemblyAI 准备上传用音频（设计原则）
 *
 * 1. 音频文件 → 原样直传（不转码；AssemblyAI 服务端自行处理）
 * 2. 视频 / ISOBMFF → 流式抽 AAC 音轨（只为省上传流量；抽不到则原文件直传）
 * 3. 抽不到音轨、且 AssemblyAI 服务端也不支持的容器 → 明确报错
 */
import { logger } from '@/utils/logger';
import {
  extractAacAdtsFromIsoBmff,
  shouldTryIsoBmffDemux,
} from '@/utils/mediaDemux';

export type AsrAudioVia = 'demux-aac' | 'original-audio';

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

/**
 * AssemblyAI 官方明确不支持的容器（除非成功抽到音轨，否则无法兜底）。
 * 对照 https://www.assemblyai.com/docs/faq/what-audio-and-video-file-types-are-supported-by-your-api
 * mp4 / mov / m4v / webm / ts / m4a / aac / mp3 / wav / flac / ogg / opus / wma / aiff 均支持。
 */
const UNSUPPORTED_CONTAINER = /\.(mkv|avi|wmv|mpeg|mpg)$/i;

/**
 * 导入阶段唯一入口：得到「给 ASR 上传」的音频 Blob。
 * 只抽音轨、绝不转码、绝不持有视频轨。
 */
export async function prepareAsrAudio(
  file: File,
  onProgress?: (progress: number) => void
): Promise<AsrAudioResult> {
  onProgress?.(0.05);
  const headCap = Math.min(16, file.size);
  const headBuf =
    headCap > 0
      ? new Uint8Array(await file.slice(0, headCap).arrayBuffer())
      : new Uint8Array();

  // ① 视频 / ISOBMFF：流式抽 AAC 音轨（省上传流量；绝不 file.arrayBuffer() 整包）
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
      logger.info(`[asr-prepare] 无 AAC 音轨可抽，改原文件直传: ${file.name}`);
    } catch (demuxErr) {
      logger.warn(
        `[asr-prepare] demux 失败，改原文件直传: ${file.name}`,
        demuxErr instanceof Error ? demuxErr.message : demuxErr
      );
    }
  }

  // ② 兜底：原文件直传（不转码；AssemblyAI 服务端自行抽音轨 / 转码）
  if (UNSUPPORTED_CONTAINER.test(file.name || '')) {
    throw new Error(
      `「${file.name}」格式（mkv/avi/wmv/mpeg/mpg）AssemblyAI 不支持，无法直接上传。请转成 MP4/MOV/WebM 或常见音频格式后再导入。`
    );
  }
  onProgress?.(1);
  const mime = file.type || 'application/octet-stream';
  logger.info(
    `[asr-prepare] 原文件直传: ${file.name} ${(file.size / 1024 / 1024).toFixed(2)}MB`
  );
  return {
    blob: file,
    mime,
    fileName: file.name || 'audio.bin',
    via: 'original-audio',
  };
}
