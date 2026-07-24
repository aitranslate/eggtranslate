/**
 * Tool schemas + handlers（对齐 AsrAgent tools 注册表，web 在浏览器侧 stub）。
 */

import type { LLMToolSchema } from '@/utils/llmApi';
import {
  asGlossary,
  coerceToolInt,
  inferToolOutcome,
  normalizeTranslationRows,
  parseToolArgs,
  toolDone,
  toolErr,
  toolOk,
  toolReject,
  type AgentToolContext,
  type ToolHandler,
  type ToolOutcome,
  type ToolResult,
} from '../toolTypes';
import { DEFAULT_MAX_SEARCHES, parallelWebSearch } from './parallelSearch';

const coerceInt = coerceToolInt;

// ── transcript ──────────────────────────────────────────

const searchTranscript: ToolHandler = (params, ctx) => {
  const pattern = String(params.pattern ?? params.query ?? '').trim();
  if (!pattern) {
    return toolErr("'pattern' is required.", '{"pattern":"phrase","ignore_case":true}');
  }
  const entries = ctx.transcriptEntries || [];
  if (!entries.length) return toolErr('no transcript loaded in harness context.');

  let contextChars = 60;
  try {
    contextChars = Math.max(0, Math.min(200, Number(params.context_chars ?? 60)));
  } catch {
    /* keep default */
  }
  const ignoreCase = params.ignore_case !== false;
  const needle = ignoreCase ? pattern.toLowerCase() : pattern;
  const hits: string[] = [];
  let total = 0;
  const cap = 50;

  for (const e of entries) {
    const text = e.text || '';
    const hay = ignoreCase ? text.toLowerCase() : text;
    let start = 0;
    while (true) {
      const idx = hay.indexOf(needle, start);
      if (idx < 0) break;
      total++;
      if (hits.length < cap) {
        const s = Math.max(0, idx - contextChars);
        const ed = Math.min(text.length, idx + pattern.length + contextChars);
        const snippet = text.slice(s, ed);
        hits.push(
          `[#${e.index} ${e.start || ''}] ${s > 0 ? '[...]' : ''}${snippet}${ed < text.length ? '[...]' : ''}`
        );
      }
      start = idx + Math.max(1, pattern.length);
    }
  }
  if (total === 0) {
    return toolOk(
      `No matches for '${pattern}' in transcript (${entries.length} segments, ignore_case=${ignoreCase}).`
    );
  }
  return toolOk(
    `Found ${total} match(es) for '${pattern}' (showing ${hits.length}${total > cap ? ', capped' : ''}):\n` +
      hits.join('\n')
  );
};

const countTranscript: ToolHandler = (params, ctx) => {
  let terms = params.terms ?? params.phrases ?? [];
  if (typeof terms === 'string') terms = [terms];
  if (!Array.isArray(terms) || !terms.length) {
    return toolErr("'terms' must be a non-empty list.", '{"terms":["foo","bar"]}');
  }
  const entries = ctx.transcriptEntries || [];
  if (!entries.length) return toolErr('no transcript loaded.');
  const ignoreCase = params.ignore_case !== false;
  const cleaned = (terms as unknown[])
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map((t) => t.trim())
    .slice(0, 40);
  if (!cleaned.length) return toolErr("'terms' contained no non-empty strings.");

  const lines: string[] = [];
  for (const term of cleaned) {
    const needle = ignoreCase ? term.toLowerCase() : term;
    let count = 0;
    for (const e of entries) {
      const hay = ignoreCase ? (e.text || '').toLowerCase() : e.text || '';
      let i = 0;
      while (true) {
        const j = hay.indexOf(needle, i);
        if (j < 0) break;
        count++;
        i = j + Math.max(1, needle.length);
      }
    }
    lines.push(`- ${term}: ${count}`);
  }
  return toolOk(`Frequency counts (ignore_case=${ignoreCase}):\n${lines.join('\n')}`);
};

const verifyTerm: ToolHandler = (params) => {
  const term = String(params.term ?? '').trim();
  const hypothesis = String(params.hypothesis ?? '').trim();
  const context = String(params.context ?? '').trim();
  if (!term || !hypothesis) {
    return toolErr(
      'term and hypothesis required.',
      '{"term":"...","hypothesis":"...","context":"..."}'
    );
  }
  return toolOk(
    `Recorded verify_term for self-check (harness does not judge semantics).\n` +
      `term=${term}\nhypothesis=${hypothesis}\ncontext=${context.slice(0, 400)}`
  );
};

const updateTodo: ToolHandler = (params, ctx) => {
  const items = params.items;
  if (!Array.isArray(items)) {
    return toolErr('items must be an array of {id?, text, status}.');
  }
  const board = (ctx.todos ||= []);
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const it = raw as Record<string, unknown>;
    const text = String(it.text ?? '').trim();
    const status = String(it.status ?? 'pending').trim();
    const id = String(it.id ?? `t${board.length + 1}`);
    if (!text) continue;
    const idx = board.findIndex((b) => b.id === id);
    const row = { id, text, status };
    if (idx >= 0) board[idx] = row;
    else board.push(row);
  }
  const render = board.map((b) => `[${b.status}] ${b.id}: ${b.text}`).join('\n');
  return toolOk(`Todo board updated:\n${render || '(empty)'}`);
};

/** 对齐 AsrAgent：Parallel AI MCP，免费无 Key；预算默认 5 次/run */
const webSearch: ToolHandler = async (params, ctx) => {
  const query = String(params.query ?? '').trim();
  if (!query) return toolErr("'query' is required.", '{"query":"short focused phrase"}');

  const max = ctx.maxWebSearches ?? DEFAULT_MAX_SEARCHES;
  const used = ctx.webSearchCount ?? 0;
  if (max <= 0) {
    return toolOk(
      '[web_search disabled for this run]. Use transcript tools + knowledge instead.'
    );
  }
  if (used >= max) {
    return toolOk(
      `[web_search budget exhausted] ${used}/${max} searches used. ` +
        'Reason from transcript + title + knowledge instead.'
    );
  }

  ctx.webSearchCount = used + 1;
  const result = await parallelWebSearch(query, {
    sessionId: `eggtranslate_${(ctx.title || 'session').slice(0, 40)}`,
  });

  if (result.ok === false) {
    return toolOk(
      `[web_search failed: ${result.error}]. ` +
        'Reason from transcript + title + knowledge instead.'
    );
  }
  return toolOk(`[web_search '${query}']\n${result.text}`);
};

const submitResult: ToolHandler = (params, ctx) => {
  const p = { ...params };
  if (p.glossary === undefined && p.terms !== undefined) p.glossary = p.terms;
  if (p.style_guide === undefined && p.style !== undefined) p.style_guide = p.style;

  if (p.glossary === undefined && p.style_guide === undefined) {
    return toolErr(
      'submit_result needs glossary (list) and style_guide (string).',
      '{"glossary":[{"source":"...","target":"..."}],"style_guide":"2-4 sentences"}'
    );
  }
  if (p.glossary !== undefined && !Array.isArray(p.glossary)) {
    return toolErr('glossary must be a JSON array (use [] if none).');
  }
  if (p.style_guide !== undefined && p.style_guide !== null && typeof p.style_guide !== 'string') {
    return toolErr('style_guide must be a string.');
  }

  const glossary = asGlossary(p.glossary ?? []);
  const styleGuide = String(p.style_guide ?? '').trim();
  if (!glossary.length && !styleGuide) {
    return toolErr('Provide non-empty style_guide and/or glossary entries.');
  }

  // Soft web nudge (AsrAgent): once when glossary non-empty, search usable, 0 searches.
  const maxWeb = ctx.maxWebSearches ?? DEFAULT_MAX_SEARCHES;
  const softOn = ctx.softWebNudge !== false;
  const usedWeb = ctx.webSearchCount ?? 0;
  if (
    softOn &&
    maxWeb > 0 &&
    glossary.length > 0 &&
    usedWeb < 1 &&
    !ctx.softWebNudgeFired
  ) {
    ctx.softWebNudgeFired = true;
    return toolReject(
      'Soft check (once): glossary has entries but web_search was not used. ' +
        'If any proper name/abbreviation still has an uncertain conventional target, ' +
        'call web_search (short query), fold findings into target/note, then submit_result. ' +
        'If every target is already certain, call submit_result again to accept.',
      'web_soft'
    );
  }

  ctx.finalResult = {
    glossary,
    style_guide:
      styleGuide ||
      'Translate naturally and keep terminology consistent throughout the video.',
  };
  return toolDone(
    `Accepted submit_result: glossary=${glossary.length}, style_guide_len=${styleGuide.length}`
  );
};

const submitTranslation: ToolHandler = (params, ctx) => {
  // Prefer explicit fields; also accept the whole params object as a map form.
  let raw: unknown = params.translations;
  if (raw === undefined) raw = params.items;
  if (raw === undefined) raw = params.segments;
  if (raw === undefined && (params.index != null || params.text != null)) {
    raw = [params];
  }
  // If model put rows at top-level numeric keys only
  if (raw === undefined) {
    const keys = Object.keys(params);
    if (keys.length && keys.every((k) => /^-?\d+$/.test(k))) {
      raw = params;
    }
  }

  const expected = ctx.expectedIndices ?? new Set<number>();
  const cleaned = normalizeTranslationRows(raw, { expectedIndices: expected });

  if (!cleaned.length) {
    return toolErr(
      'Could not recover any translations from submit payload. ' +
        'Include every required index with non-empty text ' +
        '(array of {index,text}, JSON-stringified array, or index→text map are all OK).',
      '{"translations":[{"index":1,"text":"..."},{"index":2,"text":"..."}]}'
    );
  }

  const empty = cleaned.filter((c) => !c.text).map((c) => c.index);
  if (empty.length) {
    return toolErr(
      `empty translation text at indices: ${empty.join(', ')}. Fill all, resubmit FULL set.`
    );
  }

  const submitted = new Set(cleaned.map((c) => c.index));
  const missing = [...expected].filter((i) => !submitted.has(i)).sort((a, b) => a - b);
  const unexpected = [...submitted].filter((i) => !expected.has(i)).sort((a, b) => a - b);

  // Gate on coverage (content), not packaging form.
  if (missing.length || unexpected.length) {
    const src = ctx.indexToSource || {};
    const missLines = missing
      .slice(0, 20)
      .map((i) => {
        const line = (src[i] || '').trim() || '(no source)';
        const preview = line.length > 80 ? `${line.slice(0, 77)}…` : line;
        return `  [${i}] ${preview}`;
      })
      .join('\n');
    const more =
      missing.length > 20 ? `\n  … +${missing.length - 20} more missing` : '';
    return toolErr(
      [
        'Coverage incomplete — resubmit FULL translations for every required index.',
        unexpected.length ? `Unexpected indices: ${unexpected.join(', ')}` : '',
        missing.length ? `Missing indices (${missing.length}): ${missing.join(', ')}` : '',
        missLines ? `Missing source lines:\n${missLines}${more}` : '',
        `Recovered ${cleaned.length} row(s) from payload.`,
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  ctx.finalResult = { translations: cleaned };
  return toolDone(`Accepted submit_translation: ${cleaned.length} segments.`);
};

const VALID_SEVERITIES = new Set(['critical', 'warning', 'info']);
const VALID_ISSUE_TYPES = new Set([
  'terminology_mismatch',
  'coherence',
  'missing_translation',
  'fluency',
  'other',
]);

const submitQaReport: ToolHandler = (params, ctx) => {
  let raw = params.issues;
  if (raw === undefined) raw = [];
  if (!Array.isArray(raw)) {
    return toolErr('issues must be a JSON array.', '{"issues":[]}');
  }
  const cleaned: Array<Record<string, unknown>> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const severity = String(o.severity ?? '').toLowerCase();
    if (!VALID_SEVERITIES.has(severity)) continue;
    let issueType = String(o.issue_type ?? '').toLowerCase();
    const aliases: Record<string, string> = {
      term: 'terminology_mismatch',
      terminology: 'terminology_mismatch',
      missing: 'missing_translation',
      style: 'fluency',
      consistency: 'coherence',
    };
    issueType = aliases[issueType] || issueType;
    if (!VALID_ISSUE_TYPES.has(issueType)) continue;
    const idx = o.index === null || o.index === '' ? null : coerceInt(o.index);
    cleaned.push({
      severity,
      index: idx,
      issue_type: issueType,
      original_text: String(o.original_text ?? '').trim(),
      translated_text: String(o.translated_text ?? '').trim(),
      suggestion: String(o.suggestion ?? o.fix ?? '').trim(),
    });
  }
  if (raw.length && !cleaned.length) {
    return toolErr(
      'all issues were invalid. Use severity critical|warning|info and valid issue_type.'
    );
  }
  ctx.finalResult = { issues: cleaned };
  return toolDone(`Accepted submit_qa_report: ${cleaned.length} issue(s).`);
};

const HANDLERS: Record<string, ToolHandler> = {
  search_transcript: searchTranscript,
  count_transcript: countTranscript,
  verify_term: verifyTerm,
  update_todo: updateTodo,
  web_search: webSearch,
  submit_result: submitResult,
  submit_translation: submitTranslation,
  submit_qa_report: submitQaReport,
};

function schema(
  name: string,
  description: string,
  parameters: Record<string, unknown>
): LLMToolSchema {
  return {
    type: 'function',
    function: { name, description, parameters },
  };
}

export const BRIEFING_TOOL_SCHEMAS: LLMToolSchema[] = [
  schema('update_todo', 'Update short progress board for this briefing pass.', {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            text: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
          },
          required: ['text', 'status'],
        },
      },
    },
    required: ['items'],
  }),
  schema('count_transcript', 'Count how often candidate phrases appear in the transcript.', {
    type: 'object',
    properties: {
      terms: { type: 'array', items: { type: 'string' } },
      ignore_case: { type: 'boolean' },
    },
    required: ['terms'],
  }),
  schema('search_transcript', 'Search transcript for a phrase with context snippets.', {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      ignore_case: { type: 'boolean' },
      context_chars: { type: 'integer' },
    },
    required: ['pattern'],
  }),
  schema('verify_term', 'Self-check one uncertain term/hypothesis against context.', {
    type: 'object',
    properties: {
      term: { type: 'string' },
      hypothesis: { type: 'string' },
      context: { type: 'string' },
    },
    required: ['term', 'hypothesis', 'context'],
  }),
  schema('web_search', 'Optional web evidence (stubbed in browser). Prefer transcript tools.', {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  }),
  schema(
    'submit_result',
    'Submit FINAL terminology briefing: glossary + style_guide. Call once when done.',
    {
      type: 'object',
      properties: {
        glossary: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              target: { type: 'string' },
              note: { type: 'string' },
            },
            required: ['source', 'target'],
          },
        },
        style_guide: { type: 'string' },
      },
      required: ['glossary', 'style_guide'],
    }
  ),
];

export const TRANSLATION_TOOL_SCHEMAS: LLMToolSchema[] = [
  schema(
    'submit_translation',
    'Submit FINAL translation for this window. Cover EVERY required index. Prefer array of {index,text}; harness also recovers stringified JSON arrays and index→text maps.',
    {
      type: 'object',
      properties: {
        translations: {
          description:
            'Preferred: [{index, text}, ...]. Stringified JSON array or index→text object also accepted by harness.',
          // array | string | object — providers that only honor "array" still work;
          // double-encoded string is recovered in normalizeTranslationRows.
          anyOf: [
            {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  index: { type: 'integer' },
                  text: { type: 'string' },
                },
              },
            },
            { type: 'string' },
            { type: 'object' },
          ],
        },
      },
      required: ['translations'],
    }
  ),
];

export const QA_TOOL_SCHEMAS: LLMToolSchema[] = [
  schema(
    'submit_qa_report',
    'Submit FINAL QA report. issues: list of severity/index/issue_type/suggestion (empty if clean).',
    {
      type: 'object',
      properties: {
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
              index: { type: ['integer', 'null'] },
              issue_type: {
                type: 'string',
                enum: [
                  'terminology_mismatch',
                  'coherence',
                  'missing_translation',
                  'fluency',
                  'other',
                ],
              },
              original_text: { type: 'string' },
              translated_text: { type: 'string' },
              suggestion: { type: 'string' },
            },
            required: ['severity', 'issue_type'],
          },
        },
      },
      required: ['issues'],
    }
  ),
];

export async function dispatchTool(
  name: string,
  argsJson: string,
  ctx: AgentToolContext
): Promise<ToolResult> {
  ctx.lastToolOutcome = undefined;
  const handler = HANDLERS[name];
  if (!handler) {
    const r = toolErr(
      `Unknown tool '${name}'. Available: ${Object.keys(HANDLERS).join(', ')}`
    );
    ctx.lastToolOutcome = {
      ok: false,
      terminate: false,
      kind: 'tool_error',
      repairable: true,
    };
    return r;
  }
  const args = parseToolArgs(argsJson);
  try {
    const result = await handler(args, ctx);
    const inferred = inferToolOutcome(result.content, result.terminate);
    const outcome: ToolOutcome = {
      ...inferred,
      ...(result.outcome || {}),
      ok: result.outcome?.ok ?? inferred.ok,
      terminate: result.terminate,
      kind: result.outcome?.kind ?? inferred.kind,
      repairable: result.outcome?.repairable ?? inferred.repairable,
      nudge: result.outcome?.nudge ?? inferred.nudge ?? null,
    };
    ctx.lastToolOutcome = outcome;
    return result;
  } catch (e) {
    const r = toolErr(e instanceof Error ? e.message : String(e));
    ctx.lastToolOutcome = {
      ok: false,
      terminate: false,
      kind: 'tool_error',
      repairable: true,
    };
    return r;
  }
}
