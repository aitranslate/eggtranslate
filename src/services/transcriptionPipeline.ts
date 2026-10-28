/**
 * 转录流程：ASR（可续跑）→ DP / AI 断句 → 字幕条目
 * 转码在 addFile 完成，这里只上传/提交/轮询/断句。
 */

import { SubtitleEntry } from '@/types';
import { assemblyaiService } from './assemblyaiService';
import { formatTime } from '@/utils/timeUtils';
import type { AsrCheckpointWord } from '@/services/checkpoint';

interface ProgressCallbacks {
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

export type TranscriptionPipelineOptions = {
  useAiSegmentation?: boolean;
  resume?: {
    transcriptId?: string;
    keyFingerprint?: string;
    words?: AsrCheckpointWord[];
    language?: string;
  };
  onAsrSubmitted?: (info: {
    transcriptId: string;
    keyFingerprint: string;
  }) => void | Promise<void>;
  onAsrCompleted?: (info: {
    words: AsrCheckpointWord[];
    language: string;
    transcriptId: string;
    keyFingerprint: string;
  }) => void | Promise<void>;
  aiBreakResume?: Map<
    number,
    { spanText: string; content: string | null; tokensUsed: number }
  >;
  onAiSpanPersist?: (span: {
    spanIdx: number;
    spanText: string;
    content: string | null;
    tokensUsed: number;
  }) => void | Promise<void>;
};

/**
 * @param audioFile - addFile 缓存的 ASR 音频；纯续跑（已有 id / 词表）可为 null
 */
export const runTranscriptionPipeline = async (
  audioFile: File | null,
  keyterms: string[] = [],
  callbacks: ProgressCallbacks = {},
  options: TranscriptionPipelineOptions = {}
): Promise<{
  entries: SubtitleEntry[];
  language: string;
  /** AI 断句兜底的 LLM tokens（未开启时缺省） */
  tokensUsed?: number;
}> => {
  try {
    let words: AsrCheckpointWord[];
    let language: string;

    const cachedWords = options.resume?.words;
    if (cachedWords && cachedWords.length >= 0 && options.resume?.language) {
      words = cachedWords;
      language = options.resume.language;
    } else {
      callbacks.onTranscribing?.();
      callbacks.onUploading?.();
      const asr = await assemblyaiService.transcribeAudio(audioFile, {
        keyterms,
        resumeTranscriptId: options.resume?.transcriptId,
        resumeKeyFingerprint: options.resume?.keyFingerprint,
        onSubmitted: options.onAsrSubmitted,
        onProgress: (status, percent) => {
          if (status === 'transcribing') {
            callbacks.onProgress?.(percent);
            callbacks.onTranscribing?.();
            callbacks.onUploading?.();
          }
        },
      });
      words = asr.words;
      language = asr.language;
      await options.onAsrCompleted?.({
        words: asr.words,
        language: asr.language,
        transcriptId: asr.transcriptId,
        keyFingerprint: asr.keyFingerprint,
      });
    }

    callbacks.onProgress?.(80);
    callbacks.onSegmenting?.();

    const preset =
      (await import('@/stores/transcriptionStore')).useTranscriptionStore.getState()
        .subtitleLengthPreset || 'standard';
    const { segmentWords, segmentWordsWithAiFallback } = await import(
      '@/services/sentenceSegmentation'
    );

    let segments;
    let aiTokensUsed = 0;
    if (options.useAiSegmentation) {
      const { createAiSentenceBreaker } = await import(
        '@/services/aiSentenceBreakerService'
      );
      const { useTranslationConfigStore } = await import(
        '@/stores/translationConfigStore'
      );
      const threadCount =
        useTranslationConfigStore.getState().config.threadCount || 4;
      segments = await segmentWordsWithAiFallback(words, language, preset, {
        aiBreaker: createAiSentenceBreaker(),
        concurrency: threadCount,
        watchabilityMerge: true,
        resumeSpans: options.aiBreakResume,
        onAiSpanPersist: options.onAiSpanPersist,
        onAiProgress: (resolved, total) => {
          callbacks.onAiProgress?.(resolved, total);
          const denom = Math.max(total, 1);
          callbacks.onProgress?.(80 + Math.round((20 * resolved) / denom));
        },
        onAiResolved: (_text, _accepted, tokensUsed) => {
          if (tokensUsed > 0) {
            aiTokensUsed += tokensUsed;
            callbacks.onAiTokens?.(tokensUsed);
          }
        },
      });
    } else {
      segments = segmentWords(words, language, preset, {
        watchabilityMerge: true,
      });
    }

    const entries: SubtitleEntry[] = [];
    let entryId = 1;

    for (const sentence of segments) {
      entries.push({
        id: entryId++,
        startTime: formatTime(sentence.startTime / 1000),
        endTime: formatTime(sentence.endTime / 1000),
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
      tokensUsed: aiTokensUsed,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    callbacks.onError?.(message);
    throw error;
  }
};
