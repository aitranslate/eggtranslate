/**
 * Terminology Agent：tool loop + submit_result（对齐 AsrAgent briefing）。
 * 长片：字符预算分窗 → union glossary + merge style → expand → finalize。
 */

import type { Term, TranslationConfig } from '@/types';
import { getActiveLlmConfig } from '@/utils/llmProfiles';
import { expandUserTerms } from '../expandUserTerms';
import { runAgentLoop, type AgentLoopToolHook } from '../loop';
import { BRIEFING_TOOL_SCHEMAS } from '../tools/registry';
import type { AgentToolContext, TranscriptEntry } from '../toolTypes';
import type { GlossaryEntry } from '../types';
import {
  finalizeAgentGlossary,
  parseTerminologyContent,
  transcriptPlainFromEntries,
} from '../terminology';
import {
  BRIEFING_WINDOW_CHARS,
  mergeStyleGuides,
  splitBriefingEntryWindows,
  unionGlossaries,
} from '../windows';

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

function sampleUserMessage(
  entries: TranscriptEntry[],
  sourceLang: string,
  targetLang: string,
  windowLabel?: string
): string {
  const plain = entries.map((e) => `[${e.index}] ${e.text}`).join('\n');
  const winNote = windowLabel ? ` (${windowLabel})` : '';
  return (
    `Analyze this ${sourceLang} transcript${winNote} (${entries.length} segments). ` +
    `Extract glossary + style_guide for ${targetLang} translation. ` +
    `Do not translate the full transcript.\n\n` +
    `=== TRANSCRIPT ===\n${plain}\n=== END TRANSCRIPT ===`
  );
}

async function runOneBriefingWindow(options: {
  entries: TranscriptEntry[];
  fullTranscriptForTools: TranscriptEntry[];
  config: TranslationConfig;
  userTerms: Term[];
  title: string;
  signal: AbortSignal;
  maxRounds: number;
  onTool?: AgentLoopToolHook;
  windowLabel?: string;
  /** Share soft-nudge / web budget across multi-window briefing */
  sharedCtx?: Pick<
    AgentToolContext,
    'webSearchCount' | 'softWebNudgeFired' | 'maxWebSearches' | 'softWebNudge'
  >;
  onWebSearchCount?: (n: number) => void;
}): Promise<{
  glossary: GlossaryEntry[];
  styleGuide: string;
  tokensUsed: number;
  webSearchCount: number;
}> {
  const {
    entries,
    fullTranscriptForTools,
    config,
    userTerms,
    title,
    signal,
    maxRounds,
    onTool,
    windowLabel,
    sharedCtx,
    onWebSearchCount,
  } = options;
  const llm = getActiveLlmConfig(config);
  const ctx: AgentToolContext = {
    // Tools search the full transcript; the prompt only shows this window.
    transcriptEntries: fullTranscriptForTools,
    todos: [],
    webSearchCount: sharedCtx?.webSearchCount ?? 0,
    maxWebSearches:
      sharedCtx?.maxWebSearches ??
      (typeof config.agentMaxWebSearches === 'number'
        ? Math.max(0, config.agentMaxWebSearches)
        : 3),
    softWebNudge: sharedCtx?.softWebNudge ?? config.agentSoftWebNudge !== false,
    softWebNudgeFired: sharedCtx?.softWebNudgeFired ?? false,
    title,
  };

  const system = buildSystemPrompt(
    title,
    config.sourceLanguage,
    config.targetLanguage,
    formatUserTermsBlock(userTerms)
  );
  const user = sampleUserMessage(
    entries,
    config.sourceLanguage,
    config.targetLanguage,
    windowLabel
  );

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
    onTool: async (e) => {
      await onTool?.(e);
      if (sharedCtx) {
        sharedCtx.webSearchCount = ctx.webSearchCount ?? 0;
        sharedCtx.softWebNudgeFired = Boolean(ctx.softWebNudgeFired);
      }
      if (e.phase === 'end' && e.name === 'web_search') {
        onWebSearchCount?.(ctx.webSearchCount ?? 0);
      }
    },
  });

  if (sharedCtx) {
    sharedCtx.webSearchCount = ctx.webSearchCount ?? 0;
    sharedCtx.softWebNudgeFired = ctx.softWebNudgeFired ?? false;
  }

  let glossary: GlossaryEntry[] = [];
  let styleGuide = '';
  const fr = loop.finalResult as
    | { glossary?: GlossaryEntry[]; style_guide?: string }
    | undefined;
  if (fr && (fr.glossary || fr.style_guide)) {
    glossary = fr.glossary || [];
    styleGuide = fr.style_guide || '';
  }

  return {
    glossary,
    styleGuide,
    tokensUsed: loop.tokensUsed,
    webSearchCount: ctx.webSearchCount ?? 0,
  };
}

export async function runTerminologyToolAgent(options: {
  entries: TranscriptEntry[];
  config: TranslationConfig;
  userTerms: Term[];
  title: string;
  signal: AbortSignal;
  maxRounds?: number;
  onTool?: AgentLoopToolHook;
  onBriefingProgress?: (p: {
    current: number;
    total: number;
    detail?: string;
  }) => void | Promise<void>;
  onWebSearchCount?: (n: number) => void;
}): Promise<{
  glossary: GlossaryEntry[];
  styleGuide: string;
  tokensUsed: number;
  webSearchCount: number;
}> {
  const {
    entries,
    config,
    userTerms,
    title,
    signal,
    maxRounds = 30,
    onTool,
    onBriefingProgress,
    onWebSearchCount,
  } = options;

  const windows = splitBriefingEntryWindows(entries, BRIEFING_WINDOW_CHARS, 2);
  const multi = windows.length > 1;
  const sharedCtx = {
    webSearchCount: 0,
    softWebNudgeFired: false,
    maxWebSearches:
      typeof config.agentMaxWebSearches === 'number'
        ? Math.max(0, config.agentMaxWebSearches)
        : 3,
    softWebNudge: config.agentSoftWebNudge !== false,
  };

  const gloParts: GlossaryEntry[][] = [];
  const styles: string[] = [];
  let tokensUsed = 0;
  const perWindowRounds = multi ? Math.min(maxRounds, 24) : maxRounds;

  for (let wi = 0; wi < windows.length; wi++) {
    if (onBriefingProgress) {
      await onBriefingProgress({
        current: wi + 1,
        total: windows.length,
        detail: multi
          ? `术语分析 ${wi + 1}/${windows.length} 窗…`
          : '术语分析中…',
      });
    }
    const win = windows[wi];
    const r = await runOneBriefingWindow({
      entries: win,
      fullTranscriptForTools: entries,
      config,
      userTerms,
      title,
      signal,
      maxRounds: perWindowRounds,
      onTool,
      onWebSearchCount,
      windowLabel: multi ? `window ${wi + 1}/${windows.length}` : undefined,
      sharedCtx,
    });
    onWebSearchCount?.(sharedCtx.webSearchCount);
    gloParts.push(r.glossary);
    if (r.styleGuide.trim()) styles.push(r.styleGuide.trim());
    tokensUsed += r.tokensUsed;
  }

  let glossary = unionGlossaries(gloParts);
  let styleGuide = mergeStyleGuides(styles);

  const plain = transcriptPlainFromEntries(entries);
  const defaultStyle = `Translate ${config.sourceLanguage} subtitles into natural ${config.targetLanguage}. Keep names and recurring terms consistent.`;

  // User-term expand (literal + optional LLM) then finalize ground/align
  const expandOn = config.agentExpandUserTerms !== false;
  let expandedUserRows: GlossaryEntry[] | undefined;
  if (expandOn && userTerms.length && plain) {
    const llm = getActiveLlmConfig(config);
    const exp = await expandUserTerms({
      userTerms,
      transcriptText: plain,
      llm,
      signal,
      useLlm: true,
    });
    expandedUserRows = exp.rows;
    tokensUsed += exp.tokensUsed;
  }

  const finalized = finalizeAgentGlossary(
    glossary,
    userTerms,
    styleGuide || defaultStyle,
    {
      transcriptText: plain,
      forceAllUserTerms: Boolean(config.agentForceAllUserTerms),
      expandedUserRows,
      defaultStyle,
    }
  );

  return {
    glossary: finalized.glossary,
    styleGuide: finalized.styleGuide || defaultStyle,
    tokensUsed,
    webSearchCount: sharedCtx.webSearchCount,
  };
}

/** 无 tool 的单次抽取（tool loop 失败时的兜底） */
export { parseTerminologyContent, finalizeAgentGlossary };
