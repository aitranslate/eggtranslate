/**
 * 术语相关工具函数
 * 提供术语匹配、清理、格式化等纯函数
 */

import type { Term } from '@/types';

/**
 * 清洗文本，移除所有空格和符号，转为小写
 */
export function cleanText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * 从术语列表中筛选出与给定文本相关的术语
 * @param terms 术语列表
 * @param text 主文本
 * @param contextBefore 前文上下文
 * @param contextAfter 后文上下文
 * @returns 匹配到的术语（不含内部 cleanedOriginal 字段）
 */
export function getRelevantTerms(
  terms: Term[],
  text: string,
  contextBefore: string = '',
  contextAfter: string = ''
): Term[] {
  if (terms.length === 0) return [];

  const fullText = `${contextBefore} ${text} ${contextAfter}`;
  const cleanedFullText = cleanText(fullText);

  const processedTerms = terms.map(term => ({
    ...term,
    cleanedOriginal: cleanText(term.original)
  }));

  return processedTerms
    .filter(term => term.cleanedOriginal && cleanedFullText.includes(term.cleanedOriginal))
    .map(({ original, translation, notes }) => ({ original, translation, notes }));
}

/**
 * 格式化术语为 LLM prompt 格式
 * 有 notes: "原文 -> 译文 // notes"
 * 无 notes: "原文 -> 译文"
 */
export function formatTermsForPrompt(terms: Term[]): string {
  return terms.map(term => {
    if (term.notes) {
      return `${term.original} -> ${term.translation} // ${term.notes}`;
    }
    return `${term.original} -> ${term.translation}`;
  }).join('\n');
}
