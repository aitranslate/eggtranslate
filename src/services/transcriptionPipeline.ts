/**
 * 转录流程：已就绪 MP3 → AssemblyAI → 字幕条目
 * 转码在 addFile 完成，这里只上传/转录。
 */

import { SubtitleEntry } from '@/types';
import { assemblyaiService } from './assemblyaiService';
import { formatTime } from '@/utils/timeUtils';

export interface ProgressCallbacks {
  onUploading?: () => void;
  onTranscribing?: () => void;
  onSegmenting?: () => void;
  onProgress?: (percent: number) => void;
  /** AI 断句兜底进度：已处理句数 / 总触发句数（仅开启 AI 断句时回调）。 */
  onAiProgress?: (resolved: number, total: number) => void;
  /** 每次真实 LLM 断句调用的 token 增量（与翻译 tokensDelta 同源）。 */
  onAiTokens?: (delta: number) => void;
  onCompleted?: () => void;
  onError?: (error: string) => void;
}

/**
 * @param audioFile - addFile 缓存的 ASR 音频（MP3 / AAC / 原音频）
 * @param keyterms - 热词
 * @param callbacks - 进度回调
 */
export const runTranscriptionPipeline = async (
  audioFile: File,
  keyterms: string[] = [],
  callbacks: ProgressCallbacks = {},
  options: { useAiSegmentation?: boolean } = {}
): Promise<{
  entries: SubtitleEntry[];
  language: string;
  /** AI 断句兜底的 LLM tokens（未开启时缺省） */
  tokensUsed?: number;
}> => {
  try {
    const { sentences, language, tokensUsed } =
      await assemblyaiService.transcribeWithSmartSegmentation(
        audioFile,
        { keyterms, useAiSegmentation: options.useAiSegmentation },
        (status, percent) => {
          if (status === 'transcribing') {
            callbacks.onProgress?.(percent);
            callbacks.onTranscribing?.();
            callbacks.onUploading?.();
          } else if (status === 'segmenting') {
            callbacks.onProgress?.(percent);
            callbacks.onSegmenting?.();
          } else if (status === 'completed') {
            callbacks.onCompleted?.();
          }
        },
        (resolved, total) => callbacks.onAiProgress?.(resolved, total),
        (delta) => callbacks.onAiTokens?.(delta)
      );

    const entries: SubtitleEntry[] = [];
    let entryId = 1;

    for (const sentence of sentences) {
      // 断句完成后不再携带 word 级时间戳：UI/导出/IDB 均不需要，源头即剥离
      entries.push({
        id: entryId++,
        startTime: formatTime(sentence.start / 1000),
        endTime: formatTime(sentence.end / 1000),
        text: sentence.text,
        translatedText: '',
        translationStatus: 'pending',
        ...(sentence.aiSplit ? { aiSplit: true } : {}),
      });
    }

    callbacks.onCompleted?.();

    return {
      entries,
      language,
      tokensUsed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    callbacks.onError?.(message);
    throw error;
  }
};
