import { AssemblyAI } from "assemblyai";
import { ASSEMBLYAI_CONFIG } from "@/constants/assemblyai";
import type { TranscriptionWord } from "@/types";
import { toAppError } from "@/utils/errors";
import { useTranscriptionStore } from "@/stores/transcriptionStore";
import { convertToMP3 } from "@/utils/convertToMP3";
import { type AssemblyAISentence } from "@/utils/subtitleSegmentation";
import { semanticSegment } from "@/utils/semanticSegmentation";

/**
 * AssemblyAI 转录服务
 * 封装 API 调用、KEY 轮询、错误处理
 */
export class AssemblyAIService {
  /**
   * 获取可用的 API keys 列表
   */
  private getKeys(): string[] {
    const configuredKeys = useTranscriptionStore.getState().apiKeys;
    if (configuredKeys.trim()) {
      return configuredKeys.split('|').map(k => k.trim()).filter(k => k);
    }
    return [];
  }

  /**
   * 随机获取一个 KEY 并创建客户端
   */
  private createClient(): AssemblyAI {
    const keys = this.getKeys();
    if (keys.length === 0) {
      throw new Error('请先在设置中配置 AssemblyAI API Key');
    }
    const apiKey = keys[Math.floor(Math.random() * keys.length)];
    return new AssemblyAI({ apiKey });
  }

  /**
   * 转录音视频文件
   * @param mediaFile 音频或视频文件
   * @param options 热词等配置
   * @returns 单词级别时间戳数组
   */
  async transcribe(
    mediaFile: File,
    options: { keyterms?: string[] } = {}
  ): Promise<TranscriptionWord[]> {
    try {
      const client = this.createClient();

      // 尝试转换为 MP3 以减小文件大小，失败则使用原文件
      let audioFile: File;
      try {
        const mp3Blob = await convertToMP3(mediaFile);
        audioFile = new File([mp3Blob], 'audio.mp3', { type: 'audio/mpeg' });
      } catch (convertError) {
        console.warn('[AssemblyAI] MP3 转码失败，使用原文件上传:', convertError);
        audioFile = mediaFile;
      }

      const transcript = await client.transcripts.transcribe({
        audio: audioFile,
        speech_models: ASSEMBLYAI_CONFIG.speechModels,
        language_detection: true,
        keyterms_prompt: options.keyterms || ASSEMBLYAI_CONFIG.defaultKeyterms
      });

      // 3. 检查错误
      if (transcript.status === 'error') {
        throw new Error(`Transcription failed: ${transcript.error}`);
      }

      // 4. 转换为 TranscriptionWord 格式
      return transcript.words.map(w => ({
        text: w.text,
        start: w.start / 1000,  // 毫秒 → 秒
        end: w.end / 1000,
        confidence: w.confidence
      }));

    } catch (error) {
      const appError = toAppError(error, 'ASR 转录失败');
      console.error('[AssemblyAI]', appError.message, appError);
      throw appError;
    }
  }

  /**
   * 智能断句转录（使用单词级别时间戳）
   * @param mediaFile 音频或视频文件
   * @param options 热词等配置
   * @param onProgress 进度回调（状态 + 百分比）
   * @returns 断句后的句子数组（包含时间戳）
   */
  async transcribeWithSmartSegmentation(
    mediaFile: File,
    options: { keyterms?: string[] } = {},
    onProgress?: (status: string, percent: number) => void
  ): Promise<{ sentences: AssemblyAISentence[], language: string }> {
    try {
      const client = this.createClient();

      // 尝试转换为 MP3 以减小文件大小，失败则使用原文件
      onProgress?.('converting', 5);
      let audioFile: File;
      try {
        console.log('[AssemblyAI] 开始 MP3 转码，原文件大小:', (mediaFile.size / 1024 / 1024).toFixed(2), 'MB');
        const mp3Blob = await convertToMP3(mediaFile);
        audioFile = new File([mp3Blob], 'audio.mp3', { type: 'audio/mpeg' });
        console.log('[AssemblyAI] MP3 转码完成，新文件大小:', (audioFile.size / 1024 / 1024).toFixed(2), 'MB');
      } catch (convertError) {
        console.warn('[AssemblyAI] MP3 转码失败，使用原文件上传:', convertError);
        audioFile = mediaFile;
      }

      console.log('[AssemblyAI] 开始上传并转录（获取单词级别时间戳）...');
      onProgress?.('transcribing', 10);

      const transcript = await client.transcripts.transcribe({
        audio: audioFile,
        speech_models: ASSEMBLYAI_CONFIG.speechModels,
        language_detection: true,
        keyterms_prompt: options.keyterms || ASSEMBLYAI_CONFIG.defaultKeyterms
      });

      console.log('[AssemblyAI] 转录完成，语言代码:', transcript.language_code);

      // 3. 轮询状态直到完成
      while (transcript.status === 'queued' || transcript.status === 'processing') {
        onProgress?.('transcribing', transcript.status === 'processing' ? 50 : 10);
        await new Promise(resolve => setTimeout(resolve, 1000));
        const updated = await client.transcripts.get(transcript.id);
        Object.assign(transcript, updated);
      }

      if (transcript.status === 'error') {
        throw new Error(`Transcription failed: ${transcript.error}`);
      }

      console.log('[AssemblyAI] 转录完成，开始智能断句...');

      // 4. 转换单词级别时间戳为标准格式
      const languageCode = transcript.language_code || 'en';
      const words = transcript.words.map(w => ({
        text: w.text,
        start: w.start / 1000,  // 毫秒 -> 秒
        end: w.end / 1000,
        confidence: w.confidence
      }));

      // 5. 语义断句（不限长度，保证语义完整）
      onProgress?.('segmenting', 80);
      const segments = semanticSegment(words, 'transcribe_translate');

      console.log('[AssemblyAI] 语义断句完成，共', segments.length, '个句子，语言代码:', languageCode);

      onProgress?.('completed', 100);

      return {
        sentences: segments.map(s => ({
          text: s.text,
          start: Math.round(s.start * 1000),
          end: Math.round(s.end * 1000),
          words: words.slice(s.wordStart, s.wordEnd + 1).map(w => ({
            text: w.text,
            start: w.start,
            end: w.end
          }))
        })),
        language: languageCode
      };

    } catch (error) {
      const appError = toAppError(error, 'ASR 转录失败');
      console.error('[AssemblyAI]', appError.message, appError);
      throw appError;
    }
  }
}

// 导出单例
export const assemblyaiService = new AssemblyAIService();
