/**
 * AssemblyAI API 配置
 */

export const ASSEMBLYAI_CONFIG = {
  // 默认热词（用户可扩展）
  defaultKeyterms: [] as string[],
} as const;

// 支持的语言（用于 UI 显示）
export const SUPPORTED_LANGUAGES = {
  pro: ['English', 'Spanish', 'Portuguese', 'French', 'German', 'Italian'],
  fallback: '99+ languages',
} as const;
