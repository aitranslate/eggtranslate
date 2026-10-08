/**
 * 翻译提示词模板
 * 用于生成翻译API请求的提示词
 */

// 翻译条目类型定义
interface TranslationEntry {
  origin: string;
  direct: string;
}

/**
 * 生成共享提示词（参考区：前后文 / 术语）。
 * 这些块只供消歧，不得写入 JSON。
 */
export const generateSharedPrompt = (
  contextBefore: string, 
  contextAfter: string, 
  terms: string,
): string => {
  const previousSection = contextBefore.trim() 
    ? `<previous_content>\n${contextBefore.trim()}\n</previous_content>` 
    : '';
    
  const subsequentSection = contextAfter.trim()
    ? `<subsequent_content>\n${contextAfter.trim()}\n</subsequent_content>`
    : '';
    
  const termsSection = terms.trim()
    ? `### Terminology (format: original -> translation // notes)\n${terms}`
    : '';

  return [previousSection, subsequentSection, termsSection]
    .filter(Boolean)
    .join('\n\n');
};

/**
 * 提示词形态。
 *
 * - `generic`：面向通用指令型 LLM（DeepSeek / GPT / 豆包…）的长模板，
 *   用角色扮演 + 分节规范约束输出。
 * - `translation-specialist`：面向**纯翻译模型**（如 bilibili Index-Translate）。
 *   这类模型被训练成「收到原文就给译文」，不理解「只填 JSON 某个字段」这种
 *   槽位指令——实测会直接把译文写进 `origin`、把 `direct` 留空，导致整批空译文。
 *   改为把字段语义写成显式硬约束（origin 原样保留 / direct 填译文）才稳定。
 */
export type PromptVariant = 'generic' | 'translation-specialist';

const DEFAULT_VARIANT: PromptVariant = 'generic';

/**
 * 生成翻译提示词（信达雅一步翻译）
 * @param lines 需要翻译的文本行
 * @param sharedPrompt 共享提示词
 * @param sourceLanguage 源语言
 * @param targetLanguage 目标语言
 * @param variant 提示词形态，默认 `generic`
 * @returns 格式化的翻译提示词
 */
export const generateDirectPrompt = (
  lines: string,
  sharedPrompt: string,
  sourceLanguage: string,
  targetLanguage: string,
  variant: PromptVariant = DEFAULT_VARIANT
): string => {
  // 优化：使用 map + Object.fromEntries 更简洁
  const lineArray = lines.split('\n').filter(line => line.trim());

  const jsonDict = Object.fromEntries(
    lineArray.map((line, index) => [
      `${index + 1}`,
      {
        origin: line,
        direct: ""
      } as TranslationEntry
    ])
  );

  const jsonFormat = JSON.stringify(jsonDict, null, 2);

  if (variant === 'translation-specialist') {
    // 纯翻译模型分支：短指令 + 显式字段约束，不使用角色扮演式长模板。
    // sharedPrompt（前后文 / 术语）仍要带上，但降级为「仅供参考」区，
    // 避免模型把参考内容当成待译行。
    const referenceSection = sharedPrompt.trim()
      ? `\n【参考（仅用于消歧，禁止翻译、禁止写入任何字段）】\n${sharedPrompt.trim()}\n`
      : '';

    return `请将以下<source>中的每行字幕从${sourceLanguage}翻译成${targetLanguage}，保持严格 1:1 对应，不要合并或拆分，不要添加解释。${referenceSection}
【source】
${lines}

请以完全相同的 JSON 结构输出，其中：
- "origin" 字段必须原样保留${sourceLanguage}原文，不得翻译
- "direct" 字段填入对应行的${targetLanguage}译文
- 键名与行号不得改变

只输出 JSON，不要有任何额外说明。JSON 格式如下：
${jsonFormat}`;
  }

  return `## Role
You are a professional Netflix subtitle translator fluent in ${sourceLanguage} and ${targetLanguage}. You always respond in valid JSON only.

## Task
Translate ONLY the lines inside <subtitles> from ${sourceLanguage} into ${targetLanguage}.

${sharedPrompt}

<register>
Match the source register. Spoken dialogue stays colloquial; narration and news stay concise and formal. Do not add translator notes.
</register>

<translation_guidelines>
1. **Context isolation**: <previous_content> and <subsequent_content> are REFERENCE ONLY. Never translate them. Never copy them into any "direct" field.
2. **Accuracy**: Faithfully convey the original meaning — never add, omit, or distort.
3. **Naturalness**: Use expressions native ${targetLanguage} speakers would actually say.
4. **Conciseness**: Subtitles must be readable at viewing speed — prefer compact phrasing. Do not pad short lines.
5. **Consistency**: Reuse terminology and renderings already shown after "→" in bilingual context (names, titles, recurring phrases).
6. **Tone**: Match register to content — casual for dialogue, formal for narration.
7. **Cultural Adaptation**: Adapt references only when necessary, never at the cost of meaning.
8. **Context**: Use surrounding subtitles only to resolve ambiguity (pronouns, ellipsis, speaker stance).
</translation_guidelines>

<subtitle_constraints>
- Keep each subtitle short enough to read at normal playback speed.
- Maintain strict 1:1 mapping with source entries — do not merge or split.
- Preserve natural speech rhythm in line breaks.
- Do not add explanations, parenthetical glosses, or extra sentences absent from the source line.
</subtitle_constraints>

## Input
<subtitles>
${lines}
</subtitles>

## Output
\`\`\`json
${jsonFormat}
\`\`\``;
};