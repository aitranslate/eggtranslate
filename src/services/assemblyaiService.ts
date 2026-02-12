import { AssemblyAI } from "assemblyai";
import { ASSEMBLYAI_CONFIG } from "@/constants/assemblyai";
import { convertToWav } from "@/utils/convertToWav";
import type { TranscriptionWord } from "@/types";
import { toAppError } from "@/utils/errors";

/**
 * AssemblyAI 句子格式（带时间戳）
 */
export interface AssemblyAISentence {
  text: string;
  start: number;  // 毫秒
  end: number;    // 毫秒
}

/**
 * AssemblyAI 转录服务
 * 封装 API 调用、KEY 轮询、错误处理
 */
export class AssemblyAIService {
  private keyIndex = 0;

  /**
   * 随机获取一个 KEY 并创建客户端
   */
  private createClient(): AssemblyAI {
    const keys = ASSEMBLYAI_CONFIG.apiKeys;
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
        case 'terminated':
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

      // 1. 转换为 WAV
      const wavBlob = await convertToWav(mediaFile);
      const wavFile = new File([wavBlob], 'audio.wav', { type: 'audio/wav' });

      // 2. 调用 AssemblyAI
      const transcript = await client.transcripts.transcribe({
        audio: wavFile,
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

      // 1. 转换为 WAV
      onProgress?.('uploading', 5);
      const wavBlob = await convertToWav(mediaFile);
      const wavFile = new File([wavBlob], 'audio.wav', { type: 'audio/wav' });

      // 2. 上传并启动转录
      onProgress?.('uploading', 10);
      const transcript = await client.transcripts.transcribe({
        audio: wavFile,
        speech_models: ASSEMBLYAI_CONFIG.speechModels,
        language_detection: true,
        keyterms_prompt: options.keyterms || ASSEMBLYAI_CONFIG.defaultKeyterms
      });

      // 3. 轮询状态直到完成
      while (transcript.status === 'queued' || transcript.status === 'processing') {
        onProgress?.(transcript.status, transcript.status === 'processing' ? 50 : 10);
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
}

// 导出单例
export const assemblyaiService = new AssemblyAIService();
