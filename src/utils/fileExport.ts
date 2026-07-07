/**
 * 文件导出工具
 * 统一的文件下载功能，避免代码重复
 */

import { toAppError } from '@/utils/errors';
import { logger } from '@/utils/logger';

/**
 * 导出文本文件
 * @param content 文件内容
 * @param filename 文件名（包含扩展名）
 * @param mimeType MIME类型，默认为纯文本
 */
export const downloadTextFile = (
  content: string,
  filename: string,
  mimeType: string = 'text/plain;charset=utf-8'
): void => {
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
  } catch (error) {
    const appError = toAppError(error, '文件导出失败');
    logger.error(appError.message, appError);
    throw appError;
  }
};

/**
 * 导出字幕文件（带标准命名）
 * @param content 文件内容
 * @param originalFilename 原始文件名
 * @param extension 扩展名（srt/txt）
 * @param suffix 文件名后缀，默认为 '_translated'
 */
export const downloadSubtitleFile = (
  content: string,
  originalFilename: string,
  extension: 'srt' | 'txt',
  suffix: string = '_translated'
): void => {
  const baseName = originalFilename.replace(/\.(srt|txt)$/i, '');
  const filename = `${baseName}${suffix}.${extension}`;
  downloadTextFile(content, filename);
};

/**
 * 导出 ZIP 文件
 * @param blob ZIP 文件的 Blob 数据
 * @param filename 文件名（包含 .zip 扩展名）
 */
export const downloadZipFile = (blob: Blob, filename: string): void => {
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = filename;
    a.click();

    URL.revokeObjectURL(url);
  } catch (error) {
    const appError = toAppError(error, 'ZIP文件导出失败');
    logger.error(appError.message, appError);
    throw appError;
  }
};
