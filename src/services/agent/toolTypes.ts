/**
 * Agent 工具上下文与 dispatch 契约（对齐 AsrAgent tools/*）。
 *
 * 设计原则（与批译严格 JSON 不同）：
 * - 模型 = 大脑，产出语义；harness = 四肢，负责把可恢复载荷收成规范结构
 * - 拒收条件是「缺译 / 覆盖不全」，不是「包装形式不够标准」
 */

import { jsonrepair } from 'jsonrepair';
import type { GlossaryEntry } from './types';

export type TranscriptEntry = {
  index: number;
  start?: string;
  end?: string;
  text: string;
  /** Egg entry id（翻译落盘用） */
  entryId?: number;
};

export type AgentToolContext = {
  transcriptEntries: TranscriptEntry[];
  /** 翻译窗：本窗必须覆盖的 index 集合 */
  expectedIndices?: Set<number>;
  translateWindow?: {
    windowIndex: number;
    segments: TranscriptEntry[];
  };
  indexToSource?: Record<number, string>;
  /** submit 成功后写入 */
  finalResult?: unknown;
  submitToolName?: string;
  tokensUsed?: number;
  /** todo 板 */
  todos?: Array<{ id: string; text: string; status: string }>;
  /** web_search 本 run 已调用次数（预算） */
  webSearchCount?: number;
  /** 最多搜索次数，默认 3（对齐 AsrAgent）；0=关网 */
  maxWebSearches?: number;
  /** 首次 submit 软 nudge（有 glossary 且 0 搜）；默认 true */
  softWebNudge?: boolean;
  /** 软 nudge 是否已触发一次 */
  softWebNudgeFired?: boolean;
  /** 任务标题，作 Parallel session 后缀 */
  title?: string;
  /**
   * 最近一次工具结构化结果（loop 控制面，禁止靠英文文案分支）。
   * dispatchTool 每次调用前清空并写回。
   */
  lastToolOutcome?: ToolOutcome;
};

/** Structured tool outcome (AsrAgent last_tool_outcome). */
export type ToolOutcome = {
  ok: boolean;
  terminate: boolean;
  kind: 'tool_ok' | 'tool_error' | 'submit_ok' | 'submit_reject';
  nudge?: 'todo' | 'web_require' | 'web_soft' | null;
  repairable: boolean;
};

export type ToolResult = {
  content: string;
  /** true = 结束 agent loop */
  terminate: boolean;
  /** Optional structured outcome; dispatch infers if missing */
  outcome?: Partial<ToolOutcome>;
};

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: AgentToolContext
) => ToolResult | Promise<ToolResult>;

export type OpenAiToolDef = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export function toolOk(content: string): ToolResult {
  return {
    content,
    terminate: false,
    outcome: {
      ok: true,
      terminate: false,
      kind: 'tool_ok',
      repairable: false,
    },
  };
}

export function toolErr(message: string, hint?: string): ToolResult {
  const hintLine = hint ? `\nHint: ${hint}` : '';
  return {
    content: `Error: ${message}${hintLine}`,
    terminate: false,
    outcome: {
      ok: false,
      terminate: false,
      kind: 'tool_error',
      repairable: true,
    },
  };
}

export function toolReject(
  message: string,
  nudge?: ToolOutcome['nudge'],
  hint?: string
): ToolResult {
  const body = message.startsWith('[HARNESS] Not accepted')
    ? message
    : message.startsWith('[HARNESS]')
      ? `[HARNESS] Not accepted yet: ${message.replace(/^\[HARNESS\]\s*/, '')}`
      : `[HARNESS] Not accepted yet: ${message}`;
  const hintLine = hint ? `\nHint: ${hint}` : '';
  return {
    content: `${body}${hintLine}`,
    terminate: false,
    outcome: {
      ok: false,
      terminate: false,
      kind: 'submit_reject',
      nudge: nudge ?? null,
      repairable: false,
    },
  };
}

export function toolDone(content: string): ToolResult {
  return {
    content,
    terminate: true,
    outcome: {
      ok: true,
      terminate: true,
      kind: 'submit_ok',
      repairable: false,
    },
  };
}

export function inferToolOutcome(
  content: string,
  terminate: boolean
): ToolOutcome {
  const text = content || '';
  const isErr =
    text.startsWith('Error:') || text.startsWith('[HARNESS] Not accepted');
  const ok = !isErr;
  if (terminate && ok) {
    return { ok: true, terminate: true, kind: 'submit_ok', repairable: false };
  }
  if (!ok) {
    const kind = text.startsWith('[HARNESS] Not accepted')
      ? 'submit_reject'
      : 'tool_error';
    return {
      ok: false,
      terminate: false,
      kind,
      repairable: kind === 'tool_error',
    };
  }
  return { ok: true, terminate: false, kind: 'tool_ok', repairable: false };
}

/**
 * 解析工具参数 JSON（对齐 AsrAgent parse_tool_arguments 的宽松策略）。
 * - 剥 markdown fence
 * - 修 trailing comma
 * - 非 object 时返回 {}（由 handler 用 Hint 纠错，不直接炸 loop）
 */
export function parseToolArgs(raw: string): Record<string, unknown> {
  let s = (raw || '').trim();
  if (!s) return {};

  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }

  const tryParse = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };

  let v = tryParse(s);
  if (v === undefined) {
    // {"a":1,} → {"a":1}
    const repaired = s.replace(/,\s*([}\]])/g, '$1');
    v = tryParse(repaired);
  }
  if (v === undefined) {
    // 单引号键/值（模型偶发）→ 尽量变成双引号
    const q = s
      .replace(/(['"])?([a-zA-Z_][\w]*)\1\s*:/g, '"$2":')
      .replace(/:\s*'([^']*)'/g, ':"$1"');
    v = tryParse(q);
  }

  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

/** 与 Asr coerce_int 对齐：允许数字字符串 / 整值 float */
export function coerceToolInt(value: unknown): number | null {
  if (typeof value === 'boolean') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d+\.0+$/.test(s)) return parseInt(s, 10);
  }
  return null;
}

export type NormalizedTranslationRow = { index: number; text: string };

/**
 * 从模型 submit 载荷中提取译文行。
 *
 * Agent 模式：工具参数常经 function.arguments 二次序列化，模型会把数组
 * 写成 JSON 字符串、map、或字段别名。Harness 在此统一成 {index,text}[]。
 * 批译路径的「必须一次 JSON 完美」不适用于此。
 */
export function normalizeTranslationRows(
  raw: unknown,
  options?: { expectedIndices?: Set<number> }
): NormalizedTranslationRow[] {
  let v: unknown = raw;

  // Unwrap string JSON (single or double-encoded tool args — common in tool calling)
  for (let depth = 0; depth < 3 && typeof v === 'string'; depth++) {
    const s = (v as string).trim();
    if (!s) return [];
    const unwrapped = tryParseJsonLoose(s);
    if (unwrapped === undefined) break;
    v = unwrapped;
  }

  const rows: NormalizedTranslationRow[] = [];
  const seen = new Set<number>();

  const push = (indexRaw: unknown, textRaw: unknown) => {
    const index = coerceToolInt(indexRaw);
    if (index === null) return;
    if (seen.has(index)) return;
    const text = String(textRaw ?? '').trim();
    seen.add(index);
    rows.push({ index, text });
  };

  const textFromObject = (o: Record<string, unknown>): unknown =>
    o.text ?? o.translation ?? o.direct ?? o.target ?? o.value ?? o.content;

  if (Array.isArray(v)) {
    // Pure string list: zip with expected indices when counts match
    if (v.length && v.every((x) => typeof x === 'string' || typeof x === 'number')) {
      const expected = options?.expectedIndices;
      if (expected && expected.size === v.length) {
        const order = [...expected].sort((a, b) => a - b);
        order.forEach((idx, i) => push(idx, v[i]));
        return rows;
      }
      // Fallback: 1..n local indices (window convention)
      v.forEach((t, i) => push(i + 1, t));
      return rows;
    }

    for (const item of v) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const o = item as Record<string, unknown>;
      push(o.index ?? o.i ?? o.id ?? o.key, textFromObject(o));
    }
    return rows;
  }

  if (v && typeof v === 'object') {
    // Map form: { "1": "你好" } | { "1": { "text": "你好" } } | { translations: [...] }
    const obj = v as Record<string, unknown>;
    if ('translations' in obj && obj.translations !== raw) {
      return normalizeTranslationRows(obj.translations, options);
    }
    if ('items' in obj && obj.items !== raw) {
      return normalizeTranslationRows(obj.items, options);
    }
    for (const [k, val] of Object.entries(obj)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        push(k, textFromObject(val as Record<string, unknown>));
      } else {
        push(k, val);
      }
    }
  }

  return rows;
}

function tryParseJsonLoose(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    /* continue */
  }
  try {
    return JSON.parse(jsonrepair(s));
  } catch {
    return undefined;
  }
}

export function asGlossary(raw: unknown): GlossaryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const g of raw) {
    if (!g || typeof g !== 'object') continue;
    const o = g as Record<string, unknown>;
    const source = String(o.source ?? o.origin ?? '').trim();
    const target = String(o.target ?? o.translation ?? '').trim();
    if (!source || !target) continue;
    const key = source.toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const note = o.note ?? o.notes;
    out.push({
      source,
      target,
      note: typeof note === 'string' && note.trim() ? note.trim() : undefined,
    });
  }
  return out;
}
