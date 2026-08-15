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
 * 生成共享提示词（参考区：前后文 / 已确定译法 / 术语）。
 * 这些块只供消歧，不得写入 JSON。
 */
export const generateSharedPrompt = (
  contextBefore: string, 
  contextAfter: string, 
  terms: string,
  established?: string,
): string => {
  const previousSection = contextBefore.trim() 
    ? `<previous_content>\n${contextBefore.trim()}\n</previous_content>` 
    : '';
    
  const subsequentSection = contextAfter.trim()
    ? `<subsequent_content>\n${contextAfter.trim()}\n</subsequent_content>`
    : '';

  const establishedSection = established?.trim()
    ? `### Established renderings (reuse names and set phrases; do not translate these lines)\n${established.trim()}`
    : '';
    
  const termsSection = terms.trim()
    ? `### Terminology (format: original -> translation // notes)\n${terms}`
    : '';

  return [previousSection, subsequentSection, establishedSection, termsSection]
    .filter(Boolean)
    .join('\n\n');
};

/**
 * 生成翻译提示词（信达雅一步翻译）
 * @param lines 需要翻译的文本行
 * @param sharedPrompt 共享提示词
 * @param sourceLanguage 源语言
 * @param targetLanguage 目标语言
 * @returns 格式化的翻译提示词
 */
export const generateDirectPrompt = (
  lines: string,
  sharedPrompt: string,
  sourceLanguage: string,
  targetLanguage: string
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

  return `## Role
You are a professional Netflix subtitle translator fluent in ${sourceLanguage} and ${targetLanguage}. You always respond in valid JSON only.

## Task
Translate ONLY the lines inside <subtitles> from ${sourceLanguage} into ${targetLanguage}.

${sharedPrompt}

<register>
Match the source register. Spoken dialogue stays colloquial; narration and news stay concise and formal. Do not add translator notes.
</register>

<translation_guidelines>
1. **Context isolation**: <previous_content>, <subsequent_content>, and established renderings are REFERENCE ONLY. Never translate them. Never copy them into any "direct" field.
2. **Accuracy**: Faithfully convey the original meaning — never add, omit, or distort.
3. **Naturalness**: Use expressions native ${targetLanguage} speakers would actually say.
4. **Conciseness**: Subtitles must be readable at viewing speed — prefer compact phrasing. Do not pad short lines.
5. **Consistency**: Reuse renderings already shown after "→" in bilingual context or in established renderings (names, titles, recurring phrases).
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