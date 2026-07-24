/**
 * Agent 翻译模块公共导出。
 * 仅在 config.agentTranslationEnabled 时由 translationService 引用。
 */

export { runAgentTranslation } from './pipeline';
export {
  parseTerminologyContent,
  mergeGlossaryWithUserTerms,
  groundGlossaryForTranslation,
  sourceGroundedInText,
  alignStyleGuideToGlossary,
  finalizeAgentGlossary,
  formatAgentTermsBlock,
  buildTerminologyPrompts,
  transcriptPlainFromEntries,
} from './terminology';
export { expandUserTerms } from './expandUserTerms';
export { checkGlobalTerminology } from './terminologyCheck';
export { projectContext } from './projectContext';
export { runAgentLoop } from './loop';
export { normalizeTranslationRows } from './toolTypes';
export type { NormalizedTranslationRow } from './toolTypes';
export {
  filterGlossaryForWindow,
  textsFromSegments,
} from './windowGlossary';
export { assessWindowRisk } from './windowRisk';
export type { WindowRiskAssessment, WindowRiskSignal } from './windowRisk';
export {
  DEFAULT_TRANSLATE_MAX_ROUNDS,
  translateToolChoice,
} from './agents/translateAgent';
export {
  splitAgentWindows,
  splitBriefingEntryWindows,
  unionGlossaries,
  mergeStyleGuides,
} from './windows';
export {
  applyAgentEventToStatus,
  agentSnapshotToStatus,
  statusToAgentSnapshot,
  createIdleAgentRunStatus,
  formatAgentCompactBadge,
  formatAgentCompactSummary,
  isLongAgentNarrative,
  agentProgressPercent,
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
