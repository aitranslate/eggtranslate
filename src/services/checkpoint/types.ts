/**
 * 任务级断点续跑检查点（与字幕条目分开存）。
 *
 * 粒度：
 * - ASR：云端 transcript.id（submit 后立刻落盘）+ 完成后的词表
 * - AI 断句：每个 LLM span 的原始返回
 * - 翻译：不在这里；走 subtitle_entries.translationStatus
 */

export const CHECKPOINT_VERSION = 1 as const;

/** ASR 词级结果（start/end 秒），供本地 DP / AI 断句续跑。 */
export interface AsrCheckpointWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface AsrJobCheckpoint {
  transcriptId: string;
  keyFingerprint: string;
  status: 'submitted' | 'completed' | 'error';
  language?: string;
  speechModelUsed?: string;
}

/** 单个 AI 断句 span：用 spanText 校验，避免词表变化后误用旧刀。 */
export interface AiBreakSpanCheckpoint {
  spanIdx: number;
  spanText: string;
  content: string | null;
  tokensUsed: number;
}

export interface TaskCheckpoint {
  version: typeof CHECKPOINT_VERSION;
  taskId: string;
  /** 词表指纹：lang|preset|n|首词|末词|末尾 ms，变了则丢弃 aiBreaks */
  asrFingerprint?: string;
  preset?: string;
  asr?: AsrJobCheckpoint;
  words?: AsrCheckpointWord[];
  language?: string;
  aiBreaks?: Record<string, AiBreakSpanCheckpoint>;
}

export function asrWordsFingerprint(
  words: AsrCheckpointWord[],
  language: string,
  preset: string
): string {
  const n = words.length;
  const first = n > 0 ? words[0].text : '';
  const last = n > 0 ? words[n - 1].text : '';
  const endMs = n > 0 ? Math.round(words[n - 1].end * 1000) : 0;
  return `${language}|${preset}|${n}|${first}|${last}|${endMs}`;
}
