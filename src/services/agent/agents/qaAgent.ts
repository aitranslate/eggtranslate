/**
 * Window QA Agent：submit_qa_report（对齐 AsrAgent）。
 */

import type { TranslationConfig } from '@/types';
import { getActiveLlmConfig } from '@/utils/llmProfiles';
import { runAgentLoop, type AgentLoopToolHook } from '../loop';
import { QA_TOOL_SCHEMAS } from '../tools/registry';
import type { AgentToolContext, TranscriptEntry } from '../toolTypes';
import type { GlossaryEntry } from '../types';
import type { WindowTranslation } from './translateAgent';

export type QaIssue = {
  severity: string;
  index: number | null;
  issue_type: string;
  original_text?: string;
  translated_text?: string;
  suggestion?: string;
};

function formatGlossary(glossary: GlossaryEntry[]): string {
  const lines = glossary.map((g) => `- ${g.source} -> ${g.target}`);
  return lines.length ? lines.join('\n') : '(none)';
}

function renderPairs(
  segments: TranscriptEntry[],
  translations: WindowTranslation[]
): string {
  const byIdx = new Map(translations.map((t) => [t.index, t.text]));
  return segments
    .map((s) => `[${s.index}] ${s.text}\n[${s.index}] ${byIdx.get(s.index) || ''}`)
    .join('\n');
}

export function buildQaSystemPrompt(sourceLang: string, targetLang: string): string {
  return `You are a QA reviewer for subtitle translation from ${sourceLang} to ${targetLang}.

Review the translated subtitles against the original and the provided glossary/style guide.
Identify issues only when you are confident. Do not invent problems.
Do not flag translations that faithfully render the original text, including apparent ASR errors in the source.

Focus areas:
1. Terminology consistency
2. Coherence / tone
3. Missing or inaccurate translation
4. Fluency

Terminology protection:
- When a translation uses a glossary target, do NOT flag it as fluency.
- If a glossary target itself seems wrong, use issue_type terminology_mismatch.

Severity: critical | warning | info
When done, call submit_qa_report with issues array (or []).
Each issue: {severity, index, issue_type, original_text, translated_text, suggestion}.
`;
}

export async function runWindowQaAgent(options: {
  segments: TranscriptEntry[];
  translations: WindowTranslation[];
  glossary: GlossaryEntry[];
  styleGuide: string;
  config: TranslationConfig;
  signal: AbortSignal;
  maxRounds?: number;
  onTool?: AgentLoopToolHook;
}): Promise<{ issues: QaIssue[]; tokensUsed: number }> {
  const {
    segments,
    translations,
    glossary,
    styleGuide,
    config,
    signal,
    maxRounds = 16,
    onTool,
  } = options;

  const ctx: AgentToolContext = {
    transcriptEntries: segments,
  };

  const styleSection = styleGuide.trim()
    ? `STYLE GUIDE:\n${styleGuide.trim()}`
    : 'STYLE GUIDE: (none)';

  const user = `TERMINOLOGY ENFORCEMENT TABLE:
${formatGlossary(glossary)}

${styleSection}

WINDOW ORIGINAL -> TRANSLATED:
${renderPairs(segments, translations)}

Review ONLY these segments. Call submit_qa_report.
`;

  const llm = getActiveLlmConfig(config);
  const loop = await runAgentLoop({
    llm,
    systemPrompt: buildQaSystemPrompt(config.sourceLanguage, config.targetLanguage),
    userMessage: user,
    tools: QA_TOOL_SCHEMAS,
    ctx,
    signal,
    maxRounds,
    temperature: 0.2,
    submitToolName: 'submit_qa_report',
    submitInstruction: 'with issues list (or empty if clean)',
    onTool,
  });

  const fr = loop.finalResult as { issues?: QaIssue[] } | undefined;
  return { issues: fr?.issues || [], tokensUsed: loop.tokensUsed };
}

export function hasCriticalIssues(issues: QaIssue[]): boolean {
  return issues.some((i) => String(i.severity || '').toLowerCase() === 'critical');
}

export function formatQaFeedback(issues: QaIssue[]): string {
  if (!issues.length) return '';
  return issues
    .map((i) => {
      const idx = i.index == null ? '?' : String(i.index);
      return (
        `[${i.severity}] #${idx} ${i.issue_type}: ${i.suggestion || i.translated_text || ''}` +
        (i.original_text ? ` | src: ${i.original_text}` : '')
      );
    })
    .join('\n');
}
