/**
 * 文本到 token 边界映射
 * 将 LLM 返回的拆分文本映射回 word token 边界，推导精确时间戳
 * 移植自 VoxTrans 的双策略算法
 */

import type { SubtitleWord } from '@/types';
import { countUnits } from './textUnitCounter';

const SOFT_SPLIT_GAP_SECONDS = 0.35;

/**
 * 去除所有空格用于比较
 */
function compactText(text: string): string {
  return text.replace(/\s+/g, '');
}

/**
 * 从 word token 数组重建文本
 * CJK 字符之间不加空格，拉丁词之间加空格
 */
function buildSourceFromTokens(words: SubtitleWord[]): string {
  if (words.length === 0) return '';

  let result = words[0].text;
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1].text;
    const curr = words[i].text;
    const prevIsCJK = isCJK(prev[prev.length - 1]);
    const currIsCJK = isCJK(curr[0]);
    const currIsPunct = /^[^\w\s一-鿿㐀-䶿豈-﫿]/.test(curr);

    if (prevIsCJK || currIsCJK || currIsPunct) {
      result += curr;
    } else {
      result += ' ' + curr;
    }
  }
  return result;
}

function isCJK(char: string): boolean {
  if (!char) return false;
  const code = char.charCodeAt(0);
  return (code >= 0x4E00 && code <= 0x9FFF) ||
         (code >= 0x3400 && code <= 0x4DBF) ||
         (code >= 0xF900 && code <= 0xFAFF);
}

/**
 * Strategy A: 精确文本匹配
 * 将 sourceParts 拼接后与 words 拼接后 compact 比较，逐 part 匹配 token 前缀
 */
function mapExactBoundaries(sourceParts: string[], words: SubtitleWord[]): number[] | null {
  const fullFromTokens = compactText(buildSourceFromTokens(words));
  const fullFromParts = compactText(sourceParts.join(''));

  if (fullFromTokens.length === 0 || fullFromTokens !== fullFromParts) {
    return null;
  }

  const boundaries: number[] = [];
  let consumed = '';

  for (let partIdx = 0; partIdx < sourceParts.length - 1; partIdx++) {
    consumed += compactText(sourceParts[partIdx]);

    let matched = -1;
    for (let boundary = 1; boundary < words.length; boundary++) {
      const prefix = compactText(buildSourceFromTokens(words.slice(0, boundary)));
      if (prefix === consumed) {
        matched = boundary;
        break;
      }
    }

    if (matched === -1) return null;
    boundaries.push(matched);
  }

  return boundaries;
}

/**
 * Strategy B: 按比例单位匹配
 * 用 text length units 按比例分配，贪心扫描选最佳边界
 */
function mapProportionalBoundaries(sourceParts: string[], words: SubtitleWord[], langCode: string): number[] {
  // 计算每个 word 的长度单位
  const wordUnits = words.map(w => Math.max(countUnits(w.text, langCode), 0.5));
  const prefixUnits: number[] = [0];
  for (let i = 0; i < wordUnits.length; i++) {
    prefixUnits.push(prefixUnits[i] + wordUnits[i]);
  }
  const totalTokenUnits = prefixUnits[wordUnits.length];

  // 计算每个 part 的长度单位
  const partUnits = sourceParts.map(p => Math.max(countUnits(p, langCode), 1.0));
  const totalPartUnits = partUnits.reduce((a, b) => a + b, 0);

  // 按比例缩放 part 单位
  const scale = totalPartUnits > 0 ? totalTokenUnits / totalPartUnits : 1;
  const scaledPartUnits = partUnits.map(u => u * scale);

  const boundaries: number[] = [];
  let consumedTarget = 0;

  for (let partIdx = 0; partIdx < sourceParts.length - 1; partIdx++) {
    consumedTarget += scaledPartUnits[partIdx];

    // 扫描候选边界位置
    const minBoundary = boundaries.length > 0 ? boundaries[boundaries.length - 1] + 1 : 1;
    const maxBoundary = words.length - 1;

    let bestBoundary = minBoundary;
    let bestScore = Infinity;

    for (let b = minBoundary; b <= maxBoundary; b++) {
      const consumed = prefixUnits[b];
      let score = Math.abs(consumed - consumedTarget);

      // 自然断点加分
      const gap = words[b].start - words[b - 1].end;
      if (gap >= SOFT_SPLIT_GAP_SECONDS || hasTerminalPunctuation(words[b - 1].text)) {
        score -= 0.8;
      } else {
        score += 0.5;
      }

      // 过短片段惩罚
      const leftUnits = prefixUnits[b];
      const rightUnits = totalTokenUnits - leftUnits;
      if (leftUnits < 1.5) score += 3.0;
      if (rightUnits < 1.5) score += 3.0;

      if (score < bestScore) {
        bestScore = score;
        bestBoundary = b;
      }
    }

    boundaries.push(bestBoundary);
  }

  return boundaries;
}

/**
 * 句末标点检测
 */
function hasTerminalPunctuation(text: string): boolean {
  const terminals = '.!?;:。！？；：…？！';
  const trimmed = text.trimEnd();
  if (trimmed.length === 0) return false;
  return terminals.includes(trimmed[trimmed.length - 1]);
}

/**
 * 将 LLM 返回的 sourceParts 映射到 word token 边界
 * @param sourceParts LLM 拆分后的文本数组
 * @param words 原始单词时间戳数组
 * @param langCode 语言代码（用于单位计算）
 * @returns boundary 索引数组（N 个 sourceParts 返回 N-1 个 boundary）
 */
export function mapSourcePartsToBoundaries(
  sourceParts: string[],
  words: SubtitleWord[],
  langCode: string
): number[] {
  if (sourceParts.length <= 1 || words.length === 0) return [];

  // Strategy A: 精确匹配
  const exactBoundaries = mapExactBoundaries(sourceParts, words);
  if (exactBoundaries) {
    return exactBoundaries;
  }

  // Strategy B: 按比例匹配
  return mapProportionalBoundaries(sourceParts, words, langCode);
}

/**
 * boundary 索引 → inclusive (start, end) range 对
 * @param boundaries boundary 索引数组
 * @param tokenCount token 总数
 * @returns [(start, end), ...] inclusive 范围数组
 */
export function boundariesToRanges(boundaries: number[], tokenCount: number): [number, number][] {
  const ranges: [number, number][] = [];
  let start = 0;

  for (const boundary of boundaries) {
    ranges.push([start, boundary - 1]);
    start = boundary;
  }

  ranges.push([start, tokenCount - 1]);
  return ranges;
}
