/**
 * 转录流程：ASR（可续跑）→ 规则断句 → 字幕条目
 * 转码在 addFile 完成，这里只上传/提交/轮询/断句。
 */

import { SubtitleEntry } from '@/types';
import { assemblyaiService } from './assemblyaiService';
import { formatTime } from '@/utils/timeUtils';
import type { AsrCheckpointWord } from '@/services/checkpoint';

interface ProgressCallbacks {
  onUploading?: () => void;
  onTranscribing?: () => void;
  onProgress?: (percent: number) => void;
  onCompleted?: () => void;
  onError?: (error: string) => void;
}

export type TranscriptionPipelineOptions = {
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

    const preset =
      (await import('@/stores/transcriptionStore')).useTranscriptionStore.getState()
        .subtitleLengthPreset || 'standard';
    const { segmentWords } = await import('@/services/sentenceSegmentation');

    const segments = segmentWords(words, language, preset, {
      watchabilityMerge: true,
    });

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
      });
    }

    callbacks.onCompleted?.();

    return {
      entries,
      language,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    callbacks.onError?.(message);
    throw error;
  }
};
