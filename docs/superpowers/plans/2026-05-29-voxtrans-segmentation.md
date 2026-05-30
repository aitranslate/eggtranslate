# VoxTrans 断句逻辑实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 EggTranslate 的断句逻辑从"规则+长度限制"改为与 VoxTrans 一致的"语义优先+翻译后LLM拆分对齐"两段式架构。

**Architecture:**
- 翻译前：纯规则断句（句末标点+硬停顿），不限长度，保证语义完整
- 翻译后：LLM 二分拆分超长原文 + LLM 译文对齐，三档预设控制长度
- 仅转录模式：翻译前额外执行 DP 布局断句（按字幕长度切短）

**Tech Stack:** TypeScript, Zustand, OpenAI-compatible LLM API, AssemblyAI SDK

---

## 文件结构

### 新建文件
| 文件 | 职责 |
|---|---|
| `src/utils/wordNormalization.ts` | 单词规范化（合并标点、缩写、数字、货币、单位） |
| `src/utils/syntheticPunctuation.ts` | 合成标点（2秒停顿加句号） |
| `src/utils/terminalPunctuation.ts` | 句末标点检测+缩写白名单过滤 |
| `src/utils/dpLayoutSplit.ts` | DP 布局断句（仅转录模式） |
| `src/utils/semanticSegmentation.ts` | 语义断句主入口（组合上述模块） |
| `src/utils/subtitleLengthPresets.ts` | 三档预设值定义 |
| `src/utils/textUnitCounter.ts` | 文本长度计数（字符/单词） |
| `src/services/llmSplitAlign.ts` | LLM 拆分对齐服务（Step 5.1+5.2） |
| `src/utils/splitAlignPrompts.ts` | LLM prompt 模板（与 VoxTrans 一致） |

### 修改文件
| 文件 | 改动 |
|---|---|
| `src/utils/subtitleSegmentation.ts` | 保留类型定义，删除旧断句逻辑（被 semanticSegmentation 替代） |
| `src/services/assemblyaiService.ts` | 转录后调用新语义断句，去掉长度限制参数 |
| `src/services/transcriptionPipeline.ts` | 传递 mode 参数（transcribe / transcribe+translate） |
| `src/stores/subtitleStore.ts` | startTranscription 传递 mode；翻译后新增 LLM 拆分对齐步骤 |
| `src/stores/transcriptionStore.ts` | `srtCharsPerCaption` 改为 `subtitleLengthPreset`（short/standard/loose） |
| `src/components/SrtCharsSettings.tsx` | 数字输入改为三档预设选择器 |
| `src/types/transcription.ts` | 新增相关类型定义 |

---

## Task 1: 类型定义和预设常量

**Files:**
- Modify: `src/types/transcription.ts`
- Create: `src/utils/subtitleLengthPresets.ts`

- [ ] **Step 1: 在 transcription.ts 新增类型**

```typescript
// 断句模式
export type SegmentationMode = 'transcribe' | 'transcribe_translate';

// 字幕长度预设
export type SubtitleLengthPreset = 'short' | 'standard' | 'loose';

// 单词 token（规范化后）
export interface NormalizedWordToken {
  text: string;
  start: number; // 秒
  end: number;   // 秒
}

// 语义断句结果
export interface SemanticSegment {
  text: string;
  start: number; // 秒
  end: number;   // 秒
  wordStart: number; // 起始词索引
  wordEnd: number;   // 结束词索引
}

// LLM 拆分结果
export interface LLMSourceSplitResult {
  sourceParts: string[];
}

// LLM 对齐结果
export interface LLMAlignResult {
  translations: { id: number; text: string }[];
}
```

- [ ] **Step 2: 创建 subtitleLengthPresets.ts**

```typescript
import type { SubtitleLengthPreset } from '@/types/transcription';

// 原文长度限制（按语言组）
const SOURCE_LIMITS: Record<string, Record<SubtitleLengthPreset, number>> = {
  cjk:      { short: 16, standard: 22, loose: 28 },
  korean:   { short: 15, standard: 20, loose: 26 },
  longword: { short: 11, standard: 14, loose: 18 },
  standard: { short: 12, standard: 16, loose: 20 },
};

// 译文长度限制（按语言组）
const TARGET_LIMITS: Record<string, Record<SubtitleLengthPreset, number>> = {
  cjk:        { short: 16, standard: 22, loose: 28 },
  korean:     { short: 15, standard: 20, loose: 26 },
  thai:       { short: 24, standard: 32, loose: 42 },
  vietnamese: { short: 11, standard: 14, loose: 18 },
  longword:   { short: 9,  standard: 11, loose: 14 },
  mediumword: { short: 10, standard: 12, loose: 15 },
  standard:   { short: 10, standard: 12, loose: 16 },
};

const LANG_TO_GROUP: Record<string, string> = {
  zh: 'cjk', yue: 'cjk', ja: 'cjk',
  ko: 'korean',
  de: 'longword', fr: 'longword',
  tr: 'longword', pl: 'longword', ru: 'longword',
  es: 'mediumword', it: 'mediumword', pt: 'mediumword',
  nl: 'mediumword', id: 'mediumword',
  th: 'thai', vi: 'vietnamese',
};

function getLangGroup(langCode: string): string {
  const key = langCode.toLowerCase().split(/[-_]/)[0];
  return LANG_TO_GROUP[key] || 'standard';
}

export function getSourceLimit(langCode: string, preset: SubtitleLengthPreset): number {
  const group = getLangGroup(langCode);
  return SOURCE_LIMITS[group]?.[preset] ?? SOURCE_LIMITS.standard[preset];
}

export function getTargetLimit(langCode: string, preset: SubtitleLengthPreset): number {
  const group = getLangGroup(langCode);
  return TARGET_LIMITS[group]?.[preset] ?? TARGET_LIMITS.standard[preset];
}

export const PRESET_LABELS: Record<SubtitleLengthPreset, string> = {
  short: '短',
  standard: '标准',
  loose: '宽松',
};
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

---

## Task 2: 文本长度计数

**Files:**
- Create: `src/utils/textUnitCounter.ts`

- [ ] **Step 1: 实现计数函数**

```typescript
/**
 * 计算文本长度（单位数）
 * CJK 语言按字符计数，拉丁语言按单词计数
 */

const CJK_LANGS = new Set(['zh', 'yue', 'ja', 'ko', 'th']);

export function isCharUnitLanguage(langCode: string): boolean {
  const key = langCode.toLowerCase().split(/[-_]/)[0];
  return CJK_LANGS.has(key);
}

export function countUnits(text: string, langCode: string): number {
  if (isCharUnitLanguage(langCode)) {
    return countCharUnits(text);
  }
  return countWordUnits(text);
}

function countCharUnits(text: string): number {
  let count = 0;
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    if (/[a-zA-Z0-9]/.test(text[i])) {
      count++;
      while (i < text.length && /[a-zA-Z0-9]/.test(text[i])) i++;
    } else {
      count++;
      i++;
    }
  }
  return count;
}

function countWordUnits(text: string): number {
  let count = 0;
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    if (/[a-zA-Z0-9]/.test(text[i])) {
      count++;
      while (i < text.length && /[a-zA-Z0-9]/.test(text[i])) i++;
    } else if (isCJK(text[i])) {
      count++;
      i++;
    } else {
      i++;
    }
  }
  return count;
}

function isCJK(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 0x4E00 && code <= 0x9FFF) ||
         (code >= 0x3400 && code <= 0x4DBF) ||
         (code >= 0xF900 && code <= 0xFAFF);
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

---

## Task 3: 单词规范化

**Files:**
- Create: `src/utils/wordNormalization.ts`

- [ ] **Step 1: 实现单词规范化**

将 ASR 返回的碎片化单词 token 合并为完整 token：
- 独立标点 → 附加到前词
- 缩写合并（U + .S. → U.S.）
- 数字合并（1 + , + 000 → 1,000；12 + : + 30 → 12:30）
- 货币合并（$ + 100 → $100）
- 单位合并（10 + kg → 10kg）

```typescript
import type { NormalizedWordToken } from '@/types/transcription';

const CURRENCY_SYMBOLS = new Set(['$', '€', '£', '¥', '₹']);
const UNIT_SUFFIXES = new Set([
  'k', 'm', 'b', 't', 'x', 's', 'ms',
  'kg', 'g', 'mg', 'lb', 'lbs',
  'km', 'cm', 'mm', 'ft', 'in',
  'h', 'hr', 'hrs', 'min', 'mins',
  'usd', 'eur', 'gbp', 'jpy', 'cny',
]);

export function normalizeWordTokens(
  words: Array<{ text: string; start: number; end: number }>
): NormalizedWordToken[] {
  const result: NormalizedWordToken[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const text = word.text.trim();
    if (!text) continue;

    const prev = result.length > 0 ? result[result.length - 1] : null;

    // 独立标点 → 附加到前词
    if (prev && isStandalonePunctuation(text) && !isCurrencyPrefix(text)) {
      prev.text += text;
      prev.end = word.end;
      continue;
    }

    // 缩写合并：单字母 + .m./.s./.k.
    if (prev && text.length >= 3 && text.startsWith('.') &&
        prev.text.length === 1 && /[a-zA-Z]/.test(prev.text)) {
      const suffix = text.substring(1).toLowerCase();
      if (['m', 's', 'k'].includes(suffix[0])) {
        prev.text += text;
        prev.end = word.end;
        continue;
      }
    }

    // 数字合并
    if (prev && isDigitString(prev.text) && text.length >= 1) {
      const ch = text[0];
      if ((ch === '.' || ch === ':' || ch === '/' || ch === '-') && text.length > 1 && isDigitString(text.substring(1))) {
        prev.text += text;
        prev.end = word.end;
        continue;
      }
      if (ch === ',' && text.length === 4 && /^\d{3}$/.test(text.substring(1))) {
        prev.text += text;
        prev.end = word.end;
        continue;
      }
    }

    // 货币合并
    if (isCurrencyPrefix(text) && i + 1 < words.length && /^\d/.test(words[i + 1].text)) {
      const next = words[i + 1];
      result.push({ text: text + next.text, start: word.start, end: next.end });
      i++;
      continue;
    }

    // 单位合并
    if (prev && isDigitString(prev.text) && UNIT_SUFFIXES.has(text.toLowerCase())) {
      prev.text += text;
      prev.end = word.end;
      continue;
    }

    result.push({ text, start: word.start, end: word.end });
  }

  return result;
}

function isStandalonePunctuation(text: string): boolean {
  return text.length === 1 && /^[^\w\s]$/.test(text);
}

function isCurrencyPrefix(text: string): boolean {
  return CURRENCY_SYMBOLS.has(text) || /^(EUR|GBP|JPY|CNY|INR)$/i.test(text);
}

function isDigitString(text: string): boolean {
  return /^\d+$/.test(text);
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

---

## Task 4: 合成标点

**Files:**
- Create: `src/utils/syntheticPunctuation.ts`

- [ ] **Step 1: 实现合成标点插入**

在 2 秒+ 停顿处自动添加句号，让下游断句能捕获自然停顿。

```typescript
import type { NormalizedWordToken } from '@/types/transcription';

const SENTENCE_GAP_SEC = 2.0;
const MIN_WORDS_PER_SENTENCE = 4;
const EXISTING_PUNCTUATION = new Set([',', ';', ':', '.', '!', '?', '，', '；', '：', '。', '！', '？']);

export function insertSyntheticPunctuation(words: NormalizedWordToken[]): NormalizedWordToken[] {
  const result: NormalizedWordToken[] = [];
  let wordsSinceLastBreak = 0;

  for (let i = 0; i < words.length; i++) {
    const word = { ...words[i] };
    result.push(word);
    wordsSinceLastBreak++;

    const hasExistingPunct = EXISTING_PUNCTUATION.has(word.text[word.text.length - 1]);
    if (hasExistingPunct) {
      wordsSinceLastBreak = 0;
      continue;
    }

    // 检查与下一个词的间隔
    if (i + 1 < words.length) {
      const gap = words[i + 1].start - word.end;
      if (gap >= SENTENCE_GAP_SEC && wordsSinceLastBreak >= MIN_WORDS_PER_SENTENCE) {
        word.text += '.';
        wordsSinceLastBreak = 0;
      }
    }
  }

  return result;
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

---

## Task 5: 句末标点检测

**Files:**
- Create: `src/utils/terminalPunctuation.ts`

- [ ] **Step 1: 实现句末标点检测+缩写过滤**

```typescript
// 句末标点字符
const TERMINAL_PUNCTUATION = new Set([
  '.', '!', '?', '。', '！', '？', '｡', '．',
  '…', '‥', '‼', '⁇', '⁈', '⁉',
  '؟', '۔', '።', '။', '।', '॥',
]);

// 尾部闭合字符（检测前先剥离）
const TRAILING_CLOSERS = new Set([
  '"', "'", ')', ']', '}', '"', "'",
  '）', '】', '｝', '〉', '》', '」', '』', '〕', '〗', '〙', '〛',
]);

// 缩写白名单（小写）
const ABBREVIATIONS = new Set([
  'mr.', 'mrs.', 'ms.', 'mx.', 'dr.', 'prof.', 'rev.', 'hon.', 'fr.',
  'pres.', 'gov.', 'sen.', 'rep.', 'amb.', 'sr.', 'jr.', 'esq.',
  'capt.', 'cmdr.', 'col.', 'gen.', 'lt.', 'maj.', 'sgt.', 'adm.',
  'st.', 'mt.', 'ave.', 'blvd.', 'rd.', 'ln.', 'ct.', 'pl.', 'no.',
  'vs.', 'etc.', 'al.', 'cf.', 'fig.', 'figs.', 'ed.', 'eds.',
  'vol.', 'vols.', 'ch.', 'pp.', 'dept.', 'univ.', 'assn.', 'assoc.',
  'e.g.', 'i.e.', 'a.m.', 'p.m.',
  'u.s.', 'u.k.', 'u.n.', 'e.u.', 'd.c.', 'n.y.', 'n.y.c.', 'l.a.',
  'inc.', 'ltd.', 'co.', 'corp.', 'bros.', 'llc.', 'plc.',
  'jan.', 'feb.', 'mar.', 'apr.', 'jun.', 'jul.', 'aug.', 'sep.', 'sept.', 'oct.', 'nov.', 'dec.',
]);

export function shouldSplitAfterTerminal(wordText: string): boolean {
  // 剥离尾部闭合字符
  let stripped = wordText;
  while (stripped.length > 0 && TRAILING_CLOSERS.has(stripped[stripped.length - 1])) {
    stripped = stripped.slice(0, -1);
  }

  if (stripped.length === 0) return false;

  const lastChar = stripped[stripped.length - 1];
  if (!TERMINAL_PUNCTUATION.has(lastChar)) return false;

  // 排除缩写
  const lower = stripped.toLowerCase();
  if (ABBREVIATIONS.has(lower)) return false;

  // 排除单字母首字母（A.）
  if (stripped.length === 2 && /^[a-zA-Z]\.$/.test(stripped)) return false;

  // 排除多点缩写（Ph.D. U.S.A.）
  const dotCount = (stripped.match(/\./g) || []).length;
  if (dotCount >= 2) {
    const parts = stripped.split('.');
    if (parts.every(p => p.length <= 3 && /^[a-zA-Z]*$/.test(p))) return false;
  }

  // 排除小数（3.14）
  if (/^\d+\.\d+$/.test(stripped)) return false;

  return true;
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

---

## Task 6: 语义断句主入口

**Files:**
- Create: `src/utils/semanticSegmentation.ts`
- Modify: `src/utils/subtitleSegmentation.ts`（保留类型，删除旧逻辑）

- [ ] **Step 1: 实现语义断句主入口**

组合规范化、合成标点、句末标点、硬停顿四个模块。

```typescript
import type { NormalizedWordToken, SemanticSegment, SegmentationMode } from '@/types/transcription';
import { normalizeWordTokens } from './wordNormalization';
import { insertSyntheticPunctuation } from './syntheticPunctuation';
import { shouldSplitAfterTerminal } from './terminalPunctuation';

const HARD_SPLIT_GAP_MS = 2000; // 2 秒

/**
 * 语义断句主入口
 * @param words ASR 返回的单词级时间戳
 * @param mode 断句模式
 * @returns 语义段落数组
 */
export function semanticSegment(
  words: Array<{ text: string; start: number; end: number }>,
  mode: SegmentationMode
): SemanticSegment[] {
  // 1. 单词规范化
  const normalized = normalizeWordTokens(words);

  // 2. 合成标点
  const punctuated = insertSyntheticPunctuation(normalized);

  // 3. 按句末标点 + 硬停顿断句
  const segments = splitBySemanticBoundaries(punctuated);

  // 4. 仅转录模式：DP 布局断句（TODO: Task 8 实现）
  // if (mode === 'transcribe') { ... }

  return segments;
}

function splitBySemanticBoundaries(words: NormalizedWordToken[]): SemanticSegment[] {
  const segments: SemanticSegment[] = [];
  let segStart = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    let shouldSplit = false;

    // 规则 A：句末标点
    if (shouldSplitAfterTerminal(word.text)) {
      shouldSplit = true;
    }

    // 规则 B：硬停顿（与下一个词的间隔 ≥ 2 秒）
    if (!shouldSplit && i + 1 < words.length) {
      const gap = (words[i + 1].start - word.end) * 1000; // 转为毫秒
      if (gap >= HARD_SPLIT_GAP_MS) {
        shouldSplit = true;
      }
    }

    // 最后一个词
    if (!shouldSplit && i === words.length - 1) {
      shouldSplit = true;
    }

    if (shouldSplit) {
      const segWords = words.slice(segStart, i + 1);
      segments.push({
        text: segWords.map(w => w.text).join(' ').replace(/\s+([,.!?;:。！？；：])/g, '$1'),
        start: segWords[0].start,
        end: segWords[segWords.length - 1].end,
        wordStart: segStart,
        wordEnd: i,
      });
      segStart = i + 1;
    }
  }

  return segments;
}
```

- [ ] **Step 2: 更新 assemblyaiService.ts 调用新断句**

修改 `transcribeWithSmartSegmentation` 方法，替换旧的 `segmentText` 调用：

```typescript
// 旧代码（删除）:
// const sentences = segmentText(transcript.text, words, languageCode, maxLength);

// 新代码:
import { semanticSegment } from '@/utils/semanticSegmentation';
const segments = semanticSegment(words, 'transcribe_translate');
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

---

## Task 7: Store 层改造

**Files:**
- Modify: `src/stores/transcriptionStore.ts`

- [ ] **Step 1: 替换 srtCharsPerCaption 为 subtitleLengthPreset**

```typescript
// 旧:
// srtCharsPerCaption: number;
// setSrtCharsPerCaption: (value: number) => void;

// 新:
import type { SubtitleLengthPreset } from '@/types/transcription';

subtitleLengthPreset: SubtitleLengthPreset;
setSubtitleLengthPreset: (preset: SubtitleLengthPreset) => void;
```

默认值改为 `'standard'`，持久化字段同步更新。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

---

## Task 8: UI 改造 — 三档预设选择器

**Files:**
- Modify: `src/components/SrtCharsSettings.tsx`（重命名为 SubtitleLengthSettings）

- [ ] **Step 1: 改为三档预设选择器**

```tsx
import React from 'react';
import {
  useTranscriptionStore
} from '@/stores/transcriptionStore';
import { PRESET_LABELS } from '@/utils/subtitleLengthPresets';
import type { SubtitleLengthPreset } from '@/types/transcription';

const PRESETS: SubtitleLengthPreset[] = ['short', 'standard', 'loose'];

export const SubtitleLengthSettings: React.FC = () => {
  const preset = useTranscriptionStore((s) => s.subtitleLengthPreset);
  const setPreset = useTranscriptionStore((s) => s.setSubtitleLengthPreset);

  return (
    <div className="space-y-2">
      <h3 className="apple-heading-small">字幕长度</h3>
      <div className="flex items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => setPreset(p)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              preset === p
                ? 'bg-violet-500 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        {preset === 'short' && '英文≤12词 / 中文≤16字'}
        {preset === 'standard' && '英文≤16词 / 中文≤22字'}
        {preset === 'loose' && '英文≤20词 / 中文≤28字'}
      </p>
    </div>
  );
};
```

- [ ] **Step 2: 更新 TranscriptionSettings.tsx 引用**

```tsx
// 旧: import { SrtCharsSettings } from './SrtCharsSettings';
// 新: import { SubtitleLengthSettings } from './SubtitleLengthSettings';
// 旧: <SrtCharsSettings />
// 新: <SubtitleLengthSettings />
```

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

---

## Task 9: LLM 拆分对齐 Prompt 模板

**Files:**
- Create: `src/utils/splitAlignPrompts.ts`

- [ ] **Step 1: 创建与 VoxTrans 一致的 prompt 模板**

```typescript
import type { SubtitleLengthPreset } from '@/types/transcription';
import { getSourceLimit, getTargetLimit } from './subtitleLengthPresets';

/**
 * Step 5.1: 原文拆分 prompt
 * 与 VoxTrans build_source_split_prompt 完全一致
 */
export function buildSourceSplitPrompt(params: {
  sourceLanguage: string;
  targetLanguage: string;
  fullSourceText: string;
  fullDraftTranslation: string;
  sourceText: string;
  sourceLimit: number;
  targetLimit: number;
  splitRound: number;
  mustSplit: boolean;
}): object {
  return {
    task: 'binary_split_source_segment_for_subtitle_alignment',
    rule: 'Think step by step internally, but output JSON only.',
    sourceLanguage: params.sourceLanguage,
    targetLanguage: params.targetLanguage,
    fullSourceText: params.fullSourceText,
    fullDraftTranslation: params.fullDraftTranslation,
    sourceText: params.sourceText,
    sourceLengthLimit: params.sourceLimit,
    targetLengthLimit: params.targetLimit,
    splitRound: params.splitRound,
    mustSplit: params.mustSplit,
    constraints: [
      'Return sourceParts only.',
      'sourceParts must be an array with either one or two strings.',
      'Use one string only when mustSplit is false and there is no natural semantic split.',
      'If mustSplit is true, return two strings.',
      'Use two strings when sourceText is too long and has a natural split point.',
      'Most sourceText values sent to this task are too long; prefer two complete chunks unless splitting would clearly damage meaning.',
      'Keep original language and wording. Do not translate.',
      'Do not reorder meaning. Keep sequence from sourceText.',
      'The strings joined together must reproduce sourceText exactly, aside from whitespace normalization.',
      'Use fullDraftTranslation only as context for semantic boundaries; do not output translation.',
      'Prefer complete clauses or sentence-like chunks over equal lengths.',
      'The length limits are soft. Never cut a word, CJK phrase, name, title, number, amount, percentage, date, or punctuation unit just to hit the limit.',
      'Avoid ultra-short fragments like single discourse markers.',
    ],
    output: { sourceParts: ['part 1', 'part 2'] },
  };
}

/**
 * Step 5.2: 译文对齐 prompt
 * 与 VoxTrans build_align_prompt 完全一致
 */
export function buildAlignPrompt(params: {
  sourceLanguage: string;
  targetLanguage: string;
  theme: string;
  sourceText: string;
  draftTranslation: string;
  splitSourceLines: { id: number; source: string }[];
  terminology: { source: string; target: string; note: string }[];
}): object {
  return {
    task: 'align_translation_to_split_source_lines',
    rule: 'Return JSON only.',
    sourceLanguage: params.sourceLanguage,
    targetLanguage: params.targetLanguage,
    theme: params.theme,
    sourceText: params.sourceText,
    draftTranslation: params.draftTranslation,
    splitSourceLines: params.splitSourceLines,
    terminology: params.terminology,
    constraints: [
      'Return exactly one translation line for each split source line id.',
      'Keep meaning faithful and natural.',
      'Do not merge lines.',
      'Do not copy full draftTranslation to multiple ids.',
      'Each id should only contain meaning from its own source line.',
      'If uncertain, keep a shorter partial translation for that line only.',
      'Do not add explanations.',
    ],
    output: {
      translations: [{ id: 1, text: 'translated text' }],
    },
  };
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

---

## Task 10: LLM 拆分对齐服务

**Files:**
- Create: `src/services/llmSplitAlign.ts`

- [ ] **Step 1: 实现 LLM 调用服务**

复用 TranslationService 的 LLM 调用能力，实现 Step 5.1 和 Step 5.2。

```typescript
import { buildSourceSplitPrompt, buildAlignPrompt } from '@/utils/splitAlignPrompts';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { countUnits } from '@/utils/textUnitCounter';
import { getSourceLimit, getTargetLimit } from '@/utils/subtitleLengthPresets';
import type { SubtitleLengthPreset, LLMSourceSplitResult, LLMAlignResult } from '@/types/transcription';
import type { SubtitleEntry } from '@/types';

const OBVIOUS_OVERLONG_RATIO = 1.5;

/**
 * 调用 LLM（复用翻译配置）
 */
async function callLLM(prompt: object): Promise<string> {
  const config = useTranslationConfigStore.getState().config;
  const response = await fetch(`${config.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: 'You are a subtitle segmentation assistant. Output JSON only.' },
        { role: 'user', content: JSON.stringify(prompt) },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) throw new Error(`LLM API error: ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * Step 5.1: LLM 原文拆分
 */
export async function llmSourceSplit(params: {
  entries: SubtitleEntry[];
  sourceLang: string;
  targetLang: string;
  preset: SubtitleLengthPreset;
  fullSourceText: string;
  fullDraftTranslation: string;
  onProgress?: (current: number, total: number) => void;
}): Promise<{ entryId: number; sourceParts: string[] }[]> {
  const { entries, sourceLang, targetLang, preset, fullSourceText, fullDraftTranslation, onProgress } = params;
  const sourceLimit = getSourceLimit(sourceLang, preset);
  const targetLimit = getTargetLimit(targetLang, preset);

  const results: { entryId: number; sourceParts: string[] }[] = [];
  let processed = 0;

  for (const entry of entries) {
    const sourceUnits = countUnits(entry.text, sourceLang);
    const targetUnits = countUnits(entry.translatedText || '', targetLang);
    const needsSplit = sourceUnits > sourceLimit || targetUnits > targetLimit;

    if (!needsSplit) {
      processed++;
      onProgress?.(processed, entries.length);
      continue;
    }

    const mustSplit = sourceUnits > sourceLimit * OBVIOUS_OVERLONG_RATIO ||
                      targetUnits > targetLimit * OBVIOUS_OVERLONG_RATIO;

    try {
      const prompt = buildSourceSplitPrompt({
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
        fullSourceText,
        fullDraftTranslation,
        sourceText: entry.text,
        sourceLimit,
        targetLimit,
        splitRound: 1,
        mustSplit,
      });

      const response = await callLLM(prompt);
      const parsed: LLMSourceSplitResult = JSON.parse(response);

      if (parsed.sourceParts && parsed.sourceParts.length >= 1) {
        results.push({ entryId: entry.id, sourceParts: parsed.sourceParts });
      }
    } catch {
      // LLM 失败时保留原文不拆分
      processed++;
      onProgress?.(processed, entries.length);
      continue;
    }

    processed++;
    onProgress?.(processed, entries.length);
  }

  return results;
}

/**
 * Step 5.2: LLM 译文对齐
 */
export async function llmAlignTranslation(params: {
  sourceText: string;
  draftTranslation: string;
  splitSourceLines: { id: number; source: string }[];
  sourceLang: string;
  targetLang: string;
  theme: string;
  terminology: { source: string; target: string; note: string }[];
}): Promise<{ id: number; text: string }[]> {
  const prompt = buildAlignPrompt(params);
  const response = await callLLM(prompt);
  const parsed: LLMAlignResult = JSON.parse(response);
  return parsed.translations || [];
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

---

## Task 11: 翻译后拆分对齐流程整合

**Files:**
- Modify: `src/stores/subtitleStore.ts`

- [ ] **Step 1: 在翻译完成后调用 LLM 拆分对齐**

在 `startTranslation` 方法的翻译完成回调中，新增 Step 5.1+5.2 调用。

```typescript
// 翻译完成后，对超长条目进行 LLM 拆分对齐
import { llmSourceSplit, llmAlignTranslation } from '@/services/llmSplitAlign';
import { useTranscriptionStore } from '@/stores/transcriptionStore';

// 在翻译完成后的回调中:
const preset = useTranscriptionStore.getState().subtitleLengthPreset;
const entries = dataManager.getTaskById(taskId)?.subtitle_entries || [];

// Step 5.1: LLM 原文拆分
const splitResults = await llmSourceSplit({
  entries,
  sourceLang: config.sourceLanguage,
  targetLang: config.targetLanguage,
  preset,
  fullSourceText: entries.map(e => e.text).join('\n'),
  fullDraftTranslation: entries.map(e => e.translatedText).join('\n'),
  onProgress: (current, total) => {
    // 更新进度到 UI
  },
});

// Step 5.2: 对拆分结果进行译文对齐
for (const split of splitResults) {
  const entry = entries.find(e => e.id === split.entryId);
  if (!entry || split.sourceParts.length <= 1) continue;

  const alignments = await llmAlignTranslation({
    sourceText: entry.text,
    draftTranslation: entry.translatedText,
    splitSourceLines: split.sourceParts.map((s, i) => ({ id: i + 1, source: s })),
    sourceLang: config.sourceLanguage,
    targetLang: config.targetLanguage,
    theme: '',
    terminology: [],
  });

  // 用拆分后的条目替换原条目
  // ...
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

---

## Task 12: 清理旧代码

**Files:**
- Modify: `src/utils/subtitleSegmentation.ts`

- [ ] **Step 1: 删除旧断句逻辑**

保留 `AssemblyAISentence` 类型导出（其他文件可能引用），删除 `segmentText`、`splitByMiddlePunctuation`、`getSuggestedMaxLength`、`calculateTextLength` 函数。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: PASS

---

## Task 13: 集成测试

- [ ] **Step 1: 启动开发服务器**

Run: `pnpm dev`

- [ ] **Step 2: 测试仅转录流程**

上传一个视频文件，点击"转录"，验证：
- 断句按句末标点和 2 秒停顿切分
- 不再有长度限制导致的超长字幕
- 字幕长度预设 UI 显示三档选择器

- [ ] **Step 3: 测试转录+翻译流程**

上传一个视频文件，点击"转译"，验证：
- 转录后句子语义完整（可能较长）
- 翻译正常完成
- 翻译后 LLM 拆分对齐进度显示
- 最终字幕长度符合预设

- [ ] **Step 4: 提交代码**

```bash
git add -A
git commit -m "feat: 断句逻辑改为 VoxTrans 两段式架构（语义优先+翻译后LLM拆分对齐）"
```
