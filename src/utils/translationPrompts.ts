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
 * 生成共享提示词
 * @param contextBefore 前文上下文
 * @param contextAfter 后文上下文  
 * @param terms 术语表
 * @returns 格式化的共享提示词
 */
export const generateSharedPrompt = (
  contextBefore: string, 
  contextAfter: string, 
  terms: string
): string => {
  // 优化：使用条件判断避免无意义的空标签
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
Translate the following ${sourceLanguage} subtitles into ${targetLanguage}.

${sharedPrompt}

<translation_guidelines>
1. **Accuracy**: Faithfully convey the original meaning — never add, omit, or distort.
2. **Naturalness**: Use expressions native ${targetLanguage} speakers would actually say.
3. **Conciseness**: Subtitles must be readable at viewing speed — prefer compact phrasing.
4. **Consistency**: Maintain consistent terminology, especially for names and technical terms.
5. **Tone**: Match register to content — casual for dialogue, formal for narration.
6. **Cultural Adaptation**: Adapt references only when necessary, never at the cost of meaning.
7. **Context**: Use surrounding subtitles to resolve ambiguity.
</translation_guidelines>

<subtitle_constraints>
- Keep each subtitle short enough to read at normal playback speed.
- Maintain strict 1:1 mapping with source entries — do not merge or split.
- Preserve natural speech rhythm in line breaks.
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