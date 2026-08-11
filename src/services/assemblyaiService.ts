import type { AssemblyAI } from "assemblyai";
import { ASSEMBLYAI_CONFIG } from "@/constants/assemblyai";
import { toAppError } from "@/utils/errors";
import { useTranscriptionStore } from "@/stores/transcriptionStore";
import type { AssemblyAISentence } from "@/utils/subtitleSegmentation";
import { logger } from "@/utils/logger";

/**
 * AssemblyAI 转录服务
 * 只负责：上传 addFile 准备好的音频（MP3 / AAC 抽轨 / 原音频）
 * → 拉词级时间戳 → DP 断句。客户端不做浏览器重解码兜底。
 */
class AssemblyAIService {
  private getKeys(): string[] {
    const configuredKeys = useTranscriptionStore.getState().apiKeys;
    if (configuredKeys.trim()) {
      return configuredKeys.split("|").map((k) => k.trim()).filter(Boolean);
    }
    return [];
  }

  /** SDK 体积较大，首次转录时再动态加载 */
  private async createClient(): Promise<AssemblyAI> {
    const keys = this.getKeys();
    if (keys.length === 0) {
      throw new Error("请先在设置中配置 AssemblyAI API Key");
    }
    const apiKey = keys[Math.floor(Math.random() * keys.length)];
    const { AssemblyAI } = await import("assemblyai");
    return new AssemblyAI({ apiKey });
  }

  /**
   * @param audioFile addFile 缓存的音频（尽量小；不含视频）
   * @param options 热词等
   * @param onProgress 进度：transcribing | segmenting | completed
   */
  async transcribeWithSmartSegmentation(
    audioFile: File,
    options: { keyterms?: string[] } = {},
    onProgress?: (status: string, percent: number) => void
  ): Promise<{ sentences: AssemblyAISentence[]; language: string }> {
    try {
      const client = await this.createClient();

      logger.info(
        "开始上传并转录:",
        audioFile.name,
        `${(audioFile.size / 1024 / 1024).toFixed(2)}MB`
      );
      onProgress?.("transcribing", 10);

      // speech_models：U3.5 Pro 优先，不支持语种回落 U2；语言自动检测
      const transcript = await client.transcripts.transcribe({
        audio: audioFile,
        language_detection: true,
        speech_models: [...ASSEMBLYAI_CONFIG.speechModels],
        keyterms_prompt: options.keyterms || ASSEMBLYAI_CONFIG.defaultKeyterms,
      });

      if (transcript.status === "error") {
        throw new Error(`Transcription failed: ${transcript.error}`);
      }

      logger.info(
        "转录完成，语言:",
        transcript.language_code,
        "model:",
        transcript.speech_model_used ?? "(unknown)"
      );

      const languageCode = transcript.language_code || "en";
      const words = transcript.words.map((w) => ({
        text: w.text,
        start: w.start / 1000,
        end: w.end / 1000,
        confidence: w.confidence,
      }));

      onProgress?.("segmenting", 80);
      const preset =
        useTranscriptionStore.getState().subtitleLengthPreset || "standard";
      const { segmentWords } = await import("@/services/sentenceSegmentation");
      const segments = segmentWords(words, languageCode, preset, {
        watchabilityMerge: true,
      });

      logger.info("DP 断句完成，共", segments.length, "句，语言:", languageCode);
      onProgress?.("completed", 100);

      return {
        sentences: segments.map((s) => ({
          text: s.text,
          start: s.startTime,
          end: s.endTime,
          words: s.words.map((w) => ({
            text: w.text,
            start: w.start,
            end: w.end,
          })),
        })),
        language: languageCode,
      };
    } catch (error) {
      const appError = toAppError(error, "ASR 转录失败");
      logger.error(appError.message, appError);
      throw appError;
    }
  }
}

export const assemblyaiService = new AssemblyAIService();
