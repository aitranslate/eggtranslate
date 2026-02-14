import SRTParser2 from 'srt-parser-2';
import { SubtitleEntry } from '@/types';
import { toAppError } from '@/utils/errors';

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

export const parseSRT = (srtContent: string): SubtitleEntry[] => {
  try {
    const parsed = parser.fromSrt(srtContent);
    return parsed.map((item: SRTParserResult, index: number) => ({
      id: item.id ? Number(item.id) : index + 1,
      startTime: item.startTime,
      endTime: item.endTime,
      text: item.text.trim(),
      translatedText: undefined,
      translationStatus: 'pending' as const
    }));
  } catch (error) {
    const appError = toAppError(error, 'SRT解析失败');
    console.error('[srtParser]', appError.message, appError);
    throw new Error('无效的SRT文件格式');
  }
};

export const toSRT = (entries: SubtitleEntry[], useTranslation: boolean = true): string => {
  const srtEntries: SRTParserInput[] = entries.map(entry => ({
    id: entry.id.toString(),
    startTime: entry.startTime,
    endTime: entry.endTime,
    text: useTranslation && entry.translatedText ? entry.translatedText : entry.text,
    startSeconds: 0,
    endSeconds: 0
  }));

  return parser.toSrt(srtEntries);
};

export const toTXT = (entries: SubtitleEntry[], useTranslation: boolean = true): string => {
  return entries
    .map(entry => useTranslation && entry.translatedText ? entry.translatedText : entry.text)
    .join('\n\n');
};

export const toBilingual = (entries: SubtitleEntry[]): string => {
  const bilingualEntries: SRTParserInput[] = entries.map(entry => ({
    id: entry.id.toString(),
    startTime: entry.startTime,
    endTime: entry.endTime,
    text: `${entry.translatedText || ''}\n${entry.text}`,
    startSeconds: 0,
    endSeconds: 0
  }));

  return parser.toSrt(bilingualEntries);
};