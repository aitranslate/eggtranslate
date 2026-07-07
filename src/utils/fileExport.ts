/**
 * 文件导出工具
 * 统一的文件下载功能，避免代码重复
 */

import { toAppError } from '@/utils/errors';
import { logger } from '@/utils/logger';

// ============================================
// 导出格式类型与映射表
// ============================================

export type ExportFormat = 'src' | 'trans' | 'src_trans' | 'trans_src' | 'package';

/** 格式 → 中文显示标签 */
export const FORMAT_LABELS: Record<ExportFormat, string> = {
  src: '原文',
  trans: '译文',
  src_trans: '双语(原上译下)',
  trans_src: '双语(原下译上)',
  package: '打包',
};

/** 文本格式 → SRT 文件名后缀（不含点） */
export const FORMAT_SUFFIXES: Record<Exclude<ExportFormat, 'package'>, string> = {
  src: '_src',
  trans: '_trans',
  src_trans: '_src_trans',
  trans_src: '_trans_src',
};

// ============================================
// 下载函数
// ============================================

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
 * 导出字幕文件（按格式自动决定后缀命名）
 *
 * 命名规则：<baseName><suffix>.<extension>
 *   - src       → _src
 *   - trans     → _trans
 *   - src_trans → _src_trans
 *   - trans_src → _trans_src
 *
 * @param content 文件内容
 * @param originalFilename 原始文件名
 * @param extension 扩展名（srt/txt）
 * @param format 导出格式枚举（后缀由 FORMAT_SUFFIXES 自动映射，调用方无需关心）
 */
export const downloadSubtitleFile = (
  content: string,
  originalFilename: string,
  extension: 'srt' | 'txt',
  format: Exclude<ExportFormat, 'package'>
): void => {
  const baseName = originalFilename.replace(/\.(srt|txt)$/i, '');
  const suffix = FORMAT_SUFFIXES[format];
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
