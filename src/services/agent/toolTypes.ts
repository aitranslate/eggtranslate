/**
 * Agent 工具上下文与 dispatch 契约（对齐 AsrAgent tools/*）。
 */

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
  /** 最多搜索次数，默认 5（对齐 AsrAgent） */
  maxWebSearches?: number;
  /** 任务标题，作 Parallel session 后缀 */
  title?: string;
};

export type ToolResult = {
  content: string;
  /** true = 结束 agent loop */
  terminate: boolean;
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
  return { content, terminate: false };
}

export function toolErr(message: string, hint?: string): ToolResult {
  const hintLine = hint ? `\nHint: ${hint}` : '';
  return { content: `Error: ${message}${hintLine}`, terminate: false };
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
