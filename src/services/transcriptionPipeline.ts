/**
 * 转录流程服务
 * 封装音视频 → AssemblyAI 转录 → 生成字幕条目
 */

import { SubtitleEntry } from '@/types';
import { assemblyaiService } from './assemblyaiService';
import type { AssemblyAISentence } from '@/utils/subtitleSegmentation';
import { toast } from 'react-hot-toast';
import { toAppError } from '@/utils/errors';
import { formatTime } from '@/utils/timeUtils';

/**
 * 进度更新回调
 */
export interface ProgressCallbacks {
  onConverting?: () => void;
  onUploading?: () => void;
  onTranscribing?: () => void;
  onSegmenting?: () => void;
  onProgress?: (percent: number) => void;
  onCompleted?: () => void;
  onError?: (error: string) => void;
}

/**
 * 执行转录流程
 * @param fileRef - 音视频文件引用
 * @param keyterms - 热词列表
 * @param callbacks - 进度回调
 * @returns 转录结果
 */
export const runTranscriptionPipeline = async (
  fileRef: File,
  keyterms: string[] = [],
  callbacks: ProgressCallbacks = {}
): Promise<{
  entries: SubtitleEntry[];
  language: string;
}> => {
  try {
    // 1. 上传并转录（使用智能断句）
    const { sentences, language } = await assemblyaiService.transcribeWithSmartSegmentation(
      fileRef,
      { keyterms },
      (status, percent) => {
        callbacks.onProgress?.(percent);
        if (status === 'converting') callbacks.onConverting?.();
        else if (status === 'transcribing') callbacks.onTranscribing?.();
        else if (status === 'segmenting') callbacks.onSegmenting?.();
        else if (status === 'completed') callbacks.onCompleted?.();
      }
    );

    // onCompleted callback will show toast

    // 2. 生成字幕条目
    const entries: SubtitleEntry[] = [];
    let entryId = 1;

    for (const sentence of sentences) {
      entries.push({
        id: entryId++,
        startTime: formatTime(sentence.start / 1000),
        endTime: formatTime(sentence.end / 1000),
        text: sentence.text,
        translatedText: '',
        translationStatus: 'pending',
        words: sentence.words
      });
    }

    callbacks.onCompleted?.();

    return {
      entries,
      language
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '转录失败';
    callbacks.onError?.(errorMessage);
    throw error;
  }
};

