/**
 * Agent 翻译模块公共导出。
 * 仅在 config.agentTranslationEnabled 时由 translationService 引用。
 */

export { runAgentTranslation } from './pipeline';
export { splitAgentWindows } from './windows';
export {
  parseTerminologyContent,
  mergeGlossaryWithUserTerms,
  formatAgentTermsBlock,
  buildTerminologyPrompts,
} from './terminology';
export { runAgentLoop } from './loop';
export {
  applyAgentEventToStatus,
  agentSnapshotToStatus,
  statusToAgentSnapshot,
  createIdleAgentRunStatus,
  formatAgentCompactBadge,
  formatAgentCompactSummary,
  isLongAgentNarrative,
} from './agentRunStatus';
export {
  BRIEFING_TOOL_SCHEMAS,
  TRANSLATION_TOOL_SCHEMAS,
  QA_TOOL_SCHEMAS,
  dispatchTool,
} from './tools/registry';
export type {
  AgentEvent,
  AgentEventHandler,
  GlossaryEntry,
  AgentJob,
  RunAgentTranslationInput,
} from './types';
export type { AgentRunStatus } from './agentRunStatus';
