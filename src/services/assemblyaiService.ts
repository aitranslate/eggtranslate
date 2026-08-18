import type { AssemblyAI, Transcript } from "assemblyai";
import { ASSEMBLYAI_CONFIG } from "@/constants/assemblyai";
import { toAppError } from "@/utils/errors";
import { useTranscriptionStore } from "@/stores/transcriptionStore";
import { logger } from "@/utils/logger";
import {
  fingerprintApiKey,
  findKeyByFingerprint,
  parseApiKeys,
} from "@/services/checkpoint";
import type { AsrCheckpointWord } from "@/services/checkpoint";

export type AsrTranscribeResult = {
  words: AsrCheckpointWord[];
  language: string;
  transcriptId: string;
  keyFingerprint: string;
  speechModelUsed?: string;
};

const POLL_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNotFoundError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /\b404\b/i.test(msg) || /not found/i.test(msg);
}

/**
 * AssemblyAI 转录服务
 * submit 立刻拿到 transcript.id → 轮询 GET；不把上传/识别/断句绑成一次阻塞调用。
 */
class AssemblyAIService {
  private getKeys(): string[] {
    return parseApiKeys(useTranscriptionStore.getState().apiKeys);
  }

  private pickKey(preferredFingerprint?: string): { apiKey: string; fingerprint: string } {
    const keys = this.getKeys();
    if (keys.length === 0) {
      throw new Error("请先在设置中配置 AssemblyAI API Key");
    }
    const matched = findKeyByFingerprint(keys, preferredFingerprint);
    const apiKey = matched ?? keys[Math.floor(Math.random() * keys.length)];
    return { apiKey, fingerprint: fingerprintApiKey(apiKey) };
  }

  /** SDK 体积较大，首次转录时再动态加载 */
  private async createClient(apiKey: string): Promise<AssemblyAI> {
    const { AssemblyAI } = await import("assemblyai");
    return new AssemblyAI({ apiKey });
  }

  extractWords(transcript: Transcript): {
    words: AsrCheckpointWord[];
    language: string;
    speechModelUsed?: string;
  } {
    const languageCode = transcript.language_code || "en";
    const raw = transcript.words ?? [];
    const words: AsrCheckpointWord[] = raw.map((w) => ({
      text: w.text,
      start: w.start / 1000,
      end: w.end / 1000,
      confidence: w.confidence,
    }));
    return {
      words,
      language: languageCode,
      speechModelUsed: transcript.speech_model_used ?? undefined,
    };
  }

  private async getTranscript(
    transcriptId: string,
    preferredFingerprint?: string
  ): Promise<{ transcript: Transcript; apiKey: string; fingerprint: string }> {
    const keys = this.getKeys();
    if (keys.length === 0) {
      throw new Error("请先在设置中配置 AssemblyAI API Key");
    }
    const preferred = findKeyByFingerprint(keys, preferredFingerprint);
    const ordered = preferred
      ? [preferred, ...keys.filter((k) => k !== preferred)]
      : keys;

    let lastError: unknown;
    for (const apiKey of ordered) {
      try {
        const client = await this.createClient(apiKey);
        const transcript = await client.transcripts.get(transcriptId);
        return { transcript, apiKey, fingerprint: fingerprintApiKey(apiKey) };
      } catch (error) {
        lastError = error;
        if (!isNotFoundError(error) && ordered.length === 1) throw error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("无法读取转录任务");
  }

  private async waitUntilReady(
    transcriptId: string,
    fingerprint: string,
    onProgress?: (status: string, percent: number) => void
  ): Promise<Transcript> {
    while (true) {
      const { transcript } = await this.getTranscript(transcriptId, fingerprint);
      if (transcript.status === "completed" || transcript.status === "error") {
        return transcript;
      }
      const percent = transcript.status === "processing" ? 45 : 20;
      onProgress?.("transcribing", percent);
      await sleep(POLL_MS);
    }
  }

  /**
   * 提交或续跑 ASR。已有 transcript.id 时只 GET/轮询，不再上传。
   */
  async transcribeAudio(
    audioFile: File | null,
    options: {
      keyterms?: string[];
      resumeTranscriptId?: string;
      resumeKeyFingerprint?: string;
      onSubmitted?: (info: {
        transcriptId: string;
        keyFingerprint: string;
      }) => void | Promise<void>;
      onProgress?: (status: string, percent: number) => void;
    } = {}
  ): Promise<AsrTranscribeResult> {
    try {
      const resumeId = options.resumeTranscriptId?.trim();
      if (resumeId) {
        logger.info("续跑 AssemblyAI 任务:", resumeId);
        options.onProgress?.("transcribing", 20);
        try {
          const { transcript, fingerprint } = await this.getTranscript(
            resumeId,
            options.resumeKeyFingerprint
          );
          if (transcript.status === "error") {
            throw new Error(`Transcription failed: ${transcript.error}`);
          }
          if (transcript.status !== "completed") {
            const ready = await this.waitUntilReady(
              resumeId,
              fingerprint,
              options.onProgress
            );
            if (ready.status === "error") {
              throw new Error(`Transcription failed: ${ready.error}`);
            }
            const extracted = this.extractWords(ready);
            return {
              ...extracted,
              transcriptId: resumeId,
              keyFingerprint: fingerprint,
            };
          }
          const extracted = this.extractWords(transcript);
          return {
            ...extracted,
            transcriptId: resumeId,
            keyFingerprint: fingerprint,
          };
        } catch (error) {
          if (!audioFile) throw error;
          logger.warn("续跑失败，将重新提交转录", error);
        }
      }

      if (!audioFile) {
        throw new Error("没有可上传的音频，且没有可续跑的转录任务");
      }

      const { apiKey, fingerprint } = this.pickKey(options.resumeKeyFingerprint);
      const client = await this.createClient(apiKey);

      logger.info(
        "开始上传并提交转录:",
        audioFile.name,
        `${(audioFile.size / 1024 / 1024).toFixed(2)}MB`
      );
      options.onProgress?.("transcribing", 10);

      const submitted = await client.transcripts.submit({
        audio: audioFile,
        language_detection: true,
        speech_models: [...ASSEMBLYAI_CONFIG.speechModels],
        keyterms_prompt: options.keyterms || ASSEMBLYAI_CONFIG.defaultKeyterms,
      });

      if (!submitted.id) {
        throw new Error("AssemblyAI 未返回 transcript id");
      }

      await options.onSubmitted?.({
        transcriptId: submitted.id,
        keyFingerprint: fingerprint,
      });

      if (submitted.status === "error") {
        throw new Error(`Transcription failed: ${submitted.error}`);
      }

      const transcript =
        submitted.status === "completed"
          ? submitted
          : await this.waitUntilReady(
              submitted.id,
              fingerprint,
              options.onProgress
            );

      if (transcript.status === "error") {
        throw new Error(`Transcription failed: ${transcript.error}`);
      }

      logger.info(
        "转录完成，语言:",
        transcript.language_code,
        "model:",
        transcript.speech_model_used ?? "(unknown)",
        "id:",
        submitted.id
      );

      const extracted = this.extractWords(transcript);
      return {
        ...extracted,
        transcriptId: submitted.id,
        keyFingerprint: fingerprint,
      };
    } catch (error) {
      const appError = toAppError(error, "ASR 转录失败");
      logger.error(appError.message, appError);
      throw appError;
    }
  }
}

export const assemblyaiService = new AssemblyAIService();
