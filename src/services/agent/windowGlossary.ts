/**
 * Window-local glossary enforcement: only entries grounded in the window
 * (segments + optional context) are forced in the translate prompt.
 */

import { sourceGroundedInText } from './terminology';
import type { GlossaryEntry } from './types';

/**
 * Filter glossary to entries whose source appears in any of the given texts.
 * Order preserved; empty glossary / empty texts → [].
 */
export function filterGlossaryForWindow(
  glossary: GlossaryEntry[],
  texts: string[]
): GlossaryEntry[] {
  if (!glossary?.length) return [];
  const corpus = (texts || [])
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .join('\n');
  if (!corpus) return [];

  const out: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (const g of glossary) {
    const source = String(g?.source || '').trim();
    const target = String(g?.target || '').trim();
    if (!source || !target) continue;
    if (!sourceGroundedInText(source, corpus)) continue;
    const key = source.toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source,
      target,
      note: g.note,
    });
  }
  return out;
}

/** Collect plain texts from segment-like objects for filtering. */
export function textsFromSegments(
  ...groups: Array<Array<{ text?: string }> | undefined>
): string[] {
  const out: string[] = [];
  for (const group of groups) {
    if (!group) continue;
    for (const s of group) {
      out.push(s?.text || '');
    }
  }
  return out;
}
