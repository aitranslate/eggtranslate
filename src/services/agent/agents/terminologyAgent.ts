/**
 * Terminology Agent：tool loop + submit_result（对齐 AsrAgent briefing）。
 */

import type { Term, TranslationConfig } from '@/types';
import { getActiveLlmConfig } from '@/utils/llmProfiles';
import { runAgentLoop, type AgentLoopToolHook } from '../loop';
import { BRIEFING_TOOL_SCHEMAS } from '../tools/registry';
import type { AgentToolContext, TranscriptEntry } from '../toolTypes';
import type { GlossaryEntry } from '../types';
import { mergeGlossaryWithUserTerms, parseTerminologyContent } from '../terminology';

function formatUserTermsBlock(userTerms: Term[]): string {
  if (!userTerms.length) return '(none)';
  return userTerms
    .map((t) =>
      t.notes
        ? `${t.original} -> ${t.translation} // ${t.notes}`
        : `${t.original} -> ${t.translation}`
    )
    .join('\n');
}

function buildSystemPrompt(
  title: string,
  sourceLang: string,
  targetLang: string,
  userTermsBlock: string
): string {
  return `You are a terminology briefing agent for a subtitle translation pipeline.
Downstream translators will receive your glossary as an enforced term table and your style guide as background. Maximize translation consistency and fluency — do NOT translate the full transcript.

TITLE: ${title}
LANG: ${sourceLang} → ${targetLang}

USER TERMS (optional candidates; include only if relevant; may be noisy — not a dump):
${userTermsBlock}

Glossary rules (critical for enforcement):
- source must appear in THIS transcript (exact phrase as written). You judge meaning: if a user term's concept appears under another surface (full form, abbreviation, ASR variant), add that surface → user target. Do not invent links the transcript cannot support.
- Same concept, multiple surfaces → one row per surface, same target. No invented sources; no "A (B)" unless that exact string appears.
- Prefer names, proper nouns, abbreviations, recurring technical phrases.
- target: consistent rendering in ${targetLang} (or keep source form when conventional); user target wins when you include a user concept.
- note: optional, short. When a concept has multiple surfaces, put a brief note on the primary/full-form row listing the variants you identified — translators use this for context.

Style guide rules:
- ONE plain string, 2–4 sentences, written to guide a ${targetLang} translator.
- Cover tone/register, how to treat names/abbreviations, and any consistency traps for THIS video.

Tools: count/search/verify/web_search/update_todo as needed.
When done: submit_result with glossary + style_guide only.
`;
}

function sampleUserMessage(entries: TranscriptEntry[], sourceLang: string, targetLang: string): string {
  const plain = entries
    .map((e) => `[${e.index}] ${e.text}`)
    .join('\n')
    .slice(0, 14000);
  return (
    `Analyze this ${sourceLang} transcript (${entries.length} segments). ` +
    `Extract glossary + style_guide for ${targetLang} translation. ` +
    `Do not translate the full transcript.\n\n` +
    `=== TRANSCRIPT ===\n${plain}\n=== END TRANSCRIPT ===`
  );
}

export async function runTerminologyToolAgent(options: {
  entries: TranscriptEntry[];
  config: TranslationConfig;
  userTerms: Term[];
  title: string;
  signal: AbortSignal;
  maxRounds?: number;
  onTool?: AgentLoopToolHook;
}): Promise<{ glossary: GlossaryEntry[]; styleGuide: string; tokensUsed: number }> {
  const { entries, config, userTerms, title, signal, maxRounds = 30, onTool } = options;
  const llm = getActiveLlmConfig(config);
  const ctx: AgentToolContext = {
    transcriptEntries: entries,
    todos: [],
    webSearchCount: 0,
    maxWebSearches: 5,
    title,
  };

  const system = buildSystemPrompt(
    title,
    config.sourceLanguage,
    config.targetLanguage,
    formatUserTermsBlock(userTerms)
  );
  const user = sampleUserMessage(entries, config.sourceLanguage, config.targetLanguage);

  const loop = await runAgentLoop({
    llm,
    systemPrompt: system,
    userMessage: user,
    tools: BRIEFING_TOOL_SCHEMAS,
    ctx,
    signal,
    maxRounds,
    temperature: 0.3,
    submitToolName: 'submit_result',
    submitInstruction: 'with glossary + style_guide',
    onTool,
  });

  let glossary: GlossaryEntry[] = [];
  let styleGuide = '';

  const fr = loop.finalResult as
    | { glossary?: GlossaryEntry[]; style_guide?: string }
    | undefined;
  if (fr && (fr.glossary || fr.style_guide)) {
    glossary = fr.glossary || [];
    styleGuide = fr.style_guide || '';
  }

  // 未 submit 时不抛死：留给 pipeline 用单次 LLM 兜底（可选）
  glossary = mergeGlossaryWithUserTerms(glossary, userTerms);
  if (!styleGuide.trim()) {
    styleGuide = `Translate ${config.sourceLanguage} subtitles into natural ${config.targetLanguage}. Keep names and recurring terms consistent.`;
  }

  return { glossary, styleGuide, tokensUsed: loop.tokensUsed };
}

/** 无 tool 的单次抽取（tool loop 失败时的兜底，仍合并用户术语） */
export { parseTerminologyContent, mergeGlossaryWithUserTerms };
