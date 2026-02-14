/**
 * 文件导出工具
 * 统一的文件下载功能，避免代码重复
 */

import { toAppError } from '@/utils/errors';

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
    console.error('[fileExport]', appError.message, appError);
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
 * 导出JSON文件
 * @param data JSON数据
 * @param filename 文件名
 */
export const downloadJsonFile = (data: unknown, filename: string): void => {
  const content = JSON.stringify(data, null, 2);
  downloadTextFile(content, filename, 'application/json;charset=utf-8');
};
