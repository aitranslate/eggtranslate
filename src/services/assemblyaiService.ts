import type { AssemblyAI } from "assemblyai";
import { ASSEMBLYAI_CONFIG } from "@/constants/assemblyai";
import { toAppError } from "@/utils/errors";
import { useTranscriptionStore } from "@/stores/transcriptionStore";
import { useTranslationConfigStore } from "@/stores/translationConfigStore";
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
   * @param options 热词等；useAiSegmentation 为任务级 AI 断句开关
   * @param onProgress 进度：transcribing | segmenting | completed
   * @param onAiProgress AI 断句兜底进度（已处理/总触发，仅开启时回调）
   * @param onAiTokens 每次真实 LLM 调用的 token 增量（缓存命中为 0，不回调）
   */
  async transcribeWithSmartSegmentation(
    audioFile: File,
    options: { keyterms?: string[]; useAiSegmentation?: boolean } = {},
    onProgress?: (status: string, percent: number) => void,
    onAiProgress?: (resolved: number, total: number) => void,
    onAiTokens?: (delta: number) => void
  ): Promise<{ sentences: AssemblyAISentence[]; language: string; tokensUsed?: number }> {
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
      const { segmentWords, segmentWordsWithAiFallback } = await import("@/services/sentenceSegmentation");

      let segments;
      let aiTokensUsed = 0;
      if (options.useAiSegmentation) {
        // AI 兜底：仅对 DP 硬断的 span 调 LLM；合法不超限即采纳，无效则回退规则结果。
        const { createAiSentenceBreaker } = await import(
          "@/services/aiSentenceBreakerService"
        );
        const threadCount =
          useTranslationConfigStore.getState().config.threadCount || 4;
        segments = await segmentWordsWithAiFallback(words, languageCode, preset, {
          aiBreaker: createAiSentenceBreaker(),
          concurrency: threadCount,
          watchabilityMerge: true,
          // 断句阶段 80→100 进度：按已完成的 AI 句数推进
          onAiProgress: (resolved, total) => {
            onAiProgress?.(resolved, total);
            const denom = Math.max(total, 1);
            onProgress?.("segmenting", 80 + Math.round((20 * resolved) / denom));
          },
          onAiResolved: (_text, _accepted, tokensUsed) => {
            if (tokensUsed > 0) {
              aiTokensUsed += tokensUsed;
              onAiTokens?.(tokensUsed);
            }
          },
        });
      } else {
        segments = segmentWords(words, languageCode, preset, {
          watchabilityMerge: true,
        });
      }

      logger.info(
        "DP 断句完成，共",
        segments.length,
        "句，语言:",
        languageCode,
        "AI tokens:",
        aiTokensUsed
      );
      onProgress?.("completed", 100);

      return {
        sentences: segments.map((s) => ({
          text: s.text,
          start: s.startTime,
          end: s.endTime,
          aiSplit: s.aiSplit,
          words: s.words.map((w) => ({
            text: w.text,
            start: w.start,
            end: w.end,
          })),
        })),
        language: languageCode,
        tokensUsed: aiTokensUsed,
      };
    } catch (error) {
      const appError = toAppError(error, "ASR 转录失败");
      logger.error(appError.message, appError);
      throw appError;
    }
  }
}

export const assemblyaiService = new AssemblyAIService();
