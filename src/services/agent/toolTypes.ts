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

export function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    let s = raw.trim();
    if (s.startsWith('```')) {
      s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }
    const v = JSON.parse(s || '{}');
    return v && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
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
