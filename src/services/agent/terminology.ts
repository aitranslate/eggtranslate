/**
 * 术语阶段：从字幕抽取 glossary + style_guide（单次 structured LLM，可后续换成 tool loop）。
 */

import { jsonrepair } from 'jsonrepair';
import type { Term, TranslationConfig } from '@/types';
import { callLLM } from '@/utils/llmApi';
import { getActiveLlmConfig } from '@/utils/llmProfiles';
import type { GlossaryEntry } from './types';

export type TerminologyResult = {
  glossary: GlossaryEntry[];
  styleGuide: string;
  tokensUsed: number;
};

function sampleTranscript(entries: { text: string }[], maxChars = 12000): string {
  const lines: string[] = [];
  let used = 0;
  for (let i = 0; i < entries.length; i++) {
    const line = `${i + 1}. ${(entries[i].text || '').trim()}`;
    if (!line.slice(3).trim()) continue;
    if (used + line.length + 1 > maxChars) {
      lines.push(`…(${entries.length - i} more segments omitted)`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

export function buildTerminologyPrompts(
  entries: { text: string }[],
  sourceLanguage: string,
  targetLanguage: string,
  userTerms: Term[],
  title: string
): { system: string; user: string } {
  const userBlock =
    userTerms.length > 0
      ? userTerms
          .map((t) =>
            t.notes
              ? `${t.original} -> ${t.translation} // ${t.notes}`
              : `${t.original} -> ${t.translation}`
          )
          .join('\n')
      : '(none)';

  const system = `You extract a translation glossary and style guide for subtitles.
Domain-agnostic: no industry-specific recipes.
Output ONLY valid JSON:
{
  "glossary": [{"source":"...","target":"...","note":"..."}],
  "style_guide": "2-4 sentences for the translator"
}
Rules:
- source must be a surface form that actually appears (or clearly matches) the transcript.
- Prefer names, recurring jargon, ambiguous terms, tone keywords.
- Keep glossary concise (max ~40 entries). Prefer quality over coverage.
- style_guide is for ${targetLanguage} translation of ${sourceLanguage} speech.
- User terms are candidates (not all must be used); keep user's target when relevant.`;

  const user = `Title: ${title || 'untitled'}
Source language: ${sourceLanguage}
Target language: ${targetLanguage}

User term candidates:
${userBlock}

Transcript segments:
${sampleTranscript(entries)}

Return JSON only.`;

  return { system, user };
}

export function parseTerminologyContent(content: string): {
  glossary: GlossaryEntry[];
  styleGuide: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonrepair(content || '{}'));
  } catch {
    return { glossary: [], styleGuide: '' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { glossary: [], styleGuide: '' };
  }
  const obj = parsed as Record<string, unknown>;
  const styleGuide =
    typeof obj.style_guide === 'string'
      ? obj.style_guide.trim()
      : typeof obj.styleGuide === 'string'
        ? obj.styleGuide.trim()
        : '';

  const raw = Array.isArray(obj.glossary) ? obj.glossary : [];
  const glossary: GlossaryEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const source = String(r.source ?? r.original ?? '').trim();
    const target = String(r.target ?? r.translation ?? '').trim();
    if (!source || !target) continue;
    const note = r.note ?? r.notes;
    glossary.push({
      source,
      target,
      note: typeof note === 'string' && note.trim() ? note.trim() : undefined,
    });
  }
  return { glossary, styleGuide };
}

/** 用户术语优先合并进 glossary */
export function mergeGlossaryWithUserTerms(
  glossary: GlossaryEntry[],
  userTerms: Term[]
): GlossaryEntry[] {
  const bySource = new Map<string, GlossaryEntry>();
  for (const g of glossary) {
    bySource.set(g.source.toLowerCase(), g);
  }
  for (const t of userTerms) {
    const key = t.original.trim().toLowerCase();
    if (!key) continue;
    bySource.set(key, {
      source: t.original.trim(),
      target: t.translation.trim(),
      note: t.notes,
    });
  }
  return [...bySource.values()];
}

/** 注入批译 prompt 的 terms 文本块 */
export function formatAgentTermsBlock(
  glossary: GlossaryEntry[],
  styleGuide: string,
  relevantUserTerms: Term[]
): string {
  const parts: string[] = [];
  if (styleGuide.trim()) {
    parts.push(`### Style guide\n${styleGuide.trim()}`);
  }
  const lines: string[] = [];
  for (const g of glossary) {
    lines.push(
      g.note ? `${g.source} -> ${g.target} // ${g.note}` : `${g.source} -> ${g.target}`
    );
  }
  for (const t of relevantUserTerms) {
    const exists = glossary.some(
      (g) => g.source.toLowerCase() === t.original.toLowerCase()
    );
    if (exists) continue;
    lines.push(
      t.notes
        ? `${t.original} -> ${t.translation} // ${t.notes}`
        : `${t.original} -> ${t.translation}`
    );
  }
  if (lines.length) {
    parts.push(`### Terminology (format: original -> translation // notes)\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
}

export async function runTerminologyAgent(
  entries: { text: string }[],
  config: TranslationConfig,
  userTerms: Term[],
  title: string,
  signal: AbortSignal,
  callLlm?: (
    system: string,
    user: string,
    signal: AbortSignal
  ) => Promise<{ content: string; tokensUsed: number }>
): Promise<TerminologyResult> {
  const { system, user } = buildTerminologyPrompts(
    entries,
    config.sourceLanguage,
    config.targetLanguage,
    userTerms,
    title
  );

  const call =
    callLlm ??
    (async (sys, usr, sig) => {
      const llm = getActiveLlmConfig(config);
      return callLLM(
        llm,
        [
          { role: 'system', content: sys },
          { role: 'user', content: usr },
        ],
        { signal: sig, temperature: 0.2, maxRetries: 1 }
      );
    });

  const { content, tokensUsed } = await call(system, user, signal);
  const { glossary: rawG, styleGuide } = parseTerminologyContent(content);
  const glossary = mergeGlossaryWithUserTerms(rawG, userTerms);
  return {
    glossary,
    styleGuide:
      styleGuide ||
      `Translate ${config.sourceLanguage} subtitles into natural ${config.targetLanguage}. Keep names consistent.`,
    tokensUsed: tokensUsed || 0,
  };
}
