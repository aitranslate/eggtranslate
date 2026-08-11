/**
 * 转录用音频缓存（IndexedDB）
 * - 兼容旧 key `mp3_data:*`（历史 MP3）
 * - 元数据 `asr_meta:*` 记录 mime / 文件名 / 路径
 */
import localforage from 'localforage';
import type { AsrAudioMeta, AsrAudioResult, AsrAudioVia } from '@/utils/prepareAsrAudio';

function blobKey(taskId: string): string {
  return `mp3_data:${taskId}`;
}

function metaKey(taskId: string): string {
  return `asr_meta:${taskId}`;
}

export async function saveAsrAudio(
  taskId: string,
  audio: AsrAudioResult
): Promise<void> {
  const meta: AsrAudioMeta = {
    mime: audio.mime,
    fileName: audio.fileName,
    via: audio.via,
  };
  await localforage.setItem(blobKey(taskId), audio.blob);
  await localforage.setItem(metaKey(taskId), meta);
}

export async function loadAsrAudioFile(taskId: string): Promise<File | null> {
  const blob = await localforage.getItem<Blob>(blobKey(taskId));
  if (!blob) return null;

  const meta = await localforage.getItem<AsrAudioMeta>(metaKey(taskId));
  const mime = meta?.mime || blob.type || 'audio/mpeg';
  const fileName = meta?.fileName || (mime.includes('aac') ? 'audio.aac' : 'audio.mp3');
  return new File([blob], fileName, { type: mime });
}

export async function removeAsrAudio(taskId: string): Promise<void> {
  await Promise.all([
    localforage.removeItem(blobKey(taskId)),
    localforage.removeItem(metaKey(taskId)),
  ]);
}

export function formatAsrViaLabel(via?: AsrAudioVia): string {
  switch (via) {
    case 'mp3-reencode':
      return '已压缩为 MP3';
    case 'demux-aac':
      return '已抽取 AAC 音轨';
    case 'original-audio':
      return '原音频直传';
    default:
      return '音频已就绪';
  }
}
