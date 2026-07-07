// Layer1 硬切分 + 单词区间映射 —— 复刻 D:\voxtrans 的 semantic.rs（英文走
// sentence-splitter，其它语言走默认标点），并提供把句子边界映射回单词下标的能力。

import { split } from 'sentence-splitter';
import type { WordWithTime } from './types';
import { isAbbreviationToken, isSingleLetterDotted } from './textRules';

/**
 * 在 sentence-splitter 之上补切单字母枚举句末（"step one B." 中的 B.），
 * 除非 B. 与下一 token 构成单字母缩写链（"J. K."）。复刻 voxtrans 的
 * is_single_letter_dotted 链特判。仅当 sentence-splitter 未在其后切分时生效。
 */
function applySingleLetterRule(sentence: string): string[] {
  const tokens = sentence.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return [sentence];
  const parts: string[] = [];
  let cur: string[] = [tokens[0]];
  for (let i = 1; i < tokens.length; i++) {
    const prev = tokens[i - 1];
    if (isSingleLetterDotted(prev) && !isSingleLetterDotted(tokens[i])) {
      // 在 prev 之后切分（prev 已在 cur 中，勿重复追加）。
      parts.push(cur.join(' '));
      cur = [tokens[i]];
    } else {
      cur.push(tokens[i]);
    }
  }
  if (cur.length) parts.push(cur.join(' '));
  return parts.filter(Boolean);
}

/** 从 sentence-splitter 的 AST 中提取句子字符串（拼接 Sentence 节点的子节点 value）。 */
function extractSentencesFromAst(nodes: ReturnType<typeof split>): string[] {
  const sentences: string[] = [];
  for (const node of nodes) {
    if (node.type === 'Sentence') {
      const text = node.children
        .map((c) => ('value' in c ? String((c as { value?: unknown }).value ?? '') : ''))
        .join('')
        .trim();
      if (text) sentences.push(text);
    }
  }
  return sentences;
}

/** 英文硬切分：sentence-splitter（内置缩写/引号/括号处理）+ 单字母枚举补切。 */
export function splitEnglishText(text: string): string[] {
  if (!text.trim()) return [];
  const base = extractSentencesFromAst(split(text));
  const out: string[] = [];
  for (const sentence of base) {
    out.push(...applySingleLetterRule(sentence));
  }
  return out;
}

const TERMINAL_JOIN = new Set(['.', '!', '?', '。', '！', '？', '．', '…', '⁉', '‼', '⁈', '⁇']);

/** token 是否以句末标点结尾且非缩写/非小数（可在此切句）。 */
function endsSentence(token: string): boolean {
  const trimmed = token.trimEnd();
  const last = trimmed[trimmed.length - 1];
  if (!last || !TERMINAL_JOIN.has(last)) return false;
  if (isAbbreviationToken(token)) return false;
  // 小数（如 "3.14"）保护
  if (/^\d/.test(token.replace(/[.。]+$/, ''))) return false;
  return true;
}

/** 其它语言默认标点切分（带基础缩写/小数保护）。 */
export function splitByPunctuation(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const result: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    if (endsSentence(words[i - 1])) {
      result.push(current.trim());
      current = words[i];
    } else {
      current += ' ' + words[i];
    }
  }
  result.push(current.trim());
  return result.filter(Boolean);
}

/** 按语言选择硬切分策略。 */
export function splitTextToSentences(text: string, lang: string): string[] {
  const key = lang.trim().split(/[-_]/)[0].toLowerCase();
  if (key === 'en') return splitEnglishText(text);
  return splitByPunctuation(text);
}

/** 归一化：折叠空白为单空格并去首尾空格。 */
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 把硬切分得到的句子字符串映射回原始单词下标区间 [start,end]（含端点）。
 * 通过按单词累积文本并与归一化后的句子比对实现，鲁棒且不依赖字符偏移。
 */
export function mapSentencesToWordRanges(
  sentences: string[],
  words: WordWithTime[],
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  if (words.length === 0 || sentences.length === 0) return ranges;
  let wi = 0;
  for (const s of sentences) {
    const target = normalize(s);
    const start = wi;
    let acc = '';
    while (wi < words.length) {
      acc = acc ? acc + ' ' + words[wi].text : words[wi].text;
      if (normalize(acc) === target) {
        ranges.push([start, wi]);
        wi++;
        break;
      }
      if (normalize(acc).length > target.length) {
        // 累积超出仍未匹配 → 兜底：把已累积的词归入本句
        ranges.push([start, wi]);
        wi++;
        break;
      }
      wi++;
    }
  }
  // 末尾残余单词并入最后一个区间
  if (wi < words.length) {
    if (ranges.length === 0) ranges.push([0, words.length - 1]);
    else ranges[ranges.length - 1][1] = words.length - 1;
  }
  return ranges;
}
