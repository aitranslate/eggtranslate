/**
 * Global terminology consistency check (AsrAgent terminology_check.py).
 * Identity match only; no semantic heuristics.
 */

import { sourceGroundedInText } from './terminology';
import type { GlossaryEntry } from './types';

export type TermConsistencyIssue = {
  index: number;
  source: string;
  canonicalTarget: string;
  foundTarget: string;
  issueType: 'terminology_inconsistency';
};

function canonicalTargetInText(target: string, text: string): boolean {
  if (!target || !text) return false;
  const normalized = text.split(/\s+/).join(' ');
  return normalized.includes(target);
}

/**
 * Flag indices where a glossary source appears in the source line but the
 * translation sometimes uses the canonical target and sometimes does not.
 */
export function checkGlobalTerminology(
  glossary: GlossaryEntry[],
  sourceEntries: Array<{ index: number; text: string }>,
  translatedEntries: Array<{ index: number; text: string }>
): TermConsistencyIssue[] {
  const issues: TermConsistencyIssue[] = [];
  const sourceByIndex = new Map(
    sourceEntries.map((e) => [e.index, e] as const)
  );
  const transByIndex = new Map(
    translatedEntries.map((e) => [e.index, e] as const)
  );

  const canon = new Map<string, string>();
  for (const entry of glossary || []) {
    const src = String(entry?.source || '').trim();
    const tgt = String(entry?.target || '').trim();
    if (!src || !tgt) continue;
    const key = src.toLowerCase();
    if (!canon.has(key)) canon.set(key, tgt);
  }

  for (const [srcLower, tgt] of canon) {
    // Recover original source casing from glossary if possible
    const srcDisplay =
      glossary.find((g) => g.source.toLowerCase() === srcLower)?.source ||
      srcLower;

    const matches: number[] = [];
    const hasCanonical: boolean[] = [];

    for (const [idx, sEntry] of sourceByIndex) {
      const sText = String(sEntry.text || '').trim();
      if (!sourceGroundedInText(srcDisplay, sText) && !sourceGroundedInText(srcLower, sText)) {
        continue;
      }
      const tEntry = transByIndex.get(idx);
      const tText = tEntry ? String(tEntry.text || '').trim() : '';
      if (!tText) continue;
      matches.push(idx);
      hasCanonical.push(canonicalTargetInText(tgt, tText));
    }

    if (!matches.length) continue;
    if (hasCanonical.every(Boolean) || !hasCanonical.some(Boolean)) continue;

    for (let i = 0; i < matches.length; i++) {
      if (hasCanonical[i]) continue;
      const idx = matches[i];
      const tEntry = transByIndex.get(idx);
      issues.push({
        index: idx,
        source: srcDisplay,
        canonicalTarget: tgt,
        foundTarget: tEntry ? String(tEntry.text || '') : '',
        issueType: 'terminology_inconsistency',
      });
    }
  }

  return issues;
}
