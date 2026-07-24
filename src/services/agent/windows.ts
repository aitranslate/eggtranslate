/**
 * Agent 分窗：按段数切窗，前后重叠上下文仅作 prompt，不重复提交翻译。
 * 另：术语 briefing 按字符预算切 transcript（长片）。
 */

import type { SubtitleEntry } from '@/types';
import type { AgentWindowSpec, GlossaryEntry } from './types';
import type { TranscriptEntry } from './toolTypes';
import { normalizeTermKey } from './terminology';

/** Briefing char budget (AsrAgent-ish ~18–20k) */
export const BRIEFING_WINDOW_CHARS = 18000;
export const BRIEFING_OVERLAP_CHARS = 400;

export function splitAgentWindows(
  entries: SubtitleEntry[],
  windowSize = 30,
  overlap = 5
): AgentWindowSpec[] {
  const n = entries.length;
  if (n === 0) return [];
  const size = Math.max(1, windowSize);
  const ov = Math.max(0, Math.min(overlap, size - 1));
  const windows: AgentWindowSpec[] = [];

  for (let start = 0, wi = 0; start < n; start += size, wi++) {
    const end = Math.min(n, start + size);
    const entryIndices: number[] = [];
    for (let i = start; i < end; i++) entryIndices.push(i);

    const contextBeforeIndices: number[] = [];
    for (let i = Math.max(0, start - ov); i < start; i++) {
      contextBeforeIndices.push(i);
    }
    const contextAfterIndices: number[] = [];
    for (let i = end; i < Math.min(n, end + ov); i++) {
      contextAfterIndices.push(i);
    }

    windows.push({
      windowIndex: wi,
      entryIndices,
      contextBeforeIndices,
      contextAfterIndices,
    });
  }

  return windows;
}

/**
 * Split transcript entries for multi-window terminology briefing.
 * Overlap by char budget on plain joined text boundaries (cue-level step).
 */
export function splitBriefingEntryWindows(
  entries: TranscriptEntry[],
  maxChars = BRIEFING_WINDOW_CHARS,
  overlapCues = 2
): TranscriptEntry[][] {
  if (!entries.length) return [[]];
  const windows: TranscriptEntry[][] = [];
  let i = 0;
  const n = entries.length;
  while (i < n) {
    const chunk: TranscriptEntry[] = [];
    let chars = 0;
    let j = i;
    while (j < n) {
      const t = entries[j].text || '';
      const add = t.length + 24;
      if (chunk.length && chars + add > maxChars) break;
      chunk.push(entries[j]);
      chars += add;
      j++;
    }
    if (!chunk.length) {
      chunk.push(entries[i]);
      j = i + 1;
    }
    windows.push(chunk);
    if (j >= n) break;
    const nxt = j - Math.max(0, overlapCues);
    i = Math.max(i + 1, nxt);
  }
  return windows;
}

/** First-seen source wins (AsrAgent union_glossaries). */
export function unionGlossaries(parts: GlossaryEntry[][]): GlossaryEntry[] {
  const out: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    for (const g of part || []) {
      if (!g) continue;
      const src = String(g.source || '').trim();
      const tgt = String(g.target || '').trim();
      if (!src || !tgt) continue;
      const key = normalizeTermKey(src);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        source: src,
        target: tgt,
        note: g.note,
      });
    }
  }
  return out;
}

/** Combine style strings; caller should align to glossary afterwards. */
export function mergeStyleGuides(styles: string[]): string {
  const cleaned = styles
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean);
  if (!cleaned.length) return '';
  if (cleaned.length === 1) return cleaned[0];
  const primary = cleaned.reduce((a, b) => (a.length >= b.length ? a : b));
  for (const s of cleaned) {
    if (s !== primary && !primary.includes(s.slice(0, 80))) {
      return `${primary} ${s}`.slice(0, 1200);
    }
  }
  return primary;
}
