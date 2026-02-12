/**
 * 翻译提示词模板
 * 用于生成翻译API请求的提示词
 */

/**
 * 生成共享提示词
 * @param contextBefore 前文上下文
 * @param contextAfter 后文上下文
 * @param terms 术语表
 * @returns 格式化的共享提示词
 */
export const generateSharedPrompt = (contextBefore: string, contextAfter: string, terms: string): string => {
  return `### Context Information
<previous_content>
${contextBefore}
</previous_content>

<subsequent_content>
${contextAfter}
</subsequent_content>

### Terminology (format: original -> translation // notes)
${terms}`;
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
  const lineArray = lines.split('\n');
  const jsonDict: Record<string, any> = {};

  lineArray.forEach((line, index) => {
    jsonDict[`${index + 1}`] = {
      origin: line,
      direct: ""
    };
  });

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

/**
 * 生成句子分割提示词
 * 将转录的单词列表分割成符合 Netflix 标准的字幕句子
 * @param wordsList 单词数组
 * @param maxLength 最大句子长度（词数），默认 20
 * @param sourceLanguage 源语言
 * @returns 格式化的句子分割提示词
 */
export const getSentenceSegmentationPrompt = (
  wordsList: string[],
  maxLength: number = 20,
  sourceLanguage: string
): string => {
  const wordsText = wordsList.join(' ');

  return `## Role
You are a professional subtitle segmentation expert in **${sourceLanguage}** specializing in Netflix-quality subtitle formatting.

## Task
1. Group the given words into complete sentences based on natural language boundaries
2. Split any sentence longer than ${maxLength} words into shorter, more readable segments
3. Follow Netflix subtitle standards for sentence segmentation

## Segmentation Rules
1. **Sentence Boundaries**: Use natural pausing points (punctuation marks, conjunctions, etc.)
2. **Hyphenated/ellipsis continuation**: If a sentence ends with '-' or '...', merge with the next sentence
3. **Long sentence splitting**: Split sentences >${maxLength} words at semantically appropriate points
4. **Minimum length**: Each sentence should have at least 3 words
5. **Punctuation handling**: Maintain proper punctuation for readability

## Input Words
<words_sequence>
${wordsText}
</words_sequence>

## Output Requirements
Return a JSON object with:
- "sentences": Array of segmented sentences
- "analysis": Brief explanation of segmentation decisions

## Output Format
\`\`\`json
{
    "sentences": [
        "First complete sentence here.",
        "Second sentence here.",
        "Third sentence split from long text..."
    ],
    "analysis": "Brief description of segmentation strategy and any splitting decisions"
}
\`\`\`

Note: Start with \`\`\`json and end with \`\`\`, no other text.`;
};
