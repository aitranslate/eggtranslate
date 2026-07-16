/**
 * 用户体验相关纯函数（可单测，组件只负责接线）
 */

import type { FilePhases, ProgressPhase } from '@/types';
import type { ExportFormat } from '@/utils/fileExport';

// ---------- 导入 ----------

export const SUPPORTED_IMPORT_EXTS = [
  'srt',
  'mp3',
  'wav',
  'm4a',
  'ogg',
  'flac',
  'mp4',
  'webm',
  'mkv',
  'avi',
  'mov',
] as const;

/** 不支持格式时的用户文案（与 SUPPORTED_IMPORT_EXTS 对齐） */
export function unsupportedImportMessage(): string {
  return `不支持的文件格式。支持：.${SUPPORTED_IMPORT_EXTS.join(' / .')}`;
}

/** 多文件导入进度文案，如「导入中 2/5…」 */
export function formatImportProgress(current: number, total: number): string {
  const c = Math.max(0, Math.min(current, total));
  const t = Math.max(0, total);
  return `导入中 ${c}/${t}…`;
}

/** 多文件全部结束后的汇总 */
export function formatImportSummary(ok: number, fail: number): string {
  if (fail <= 0) return `已导入 ${ok} 个文件`;
  if (ok <= 0) return `${fail} 个文件导入失败`;
  return `已导入 ${ok} 个，失败 ${fail} 个`;
}

// ---------- 设置 / 离开页 ----------

/** 翻译设置有未保存草稿时，关闭需确认 */
export function shouldConfirmDiscardSettings(dirty: boolean): boolean {
  return dirty === true;
}

/**
 * 是否应拦截浏览器刷新/关页（beforeunload）
 * activeJob：任一 phase 为 active，或队列有活动任务 / 正在翻译
 */
export function shouldPromptBeforeUnload(activeJob: boolean): boolean {
  return activeJob === true;
}

/** 从 phases 判断是否有进行中阶段 */
export function hasActivePhase(phases: FilePhases | null | undefined): boolean {
  if (!phases) return false;
  return (
    phases.converting?.status === 'active' ||
    phases.transcribing?.status === 'active' ||
    phases.translating?.status === 'active'
  );
}

// ---------- 失败信息 ----------

const PHASE_ORDER: ProgressPhase[] = ['translating', 'transcribing', 'converting'];

/** 取第一个失败阶段的 errorMessage（优先翻译 → 转录 → 转码） */
export function getFailedPhaseError(
  phases: FilePhases | null | undefined
): { phase: ProgressPhase; message: string } | null {
  if (!phases) return null;
  for (const phase of PHASE_ORDER) {
    const p = phases[phase];
    if (p?.status === 'failed') {
      const msg = (p.errorMessage || '').trim();
      return { phase, message: msg || '任务失败' };
    }
  }
  return null;
}

/**
 * 是否值得在任务卡展示错误详情行。
 * 笼统的「任务失败」已由状态文案（翻译失败等）表达，再出红框只会噪音。
 */
export function shouldShowTaskErrorDetail(
  info: { message: string } | null | undefined
): boolean {
  if (!info?.message) return false;
  const m = info.message.trim();
  if (!m) return false;
  if (m === '任务失败' || m === '失败') return false;
  return true;
}

// ---------- 导出格式记忆 ----------

export const LAST_EXPORT_FORMAT_KEY = 'eggtranslate:lastExportFormat';

const VALID_EXPORT: ReadonlySet<string> = new Set([
  'src',
  'trans',
  'src_trans',
  'trans_src',
  'package',
]);

export function isExportFormat(v: unknown): v is ExportFormat {
  return typeof v === 'string' && VALID_EXPORT.has(v);
}

export function readLastExportFormat(
  storage: Pick<Storage, 'getItem'> | null | undefined = typeof localStorage !== 'undefined'
    ? localStorage
    : null,
  fallback: ExportFormat = 'trans'
): ExportFormat {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(LAST_EXPORT_FORMAT_KEY);
    if (isExportFormat(raw)) return raw;
  } catch {
    /* private mode etc. */
  }
  return fallback;
}

export function writeLastExportFormat(
  format: ExportFormat,
  storage: Pick<Storage, 'setItem'> | null | undefined = typeof localStorage !== 'undefined'
    ? localStorage
    : null
): void {
  if (!storage) return;
  try {
    storage.setItem(LAST_EXPORT_FORMAT_KEY, format);
  } catch {
    /* ignore quota */
  }
}

// ---------- 编辑器搜索 ----------

/** 过滤后的匹配条数（调用方先 filter，这里只做展示文案） */
export function formatMatchCount(count: number, hasFilter: boolean): string | null {
  if (!hasFilter) return null;
  return `${count} 条匹配`;
}

// ---------- 语言交换 ----------

export function swapLanguages(
  source: string,
  target: string
): { sourceLanguage: string; targetLanguage: string } {
  return { sourceLanguage: target, targetLanguage: source };
}
