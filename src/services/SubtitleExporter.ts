/**
 * 字幕导出服务
 * 支持单格式 SRT 下载、全格式 ZIP 打包（含前缀命名）、批量导出
 */

import JSZip from 'jszip';
import { toSRT, toBilingual, toSrcTrans } from '@/utils/srtParser';
import type { SubtitleEntry, SingleTask } from '@/types';
import { useFilesStore } from '@/stores/filesStore';
import {
  downloadSubtitleFile,
  downloadZipFile,
  type ExportFormat,
  FORMAT_LABELS,
  FORMAT_SUFFIXES,
} from '@/utils/fileExport';
import { logger } from '@/utils/logger';

// 类型与映射表从 fileExport 统一导入并 re-export，方便调用方按需取用
export type { ExportFormat };
export { FORMAT_LABELS, FORMAT_SUFFIXES };

// ============================================
// 单文件单格式：entries → SRT 文本字符串
// ============================================

/**
 * 按指定格式将字幕条目序列化为 SRT 文本
 * @returns SRT 格式文本字符串
 */
export function exportEntries(
  entries: SubtitleEntry[],
  format: Exclude<ExportFormat, 'package'>
): string {
  switch (format) {
    case 'src':
      return toSRT(entries, false);
    case 'trans':
      return toSRT(entries, true);
    case 'src_trans':
      return toSrcTrans(entries); // 原文在上，译文在下
    case 'trans_src':
      return toBilingual(entries); // 译文在上，原文在下
  }
}

// ============================================
// ZIP 辅助：基于 entries 纯函数（不依赖 filesStore）
// ============================================

/**
 * 将一组 entries 的 4 种格式 SRT 写入 ZIP（带源文件名前缀）
 *
 * ZIP 内部结构：
 *   <base>_src.srt       原文
 *   <base>_trans.srt     译文
 *   <base>_src_trans.srt 双语(原上译下)
 *   <base>_trans_src.srt 双语(原下译上)
 *
 * 若无译文则仅写入 <base>_src.srt
 */
function addEntriesToZip(zip: JSZip, entries: SubtitleEntry[], baseName: string): void {
  if (!entries || entries.length === 0) return;

  const hasTranslation = entries.some(e => e.translatedText && e.translatedText.trim() !== '');

  zip.file(`${baseName}_src.srt`, toSRT(entries, false));

  if (hasTranslation) {
    zip.file(`${baseName}_trans.srt`, toSRT(entries, true));
    zip.file(`${baseName}_src_trans.srt`, toSrcTrans(entries));
    zip.file(`${baseName}_trans_src.srt`, toBilingual(entries));
  }
}

/**
 * 基于 entries 直接生成全格式 ZIP（纯函数，不依赖 filesStore）
 *
 * 适用于历史记录等 task 可能已不在文件列表的场景。
 */
export async function buildEntriesZip(entries: SubtitleEntry[], baseName: string): Promise<Blob> {
  const zip = new JSZip();
  addEntriesToZip(zip, entries, baseName);
  return zip.generateAsync({ type: 'blob' });
}

// ============================================
// 单文件导出函数（基于 taskId，依赖 filesStore）
// ============================================

/**
 * 单文件全格式 ZIP（package 模式）—— 带前缀命名
 * 从 filesStore 取 task 数据。
 */
export async function exportTaskZip(taskId: string): Promise<Blob> {
  const task = useFilesStore.getState().tasks.find((t) => t.taskId === taskId);
  if (!task || !task.subtitle_entries) throw new Error('任务数据不存在');

  const baseName = getBaseName(task.subtitle_filename || `task_${task.taskId}`);
  return buildEntriesZip(task.subtitle_entries, baseName);
}

/**
 * 执行单文件导出（根据 format 分发到不同路径）
 * - package → 调用 exportTaskZip + downloadZipFile
 * - 其他   → exportEntries + downloadSubtitleFile
 */
export async function exportFile(taskId: string, fileName: string, format: ExportFormat): Promise<void> {
  if (format === 'package') {
    const blob = await exportTaskZip(taskId);
    downloadZipFile(blob, `${getBaseName(fileName)}.zip`);
    return;
  }

  // 文本格式：直接下载单个 SRT
  const task = useFilesStore.getState().tasks.find((t) => t.taskId === taskId);
  if (!task || !task.subtitle_entries) throw new Error('任务数据不存在');

  const content = exportEntries(task.subtitle_entries, format);
  downloadSubtitleFile(content, fileName, 'srt', format);
}

// ============================================
// 批量导出函数
// ============================================

/**
 * 批量打包所有已完成文件的 4 种格式到一个总 ZIP
 * 每个 task 用其源文件名作为前缀区分
 */
export async function exportAllPackage(taskIds: string[]): Promise<Blob> {
  const tasks = taskIds
    .map((id) => useFilesStore.getState().tasks.find((t) => t.taskId === id))
    .filter((t): t is SingleTask => Boolean(t));

  if (tasks.length === 0) throw new Error('没有可导出的任务');

  const zip = new JSZip();
  for (const task of tasks) {
    const baseName = getBaseName(task.subtitle_filename || `task_${task.taskId}`);
    addEntriesToZip(zip, task.subtitle_entries, baseName);
  }

  return zip.generateAsync({ type: 'blob' });
}

/**
 * 批量逐个下载（每个文件一个 SRT，浏览器多文件下载弹窗）
 * 无译文的文件自动跳过并记录跳过数量
 *
 * @returns skippedCount 被跳过的文件数
 */
export async function exportAllFormat(taskIds: string[], format: Exclude<ExportFormat, 'package'>): Promise<number> {
  let skippedCount = 0;

  for (const id of taskIds) {
    const task = useFilesStore.getState().tasks.find((t) => t.taskId === id);
    if (!task || !task.subtitle_entries) continue;

    // 需要译文的格式（trans / src_trans / trans_src）：检查是否有翻译内容
    const needsTranslation = format !== 'src';
    const hasTranslation = task.subtitle_entries.some(e => e.translatedText && e.translatedText.trim() !== '');

    if (needsTranslation && !hasTranslation) {
      skippedCount++;
      logger.warn(`[批量导出] 跳过未翻译文件: ${task.subtitle_filename} (${format})`);
      continue;
    }

    try {
      const content = exportEntries(task.subtitle_entries, format);
      const fileName = task.subtitle_filename || `file_${id}`;
      downloadSubtitleFile(content, fileName, 'srt', format);
    } catch (error) {
      logger.error(`[批量导出] 文件 ${task.subtitle_filename} 导出失败:`, error);
    }
  }

  return skippedCount;
}

// ============================================
// 工具函数
// ============================================

/**
 * 从文件名提取基础名称（去掉扩展名）
 * @param filename 如 "movie.srt" 或 "video.mp4"
 * @returns 如 "movie" 或 "video"
 */
export function getBaseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}
