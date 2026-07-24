/**
 * Deterministic window risk → 是否跑 LLM QA。
 * 产品只走 risk：有信号才 QA；无 always/off 分支。
 * Conservative: prefer false positives (run QA) over false negatives (skip).
 */

import { sourceGroundedInText } from './terminology';
import type { GlossaryEntry } from './types';
import type { TranscriptEntry } from './toolTypes';

export type WindowRiskSignal =
  | 'coverage_incomplete'
  | 'empty_translation'
  | 'glossary_target_missing'
  | 'suspicious_passthrough'
  | 'length_anomaly';

export type WindowRiskAssessment = {
  /** true → 跑窗级 LLM QA */
  risk: boolean;
  signals: WindowRiskSignal[];
};

function targetInTranslation(target: string, text: string): boolean {
  if (!target || !text) return false;
  const normalized = text.split(/\s+/).join(' ');
  if (normalized.includes(target)) return true;
  return normalized.toLowerCase().includes(target.toLowerCase());
}

/**
 * Assess risk from window segments, translations, and the **window-local** glossary.
 */
export function assessWindowRisk(options: {
  segments: Array<Pick<TranscriptEntry, 'index' | 'text'>>;
  translations: Array<{ index: number; text: string }>;
  /** Prefer window-filtered glossary so missing global terms don't false-alarm */
  glossary: GlossaryEntry[];
}): WindowRiskAssessment {
  const { segments, translations, glossary } = options;
  const signals: WindowRiskSignal[] = [];
  const byIdx = new Map(
    (translations || []).map((t) => [t.index, String(t.text || '').trim()] as const)
  );

  const expected = (segments || []).map((s) => s.index);
  const missing = expected.filter((i) => {
    const t = byIdx.get(i);
    return t == null || !String(t).trim();
  });
  if (missing.length) {
    signals.push('coverage_incomplete');
    if (
      missing.some((i) => {
        const t = byIdx.get(i);
        return t == null || !String(t).trim();
      })
    ) {
      if (!signals.includes('empty_translation')) signals.push('empty_translation');
    }
  }

  for (const seg of segments || []) {
    const src = String(seg.text || '').trim();
    const tgt = byIdx.get(seg.index) || '';
    if (!src) continue;
    if (!tgt) {
      if (!signals.includes('empty_translation')) signals.push('empty_translation');
      continue;
    }

    for (const g of glossary || []) {
      const gSrc = String(g.source || '').trim();
      const gTgt = String(g.target || '').trim();
      if (!gSrc || !gTgt) continue;
      if (!sourceGroundedInText(gSrc, src)) continue;
      if (!targetInTranslation(gTgt, tgt)) {
        if (!signals.includes('glossary_target_missing')) {
          signals.push('glossary_target_missing');
        }
        break;
      }
    }

    if (src.length >= 12 && tgt === src) {
      if (!signals.includes('suspicious_passthrough')) {
        signals.push('suspicious_passthrough');
      }
    }

    if (
      src.length >= 20 &&
      tgt.length > 0 &&
      tgt.length < Math.max(3, Math.floor(src.length * 0.25))
    ) {
      if (!signals.includes('length_anomaly')) {
        signals.push('length_anomaly');
      }
    }
  }

  return { risk: signals.length > 0, signals };
}
