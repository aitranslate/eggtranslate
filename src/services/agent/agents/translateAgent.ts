/**
 * Translation window subagent：submit_translation tool（对齐 AsrAgent）。
 * 成功后由 pipeline emit partials 以适配 Egg 流式 UI。
 */

import type { TranslationConfig } from '@/types';
import { getActiveLlmConfig } from '@/utils/llmProfiles';
import { runAgentLoop, type AgentLoopToolHook } from '../loop';
import { TRANSLATION_TOOL_SCHEMAS } from '../tools/registry';
import type { AgentToolContext, TranscriptEntry } from '../toolTypes';
import type { GlossaryEntry } from '../types';

/** Default max tool-loop rounds for translation (coverage retries are outer). */
export const DEFAULT_TRANSLATE_MAX_ROUNDS = 8;

/** Prefer forcing the only submit tool when the provider supports it. */
export function translateToolChoice(
  submitName = 'submit_translation'
): { type: 'function'; function: { name: string } } {
  return { type: 'function', function: { name: submitName } };
}

function formatEnforcement(glossary: GlossaryEntry[]): string {
  const lines = glossary
    .filter((g) => g.source && g.target)
    .map((g) => `- ${g.source} -> ${g.target}`);
  return lines.length ? lines.join('\n') : '(none)';
}

function formatNotes(glossary: GlossaryEntry[]): string {
  const lines = glossary
    .filter((g) => g.source && g.target && g.note)
    .map((g) => `- ${g.source} -> ${g.target}: ${g.note}`);
  return lines.length ? lines.join('\n') : '';
}

export function buildTranslateSystemPrompt(
  sourceLang: string,
  targetLang: string,
  glossary: GlossaryEntry[],
  styleGuide: string
): string {
  const style = styleGuide.trim()
    ? `STYLE GUIDE:\n${styleGuide.trim()}`
    : 'STYLE GUIDE: (none)';
  const notes = formatNotes(glossary);
  const notesBlock = notes
    ? `\n\nGLOSSARY NOTES (reference only — do not copy into subtitles):\n${notes}`
    : '';

  return `You are a subtitle translator. Translate the provided ${sourceLang} transcript segments into ${targetLang}.

Translation principles (信达雅):
- 信 (faithfulness): Do not add, remove, or alter the original meaning. Do not hallucinate context.
- 达 (fluency): Produce natural, readable ${targetLang} suitable for subtitles. Keep it concise.
- 雅 (elegance): Match tone, register, and speaker voice consistently throughout the video.

TERMINOLOGY ENFORCEMENT — mandatory:
When a source segment contains any source phrase listed below, you MUST use the listed target verbatim.

${formatEnforcement(glossary)}${notesBlock}

${style}

Output rules:
- One translation per required segment index; do not combine or split segments.
- No explanations or markdown outside the tool call.
- Call submit_translation covering EVERY required index.
- Prefer translations: [{index, text}, ...]. If the runtime double-encodes args, still put every index+text in the payload — the harness recovers common packaging forms; incomplete coverage is what fails.
`;
}

function renderSegs(segs: TranscriptEntry[]): string {
  return segs.map((e) => `[${e.index}] ${e.text}`).join('\n');
}

export function buildTranslateUserMessage(
  window: {
    segments: TranscriptEntry[];
    contextBefore?: TranscriptEntry[];
    contextAfter?: TranscriptEntry[];
  },
  sourceLang: string,
  targetLang: string,
  qaFeedback?: string
): string {
  const parts: string[] = [];
  if (window.contextBefore?.length) {
    parts.push(
      `=== CONTEXT BEFORE (${sourceLang}) ===\n${renderSegs(window.contextBefore)}`
    );
  }
  parts.push(
    `=== TRANSLATE THESE SEGMENTS (${sourceLang} -> ${targetLang}) ===\n${renderSegs(window.segments)}`
  );
  if (window.contextAfter?.length) {
    parts.push(
      `=== CONTEXT AFTER (${sourceLang}) ===\n${renderSegs(window.contextAfter)}`
    );
  }
  const required = window.segments.map((s) => s.index).join(', ');
  let msg =
    parts.join('\n\n') +
    `\n\nTranslate ONLY the segments under TRANSLATE THESE SEGMENTS. ` +
    `Required indices: ${required}. Call submit_translation with ALL of them.`;
  if (qaFeedback?.trim()) {
    msg += `\n\n=== QA / COVERAGE FEEDBACK (fix these) ===\n${qaFeedback.trim()}`;
  }
  return msg;
}

export type WindowTranslation = { index: number; text: string };

export async function runTranslateWindowAgent(options: {
  window: {
    windowIndex: number;
    segments: TranscriptEntry[];
    contextBefore?: TranscriptEntry[];
    contextAfter?: TranscriptEntry[];
  };
  glossary: GlossaryEntry[];
  styleGuide: string;
  config: TranslationConfig;
  signal: AbortSignal;
  qaFeedback?: string;
  maxRounds?: number;
  onTool?: AgentLoopToolHook;
}): Promise<{ translations: WindowTranslation[]; tokensUsed: number }> {
  const {
    window: win,
    glossary,
    styleGuide,
    config,
    signal,
    qaFeedback,
    maxRounds = DEFAULT_TRANSLATE_MAX_ROUNDS,
    onTool,
  } = options;

  const expected = new Set(win.segments.map((s) => s.index));
  const indexToSource: Record<number, string> = {};
  for (const s of win.segments) indexToSource[s.index] = s.text;

  const ctx: AgentToolContext = {
    transcriptEntries: win.segments,
    expectedIndices: expected,
    translateWindow: { windowIndex: win.windowIndex, segments: win.segments },
    indexToSource,
  };

  const llm = getActiveLlmConfig(config);
  const system = buildTranslateSystemPrompt(
    config.sourceLanguage,
    config.targetLanguage,
    glossary,
    styleGuide
  );
  const user = buildTranslateUserMessage(
    win,
    config.sourceLanguage,
    config.targetLanguage,
    qaFeedback
  );

  const loop = await runAgentLoop({
    llm,
    systemPrompt: system,
    userMessage: user,
    tools: TRANSLATION_TOOL_SCHEMAS,
    ctx,
    signal,
    maxRounds,
    temperature: 0.25,
    submitToolName: 'submit_translation',
    submitInstruction: 'with complete {index,text} list for every required index',
    toolChoice: translateToolChoice('submit_translation'),
    onTool,
  });

  const fr = loop.finalResult as { translations?: WindowTranslation[] } | undefined;
  const translations = fr?.translations || [];
  return { translations, tokensUsed: loop.tokensUsed };
}
