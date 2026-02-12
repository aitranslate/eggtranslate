/**
 * 转录流程服务
 * 封装音视频 → AssemblyAI 转录 → 生成字幕条目
 */

import { SubtitleEntry } from '@/types';
import { assemblyaiService, type AssemblyAISentence } from './assemblyaiService';
import { toast } from 'react-hot-toast';
import { toAppError } from '@/utils/errors';

/**
 * 进度更新回调
 */
export interface ProgressCallbacks {
  onUploading?: () => void;
  onTranscribing?: () => void;
  onCompleted?: () => void;
  onError?: (error: string) => void;
}

/**
 * 执行转录流程
 * @param fileRef - 音视频文件引用
 * @param callbacks - 进度回调
 * @returns 转录结果
 */
export const runTranscriptionPipeline = async (
  fileRef: File,
  callbacks: ProgressCallbacks = {}
): Promise<{
  entries: SubtitleEntry[];
  duration: number;
}> => {
  try {
    // 1. 上传并转录
    callbacks.onUploading?.();
    const sentences = await assemblyaiService.transcribeWithSentences(fileRef);

    callbacks.onTranscribing?.();
    toast(`转录完成，共 ${sentences.length} 个句子`);

    // 2. 生成字幕条目
    const entries: SubtitleEntry[] = [];
    let entryId = 1;

    for (const sentence of sentences) {
      entries.push({
        id: entryId++,
        startTime: formatTime(sentence.start / 1000),  // 毫秒 → 秒
        endTime: formatTime(sentence.end / 1000),
        text: sentence.text,
        translatedText: '',
        translationStatus: 'pending'
      });
    }

    const duration = sentences[sentences.length - 1]?.end / 1000 || 0;

    callbacks.onCompleted?.();

    return {
      entries,
      duration
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '转录失败';
    callbacks.onError?.(errorMessage);
    throw error;
  }
};

/**
 * 格式化时间为 SRT 格式 (00:00:00,000)
 */
function formatTime(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const milliseconds = Math.round((seconds % 1) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds).toString().padStart(3, '0')}`;
}
