/**
 * AssemblyAI API 配置
 */

export const ASSEMBLYAI_CONFIG = {
  // API Keys（轮询使用）
  apiKeys: [
    '87dcabf797124999a64a0ea1d434a11a',
  ],

  // 语音模型（优先级顺序）
  speechModels: ["universal-3-pro", "universal-2"] as const,

  // 默认热词（用户可扩展）
  defaultKeyterms: [] as string[],
} as const;

// 支持的语言（用于 UI 显示）
export const SUPPORTED_LANGUAGES = {
  pro: ['English', 'Spanish', 'Portuguese', 'French', 'German', 'Italian'],
  fallback: '99+ languages',
} as const;
