/**
 * 字幕导出服务
 * 提供基于 taskId 的统一导出功能（SRT、TXT、双语）
 */

import JSZip from 'jszip';
import { toSRT, toTXT, toBilingual, toSrcTrans } from '@/utils/srtParser';
import type { SubtitleEntry, BatchTasks } from '@/types';
import localforage from 'localforage';

/**
 * 导出为 SRT 格式
 * @param entries 字幕条目
 * @param useTranslation 是否使用翻译文本
 * @returns SRT 格式字符串
 * @deprecated 使用 exportTaskSRT(taskId) 代替
 */
export function exportSRT(entries: SubtitleEntry[], useTranslation = true): string {
  return toSRT(entries, useTranslation);
}

/**
 * 导出为 TXT 格式
 * @param entries 字幕条目
 * @param useTranslation 是否使用翻译文本
 * @returns TXT 格式字符串
 * @deprecated 使用 exportTaskTXT(taskId) 代替
 */
export function exportTXT(entries: SubtitleEntry[], useTranslation = true): string {
  return toTXT(entries, useTranslation);
}

/**
 * 导出为双语格式
 * @param entries 字幕条目
 * @returns 双语格式字符串
 * @deprecated 使用 exportTaskBilingual(taskId) 代替
 */
export function exportBilingual(entries: SubtitleEntry[]): string {
  return toBilingual(entries);
}

/**
 * 基于 taskId 导出为 SRT 格式
 * @param taskId 任务 ID
 * @param useTranslation 是否使用翻译文本
 * @returns SRT 格式字符串
 */
export async function exportTaskSRT(taskId: string, useTranslation = true): Promise<string> {
  const batchTasks = await localforage.getItem<BatchTasks>('batch_tasks');
  const task = batchTasks?.tasks.find(t => t.taskId === taskId);
  if (!task || !task.subtitle_entries) {
    return '';
  }
  return toSRT(task.subtitle_entries, useTranslation);
}

/**
 * 基于 taskId 导出为 TXT 格式
 * @param taskId 任务 ID
 * @param useTranslation 是否使用翻译文本
 * @returns TXT 格式字符串
 */
export async function exportTaskTXT(taskId: string, useTranslation = true): Promise<string> {
  const batchTasks = await localforage.getItem<BatchTasks>('batch_tasks');
  const task = batchTasks?.tasks.find(t => t.taskId === taskId);
  if (!task || !task.subtitle_entries) {
    return '';
  }
  return toTXT(task.subtitle_entries, useTranslation);
}

/**
 * 基于 taskId 导出为双语格式
 * @param taskId 任务 ID
 * @returns 双语格式字符串
 */
export async function exportTaskBilingual(taskId: string): Promise<string> {
  const batchTasks = await localforage.getItem<BatchTasks>('batch_tasks');
  const task = batchTasks?.tasks.find(t => t.taskId === taskId);
  if (!task || !task.subtitle_entries) {
    return '';
  }
  return toBilingual(task.subtitle_entries);
}

/**
 * 计算翻译进度
 * @param entries 字幕条目
 * @returns 翻译进度统计
 */
export function getTranslationProgress(entries: SubtitleEntry[]): {
  completed: number;
  total: number;
} {
  const completed = entries.filter(entry => entry.translatedText).length;
  return { completed, total: entries.length };
}

/**
 * 基于 taskId 导出为 ZIP 压缩包
 * - 仅有转录：包含 src.srt
 * - 有翻译：包含 src.srt, trans.srt, src_trans.srt, trans_src.srt
 * @param taskId 任务 ID
 * @returns ZIP 文件的 Blob
 */
export async function exportTaskZip(taskId: string): Promise<Blob> {
  const batchTasks = await localforage.getItem<BatchTasks>('batch_tasks');
  const task = batchTasks?.tasks.find(t => t.taskId === taskId);
  if (!task || !task.subtitle_entries) {
    throw new Error('任务数据不存在');
  }

  const entries = task.subtitle_entries;
  const hasTranslation = entries.some(e => e.translatedText && e.translatedText.trim() !== '');

  const zip = new JSZip();
  zip.file('src.srt', toSRT(entries, false));

  if (hasTranslation) {
    zip.file('trans.srt', toSRT(entries, true));
    zip.file('src_trans.srt', toSrcTrans(entries));
    zip.file('trans_src.srt', toBilingual(entries));
  }

  return zip.generateAsync({ type: 'blob' });
}

/**
 * 从文件名提取基础名称（去掉扩展名）
 * @param filename 原始文件名，如 "movie.srt" 或 "video.mp4"
 * @returns 基础名称，如 "movie" 或 "video"
 */
export function getBaseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}
