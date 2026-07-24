/**
 * LLM user-term surface expansion (AsrAgent expand_user_terms).
 * Model judges meaning; harness re-grounds every surface. No acronym heuristics.
 */

import { jsonrepair } from 'jsonrepair';
import type { LLMConfig, Term } from '@/types';
import { callLLM } from '@/utils/llmApi';
import { logger } from '@/utils/logger';
import {
  literalUserSurfaces,
  normalizeTermKey,
  sourceGroundedInText,
} from './terminology';
import type { GlossaryEntry } from './types';

function normalizeEntry(
  src: string,
  tgt: string,
  note = ''
): GlossaryEntry | null {
  const source = src.trim();
  const target = tgt.trim();
  if (!source || !target) return null;
  const n = note.trim().slice(0, 200);
  return n ? { source, target, note: n } : { source, target };
}

/**
 * Map user terms onto transcript surfaces → user targets.
 * 1) Literal identity (case variants)
 * 2) Optional LLM semantic expand (when useLlm + credentials)
 */
export async function expandUserTerms(options: {
  userTerms: Term[];
  transcriptText: string;
  llm?: LLMConfig | null;
  signal?: AbortSignal;
  useLlm?: boolean;
}): Promise<{ rows: GlossaryEntry[]; tokensUsed: number }> {
  const { userTerms, transcriptText, llm, signal, useLlm = true } = options;
  const text = transcriptText || '';
  if (!userTerms?.length || !text) return { rows: [], tokensUsed: 0 };

  const rows: GlossaryEntry[] = [];
  const seen = new Set<string>();

  const addRow = (src: string, tgt: string, note: string) => {
    const key = normalizeTermKey(src);
    if (!key || seen.has(key)) return;
    const entry = normalizeEntry(src, tgt, note);
    if (!entry) return;
    seen.add(key);
    rows.push(entry);
  };

  for (const t of userTerms) {
    const src = (t.original || '').trim();
    const tgt = (t.translation || '').trim();
    if (!src || !tgt) continue;
    for (const form of literalUserSurfaces(src, text)) {
      let note = t.notes || '';
      if (note && !/user/i.test(note)) note = `${note}; user-term surface`;
      else if (!note) note = 'user-term surface';
      addRow(form, tgt, note);
    }
  }

  let tokensUsed = 0;
  const canLlm =
    useLlm &&
    llm &&
    (llm.apiKey || !llm.requiresKey) &&
    llm.baseURL &&
    llm.model;

  if (canLlm) {
    try {
      const llmRows = await llmExpandUserTerms(
        userTerms,
        text,
        llm!,
        signal
      );
      tokensUsed += llmRows.tokensUsed;
      for (const e of llmRows.rows) {
        addRow(e.source, e.target, e.note || 'user-term expansion');
      }
    } catch (e) {
      logger.info(
        '[user_term_expand] LLM expand skipped:',
        e instanceof Error ? e.message : e
      );
    }
  }

  return { rows, tokensUsed };
}

async function llmExpandUserTerms(
  userTerms: Term[],
  transcriptText: string,
  llm: LLMConfig,
  signal?: AbortSignal
): Promise<{ rows: GlossaryEntry[]; tokensUsed: number }> {
  let text = transcriptText;
  if (text.length > 24000) {
    text = `${text.slice(0, 24000)}\n...[truncated for expand]...`;
  }

  const termsLines = userTerms
    .map((t) => {
      const note = t.notes ? ` (${t.notes})` : '';
      return `- source=${JSON.stringify(t.original)} target=${JSON.stringify(t.translation)}${note}`;
    })
    .join('\n');

  const prompt =
    'You map user glossary terms onto surface forms that appear IN the transcript.\n' +
    'You are the judge of *meaning* (abbreviation vs full form, ASR variants, ' +
    'synonyms of the same concept). Do not use mechanical initial-letter rules.\n' +
    'Domain-agnostic: use only the transcript + the user source/target pairs.\n\n' +
    'For each user term, list exact phrases from the transcript that refer to the ' +
    'SAME concept/entity as the user source. ' +
    'Every surface MUST appear verbatim in the transcript (copy spelling exactly).\n' +
    'Do not invent phrases. Do not map unrelated words that merely share initials.\n' +
    'If no surfaces exist for a user term, return an empty list for it.\n\n' +
    `USER TERMS:\n${termsLines}\n\n` +
    `TRANSCRIPT:\n${text}\n\n` +
    'Return JSON only:\n' +
    '{"expansions":[{"user_source":"...","surfaces":["..."]}]}';

  const result = await callLLM(
    llm,
    [{ role: 'user', content: prompt }],
    { signal, temperature: 0.1, maxRetries: 1 }
  );

  let data: unknown;
  try {
    data = JSON.parse(jsonrepair(result.content || '{}'));
  } catch {
    return { rows: [], tokensUsed: result.tokensUsed || 0 };
  }
  if (!data || typeof data !== 'object') {
    return { rows: [], tokensUsed: result.tokensUsed || 0 };
  }

  const byUser = new Map<string, string>();
  const noteBy = new Map<string, string>();
  for (const t of userTerms) {
    const k = normalizeTermKey(t.original);
    if (k && !byUser.has(k)) {
      byUser.set(k, t.translation.trim());
      noteBy.set(k, t.notes || '');
    }
  }

  const rows: GlossaryEntry[] = [];
  const expansions =
    (data as { expansions?: unknown }).expansions || [];
  if (!Array.isArray(expansions)) {
    return { rows: [], tokensUsed: result.tokensUsed || 0 };
  }

  for (const item of expansions) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const us = String(o.user_source || '').trim();
    let uk = normalizeTermKey(us);
    if (!byUser.has(uk)) {
      for (const t of userTerms) {
        if (
          normalizeTermKey(t.original) === uk ||
          t.original.toLowerCase() === us.toLowerCase()
        ) {
          uk = normalizeTermKey(t.original);
          break;
        }
      }
    }
    if (!byUser.has(uk)) continue;
    const tgt = byUser.get(uk)!;
    const baseNote = noteBy.get(uk) || '';
    const surfaces = o.surfaces;
    if (!Array.isArray(surfaces)) continue;
    for (const surfRaw of surfaces) {
      const surf = String(surfRaw || '').trim();
      if (!surf || !sourceGroundedInText(surf, transcriptText)) continue;
      let note = baseNote;
      if (note && !/user/i.test(note)) note = `${note}; user-term expansion`;
      else if (!note) note = 'user-term expansion';
      const entry = normalizeEntry(surf, tgt, note);
      if (entry) rows.push(entry);
    }
  }

  return { rows, tokensUsed: result.tokensUsed || 0 };
}
