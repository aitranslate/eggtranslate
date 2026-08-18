/**
 * 断点续跑框架
 *
 * 需要续跑（远程 / LLM）：
 *   1. ASR     — submit 后立刻存 transcript.id，之后只 GET/轮询
 *   2. AI 断句 — 每个 span 的 LLM 返回落盘，重跑跳过已完成 span
 *   3. 翻译    — 每批定稿写入 subtitle_entries（本模块不存译文）
 *
 * 不需要：导入转码、DP 断句等纯 CPU。
 */

export { asrWordsFingerprint, type AsrCheckpointWord } from './types';

export {
  fingerprintApiKey,
  findKeyByFingerprint,
  parseApiKeys,
} from './keyFingerprint';

export {
  loadTaskCheckpoint,
  saveTaskCheckpoint,
  saveAsrJobCheckpoint,
  saveAiBreakSpan,
  removeTaskCheckpoint,
  clearAllTaskCheckpoints,
  resetCheckpointWriteQueuesForTests,
} from './storage';
