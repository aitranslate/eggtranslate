import { AssemblyAI } from "assemblyai";
import { ASSEMBLYAI_CONFIG } from "@/constants/assemblyai";
import type { TranscriptionWord } from "@/types";
import { toAppError } from "@/utils/errors";
import { useTranscriptionStore } from "@/stores/transcriptionStore";
import { convertToMP3 } from "@/utils/convertToMP3";
import {
  detectLanguageType,
  segmentText,
  getSuggestedMaxLength,
  type AssemblyAISentence
} from "@/utils/subtitleSegmentation";

/**
 * AssemblyAI 转录服务
 * 封装 API 调用、KEY 轮询、错误处理
 */
export class AssemblyAIService {
  private keyIndex = 0;

  /**
   * 获取可用的 API keys 列表
   */
  private getKeys(): string[] {
    const configuredKeys = useTranscriptionStore.getState().apiKeys;
    if (configuredKeys.trim()) {
      return configuredKeys.split('|').map(k => k.trim()).filter(k => k);
    }
    // 返回默认 keys
    return [...ASSEMBLYAI_CONFIG.apiKeys];
  }

  /**
   * 随机获取一个 KEY 并创建客户端
   */
  private createClient(): AssemblyAI {
    const keys = this.getKeys();
    const apiKey = keys[Math.floor(Math.random() * keys.length)];
    return new AssemblyAI({ apiKey });
  }

  /**
   * 轮询转录状态
   * @param transcriptId 转录任务 ID
   * @param onProgress 进度回调（状态 + 百分比）
   * @param timeout 超时时间（秒）
   * @returns 转录结果
   */
  private async pollTranscriptStatus(
    transcriptId: string,
    onProgress?: (status: string, percent: number) => void,
    timeout: number = 120
  ): Promise<any> {
    const client = this.createClient();
    const startTime = Date.now();
    const timeoutMs = timeout * 1000;

    while (true) {
      // 检查超时
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Transcription timeout after ${timeout}s`);
      }

      // 获取状态
      const transcript = await client.transcripts.get(transcriptId);

      switch (transcript.status) {
        case 'queued':
          onProgress?.('queued', 10);
          break;
        case 'processing':
          onProgress?.('processing', 50);
          break;
        case 'completed':
          onProgress?.('completed', 100);
          return transcript;
        case 'error':
          throw new Error(`Transcription failed: ${transcript.error}`);
        case 'terminated' as any:
          throw new Error('Transcription was terminated');
      }

      // 等待 1 秒后继续轮询
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
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
   * 转录音视频文件，返回句子级别（带时间戳）
   * @param mediaFile 音频或视频文件
   * @param options 热词等配置
   * @param onProgress 进度回调（状态 + 百分比）
   * @returns 句子数组（包含时间戳）
   */
  async transcribeWithSentences(
    mediaFile: File,
    options: { keyterms?: string[] } = {},
    onProgress?: (status: string, percent: number) => void
  ): Promise<AssemblyAISentence[]> {
    try {
      const client = this.createClient();

      // 尝试转换为 MP3 以减小文件大小，失败则使用原文件
      onProgress?.('converting', 5);
      let audioFile: File;
      try {
        const mp3Blob = await convertToMP3(mediaFile);
        audioFile = new File([mp3Blob], 'audio.mp3', { type: 'audio/mpeg' });
      } catch (convertError) {
        console.warn('[AssemblyAI] MP3 转码失败，使用原文件上传:', convertError);
        audioFile = mediaFile;
      }

      onProgress?.('transcribing', 10);
      const transcript = await client.transcripts.transcribe({
        audio: audioFile,
        speech_models: ASSEMBLYAI_CONFIG.speechModels,
        language_detection: true,
        keyterms_prompt: options.keyterms || ASSEMBLYAI_CONFIG.defaultKeyterms
      });

      // 3. 轮询状态直到完成
      while (transcript.status === 'queued' || transcript.status === 'processing') {
        onProgress?.('transcribing', transcript.status === 'processing' ? 50 : 10);
        await new Promise(resolve => setTimeout(resolve, 1000));
        // 重新获取状态
        const updated = await client.transcripts.get(transcript.id);
        Object.assign(transcript, updated);
      }

      if (transcript.status === 'error') {
        throw new Error(`Transcription failed: ${transcript.error}`);
      }

      // 4. 使用官方 SDK 方法获取 sentences
      onProgress?.('completed', 100);
      const { sentences } = await client.transcripts.sentences(transcript.id);

      return sentences?.map(s => ({
        text: s.text,
        start: s.start,
        end: s.end
      })) || [];

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
  ): Promise<AssemblyAISentence[]> {
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

      // 4. 检测语言类型
      const languageCode = transcript.language_code || 'en';
      const languageType = detectLanguageType(languageCode);
      console.log('[AssemblyAI] 检测到的语言类型:', languageType, '语言代码:', languageCode);

      // 5. 从 Store 读取用户设置的长度限制
      const userMaxLength = useTranscriptionStore.getState().srtCharsPerCaption;
      const maxLength = userMaxLength || getSuggestedMaxLength(languageType);
      console.log('[AssemblyAI] 字幕长度限制:', maxLength, '用户设置:', userMaxLength, '建议值:', getSuggestedMaxLength(languageType));

      // 6. 转换单词级别时间戳为标准格式
      const words = transcript.words.map(w => ({
        text: w.text,
        start: w.start / 1000,  // 毫秒 -> 秒
        end: w.end / 1000,
        confidence: w.confidence
      }));

      // 7. 使用智能断句工具
      onProgress?.('segmenting', 80);
      const sentences = segmentText(
        transcript.text,
        words,
        languageCode,  // Pass language code instead of type
        maxLength
      );

      console.log('[AssemblyAI] 智能断句完成，共', sentences.length, '个句子');

      onProgress?.('completed', 100);

      return sentences.map(s => ({
        text: s.text,
        start: Math.round(s.start * 1000),
        end: Math.round(s.end * 1000)
      }));

    } catch (error) {
      const appError = toAppError(error, 'ASR 转录失败');
      console.error('[AssemblyAI]', appError.message, appError);
      throw appError;
    }
  }
}

// 导出单例
export const assemblyaiService = new AssemblyAIService();
