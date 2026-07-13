import SRTParser2 from 'srt-parser-2';
import { SubtitleEntry } from '@/types';
import { toAppError } from '@/utils/errors';
import { logger } from '@/utils/logger';

// SRTParser2 返回的类型接口
interface SRTParserResult {
  id?: string | number;
  startTime: string;
  endTime: string;
  text: string;
}

// SRTParser2.toSrt 输入接口
interface SRTParserInput {
  id: string;
  startTime: string;
  endTime: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
}

const parser = new SRTParser2();

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g;
const LAT_RE = /[A-Za-z\u00C0-\u024F]/g;

function scriptScore(s: string): { cjk: number; lat: number; isCjk: boolean; isLat: boolean } {
  const cjk = (s.match(CJK_RE) || []).length;
  const lat = (s.match(LAT_RE) || []).length;
  return {
    cjk,
    lat,
    isCjk: cjk >= 1 && cjk >= lat,
    isLat: lat >= 2 && lat > cjk,
  };
}

/**
 * 仅用于展示：把双语正文拆成视觉行（不改动存储数据）。
 * - 已有换行 → 按行
 * - 同行中英粘连 → 视觉上分成两行
 * - 普通单语 → 单行
 */
export function getBilingualDisplayLines(raw: string): string[] {
  const trimmed = (raw || '').replace(/\r\n/g, '\n').trim();
  if (!trimmed) return [];

  const explicit = trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (explicit.length >= 2) return explicit;

  // 中文… + 英文…
  const cjkThenLat = trimmed.match(
    /^(.*?[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff][\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\s\d，。！？、；：""''（）…·-]*)\s+([A-Za-z\u00C0-\u024F].+)$/
  );
  if (cjkThenLat) {
    const left = cjkThenLat[1].trim();
    const right = cjkThenLat[2].trim();
    if (scriptScore(left).isCjk && scriptScore(right).isLat) {
      return [left, right];
    }
  }

  // 英文… + 中文…
  const latThenCjk = trimmed.match(
    /^(.*?[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F\s\d.,!?;:'"()-]*)\s+([\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff].+)$/
  );
  if (latThenCjk) {
    const left = latThenCjk[1].trim();
    const right = latThenCjk[2].trim();
    if (scriptScore(left).isLat && scriptScore(right).isCjk) {
      return [left, right];
    }
  }

  return [trimmed];
}

export const parseSRT = (srtContent: string): SubtitleEntry[] => {
  try {
    const parsed = parser.fromSrt(srtContent);
    return parsed.map((item: SRTParserResult, index: number) => ({
      id: item.id ? Number(item.id) : index + 1,
      startTime: item.startTime,
      endTime: item.endTime,
      text: item.text.trim(),
      translatedText: undefined,
      translationStatus: 'pending' as const,
    }));
  } catch (error) {
    const appError = toAppError(error, 'SRT解析失败');
    logger.error(appError.message, appError);
    throw new Error('无效的SRT文件格式');
  }
};

export const toSRT = (entries: SubtitleEntry[], useTranslation: boolean = true): string => {
  const srtEntries: SRTParserInput[] = entries.map((entry, index) => ({
    id: (index + 1).toString(),
    startTime: entry.startTime,
    endTime: entry.endTime,
    text: useTranslation && entry.translatedText ? entry.translatedText : entry.text,
    startSeconds: 0,
    endSeconds: 0,
  }));

  return parser.toSrt(srtEntries);
};

export const toTXT = (entries: SubtitleEntry[], useTranslation: boolean = true): string => {
  return entries
    .map((entry) =>
      useTranslation && entry.translatedText ? entry.translatedText : entry.text
    )
    .join('\n\n');
};

export const toBilingual = (entries: SubtitleEntry[]): string => {
  const bilingualEntries: SRTParserInput[] = entries.map((entry, index) => ({
    id: (index + 1).toString(),
    startTime: entry.startTime,
    endTime: entry.endTime,
    text: `${entry.translatedText || ''}\n${entry.text}`,
    startSeconds: 0,
    endSeconds: 0,
  }));

  return parser.toSrt(bilingualEntries);
};

export const toSrcTrans = (entries: SubtitleEntry[]): string => {
  const bilingualEntries: SRTParserInput[] = entries.map((entry, index) => ({
    id: (index + 1).toString(),
    startTime: entry.startTime,
    endTime: entry.endTime,
    text: `${entry.text}\n${entry.translatedText || ''}`,
    startSeconds: 0,
    endSeconds: 0,
  }));

  return parser.toSrt(bilingualEntries);
};
