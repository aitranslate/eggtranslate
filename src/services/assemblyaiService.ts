import { AssemblyAI } from "assemblyai";
import { ASSEMBLYAI_CONFIG } from "@/constants/assemblyai";
import { convertToWav } from "@/utils/convertToWav";
import type { TranscriptionWord } from "@/types/transcription";
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
        start_time: w.start / 1000,  // 毫秒 → 秒
        end_time: w.end / 1000,
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
   * @returns 句子数组（包含时间戳）
   */
  async transcribeWithSentences(
    mediaFile: File
  ): Promise<AssemblyAISentence[]> {
    try {
      const client = this.createClient();

      // 1. 转换为 WAV
      const wavBlob = await convertToWav(mediaFile);
      const wavFile = new File([wavBlob], 'audio.wav', { type: 'audio/wav' });

      // 2. 调用 AssemblyAI
      const transcript = await client.transcripts.transcribe({
        audio: wavFile,
        speech_models: ASSEMBLYAI_CONFIG.speechModels,
        language_detection: true
      });

      // 3. 检查错误
      if (transcript.status === 'error') {
        throw new Error(`Transcription failed: ${transcript.error}`);
      }

      // 4. 返回句子（AssemblyAI 已自动分割）
      return transcript.sentences?.map(s => ({
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
