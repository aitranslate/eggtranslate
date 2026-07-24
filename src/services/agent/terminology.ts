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

/** Normalize glossary source key (AsrAgent: lower + strip spaces). */
export function normalizeTermKey(source: string): string {
  return String(source || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * 术语是否 grounding 在字幕正文中（对齐 AsrAgent，并按脚本分流）。
 *
 * 设计（非启发式扩写）：
 * - **纯 ASCII 词/短语**：用 ASCII 词界（`[A-Za-z0-9_]`），避免 `scale⊂upscale`，
 *   同时允许 `Acme公司` 这种「拉丁 + CJK」邻接（CJK 不算 ASCII 词字符）。
 * - **含 CJK / 假名 / 谚文 / 其它非 ASCII 字母**：无空格分词，用字面包含。
 * - **多词 ASCII 短语**：额外允许 ASR 去空格的 compact 命中。
 */
export function sourceGroundedInText(source: string, text: string): boolean {
  if (!source || !text) return false;
  const hay = text.toLowerCase();
  const needle = source.trim().toLowerCase();
  if (!needle) return false;

  if (isAsciiLexicalTerm(needle)) {
    const re = new RegExp(
      `(?<![A-Za-z0-9_])${escapeRegExp(needle)}(?![A-Za-z0-9_])`,
      'i'
    );
    if (re.test(hay)) return true;
  } else if (hay.includes(needle)) {
    return true;
  }

  // Compact fallback only for multi-word phrases (ASR may drop spaces)
  const compactHay = hay.replace(/\s+/g, '');
  const compactNeedle = needle.replace(/\s+/g, '');
  if (
    /\s/.test(needle) &&
    compactNeedle.length >= 4 &&
    compactHay.includes(compactNeedle)
  ) {
    return true;
  }
  return false;
}

/** 仅 ASCII 字母数字与常见连接符/空白 — 走词界；否则走字面包含 */
export function isAsciiLexicalTerm(term: string): boolean {
  const t = String(term || '').trim();
  if (!t) return false;
  return /^[a-z0-9][a-z0-9\s\-_'.()]*$/i.test(t);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeEntry(
  src: string,
  tgt: string,
  note = ''
): GlossaryEntry | null {
  const source = String(src || '').trim();
  const target = String(tgt || '').trim();
  if (!source || !target) return null;
  const n = String(note || '').trim().slice(0, 200);
  return n ? { source, target, note: n } : { source, target };
}

/** Expand "A (B)" only if parts ground; else keep whole if grounded. */
export function expandSourceForms(source: string, text: string): string[] {
  const src = String(source || '').trim();
  if (!src) return [];
  if (sourceGroundedInText(src, text)) return [src];
  const m = src.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    const forms: string[] = [];
    for (const part of [m[1].trim(), m[2].trim()]) {
      if (part && sourceGroundedInText(part, text)) forms.push(part);
    }
    if (forms.length) return forms;
  }
  return [];
}

/** Keep only rows whose source can fire on real subtitle text. */
export function groundGlossaryForTranslation(
  glossary: GlossaryEntry[],
  transcriptText: string
): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const g of glossary || []) {
    if (!g) continue;
    const src = String(g.source || '').trim();
    const tgt = String(g.target || '').trim();
    const note = g.note || '';
    if (!src || !tgt) continue;
    for (const form of expandSourceForms(src, transcriptText)) {
      const key = normalizeTermKey(form);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = normalizeEntry(form, tgt, note);
      if (entry) out.push(entry);
    }
  }
  return out;
}

/**
 * Literal identity surfaces for a user source (case variants only).
 * Not semantic expansion — Phase 2 adds LLM expand separately.
 */
export function literalUserSurfaces(
  userSource: string,
  transcriptText: string
): string[] {
  const src = (userSource || '').trim();
  const text = transcriptText || '';
  if (!src || !text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (form: string) => {
    const f = form.trim();
    if (!f || !sourceGroundedInText(f, text)) return;
    const key = normalizeTermKey(f);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(f);
  };
  add(src);
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeRegExp(src)}(?![\\p{L}\\p{N}_])`,
    'giu'
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    add(m[0]);
  }
  return out;
}

export type MergeGlossaryOptions = {
  /** Full transcript plain text for grounding (required for correct merge). */
  transcriptText?: string;
  /** Force-include original user sources even if ungrounded (default false). */
  forceAllUserTerms?: boolean;
  /**
   * Precomputed user surfaces (literal + LLM expand). When set, skips redoing
   * literal_user_surfaces inside merge (Phase 2 expand path).
   */
  expandedUserRows?: GlossaryEntry[];
};

/**
 * Final glossary for translate windows (AsrAgent merge_glossary_user_priority).
 *
 * Order of authority:
 *  1) Literal user surfaces in transcript → user targets
 *  2) Grounded agent rows (same key → user target wins)
 *  3) forceAll: original user source even if ungrounded
 *
 * User candidates are NOT bulk-accepted without grounding.
 */
export function mergeGlossaryWithUserTerms(
  glossary: GlossaryEntry[],
  userTerms: Term[],
  options: MergeGlossaryOptions = {}
): GlossaryEntry[] {
  const text = options.transcriptText ?? '';
  const forceAll = Boolean(options.forceAllUserTerms);
  const groundedAgent = text
    ? groundGlossaryForTranslation(glossary, text)
    : // No transcript: keep agent rows as-is (tests / degenerate); still no dump of ungrounded user terms
      (glossary || []).filter((g) => g?.source?.trim() && g?.target?.trim());

  const userByKey = new Map<string, Term>();
  for (const t of userTerms || []) {
    const key = normalizeTermKey(t.original || '');
    if (key && !userByKey.has(key)) userByKey.set(key, t);
  }

  const merged: GlossaryEntry[] = [];
  const seen = new Set<string>();

  const addRow = (src: string, tgt: string, note: string) => {
    const key = normalizeTermKey(src);
    if (!key || seen.has(key)) return;
    const entry = normalizeEntry(src, tgt, note);
    if (!entry) return;
    seen.add(key);
    merged.push(entry);
  };

  // 1) User surfaces first (pre-expanded or literal-only)
  if (options.expandedUserRows?.length) {
    for (const g of options.expandedUserRows) {
      addRow(g.source, g.target, g.note || '');
    }
  } else if (text && userTerms?.length) {
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
  }

  // 2) Grounded agent rows
  for (const g of groundedAgent) {
    const src = g.source;
    const key = normalizeTermKey(src);
    if (!key || seen.has(key)) continue;
    const ut = userByKey.get(key);
    if (ut) {
      let note = ut.notes || g.note || '';
      if (note && !/user/i.test(note)) note = `${note}; user-preferred target`;
      else if (!note) note = 'user-preferred target';
      addRow(ut.original.trim() || src, ut.translation.trim(), note);
    } else {
      addRow(src, g.target, g.note || '');
    }
  }

  // 3) Original user sources if forced or still grounded and missing
  for (const [key, ut] of userByKey) {
    if (seen.has(key)) continue;
    const src = ut.original.trim();
    const tgt = ut.translation.trim();
    if (!src || !tgt) continue;
    if (forceAll || (text && sourceGroundedInText(src, text))) {
      const note =
        ut.notes ||
        (forceAll ? 'user term' : 'user term (present in transcript)');
      addRow(src, tgt, note);
    }
  }

  return merged;
}

/** Join subtitle texts for grounding (agent path only). */
export function transcriptPlainFromEntries(
  entries: Array<{ text?: string }>
): string {
  return (entries || []).map((e) => e.text || '').join('\n');
}

const RENDER_VERBS =
  '译为|译作|翻译为|统一译为|rendered as|translated as|translate as|render as|->|→|⇒|=>';
const QUOTE = `["'「」『』“”]`;

/**
 * Rewrite style_guide claims that disagree with glossary targets (AsrAgent).
 * Quoted form preferred; bare form for short claims without spaces.
 */
export function alignStyleGuideToGlossary(
  style: string,
  glossary: GlossaryEntry[] | null | undefined
): string {
  let text = (style || '').trim();
  if (!text) return '';
  const pairs: Array<{ src: string; tgt: string }> = [];
  const seen = new Set<string>();
  for (const g of glossary || []) {
    const src = String(g?.source || '').trim();
    const tgt = String(g?.target || '').trim();
    if (!src || !tgt) continue;
    const key = normalizeTermKey(src);
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ src, tgt });
  }
  pairs.sort((a, b) => b.src.length - a.src.length);
  if (!pairs.length) return text;

  for (const { src, tgt } of pairs) {
    const esc = escapeRegExp(src);
    const patQ = new RegExp(
      `(?<pre>(?<q1>${QUOTE})(?<source>${esc})\\k<q1>\\s*(?:${RENDER_VERBS})\\s*(?<q2>${QUOTE}))` +
        `(?<claimed>.+?)` +
        `\\k<q2>`,
      'gi'
    );
    text = text.replace(patQ, (full, ...args) => {
      const groups = args[args.length - 1] as
        | { pre?: string; q2?: string; claimed?: string }
        | undefined;
      if (!groups || typeof groups !== 'object' || !('claimed' in groups)) {
        return full;
      }
      const c = String(groups.claimed || '').trim();
      if (c === tgt) return full;
      return `${groups.pre || ''}${tgt}${groups.q2 || ''}`;
    });

    const patB = new RegExp(
      `(?<pre>(?<![\\w])${esc}(?![\\w])\\s*(?:译为|译作|翻译为|translated as|rendered as)\\s*)` +
        `(?<claimed>[^\\s,，。;；:：]{1,40})`,
      'gi'
    );
    text = text.replace(patB, (full, ...args) => {
      const groups = args[args.length - 1] as
        | { pre?: string; claimed?: string }
        | undefined;
      if (!groups || typeof groups !== 'object' || !('claimed' in groups)) {
        return full;
      }
      const raw = String(groups.claimed || '').trim();
      const c = raw.replace(/^["'「」『』“”]|["'「」『』“”]$/g, '');
      if (c === tgt || raw === tgt) return full;
      return `${groups.pre || ''}${tgt}`;
    });
  }
  return text;
}

/**
 * One-shot post-briefing finalize: merge (ground + user) then style align.
 * LLM expand is optional (Phase 2); pass expanded rows via pre-merged glossary later.
 */
export function finalizeAgentGlossary(
  agentGlossary: GlossaryEntry[],
  userTerms: Term[],
  styleGuide: string,
  options: MergeGlossaryOptions & { defaultStyle?: string } = {}
): { glossary: GlossaryEntry[]; styleGuide: string } {
  const glossary = mergeGlossaryWithUserTerms(agentGlossary, userTerms, options);
  const style = alignStyleGuideToGlossary(
    styleGuide || options.defaultStyle || '',
    glossary
  );
  return { glossary, styleGuide: style };
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

  const { content, tokensUsed: t0 } = await call(system, user, signal);
  let tokensUsed = t0 || 0;
  const { glossary: rawG, styleGuide } = parseTerminologyContent(content);
  const plain = transcriptPlainFromEntries(entries);
  const forceAll = Boolean(config.agentForceAllUserTerms);
  const defaultStyle = `Translate ${config.sourceLanguage} subtitles into natural ${config.targetLanguage}. Keep names consistent.`;

  let expandedUserRows: GlossaryEntry[] | undefined;
  if (config.agentExpandUserTerms !== false && userTerms.length && plain) {
    try {
      const { expandUserTerms } = await import('./expandUserTerms');
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
    } catch {
      /* literal-only merge */
    }
  }

  const finalized = finalizeAgentGlossary(rawG, userTerms, styleGuide || defaultStyle, {
    transcriptText: plain,
    forceAllUserTerms: forceAll,
    expandedUserRows,
    defaultStyle,
  });
  return {
    glossary: finalized.glossary,
    styleGuide: finalized.styleGuide || defaultStyle,
    tokensUsed,
  };
}
