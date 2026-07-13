/**
 * 翻译 LLM 服务商预设（快捷填入）
 * 多数用户走自定义 OpenAI 兼容接口；预设只是一点写入 URL + 模型
 */

export type LlmProviderId =
  | 'agnes'
  | 'deepseek'
  | 'qwen'
  | 'zhipu'
  | 'doubao'
  | 'chatgpt'
  | 'gemini'
  | 'openrouter'
  | 'ollama'
  | 'custom';

export interface LlmProviderPreset {
  id: LlmProviderId;
  name: string;
  /** 卡片上短标签 */
  shortName: string;
  baseURL: string;
  model: string;
  /** 角标：免费 / 推荐 等 */
  badge?: string;
  /** 角标色：free 绿 / recommend 蓝 */
  badgeTone?: 'free' | 'recommend';
  /** 获取 Key 的文档或平台链接 */
  keyUrl?: string;
  /** 卡片副文案 */
  hint?: string;
  /** public 下图标路径；无则用通用图标 */
  iconSrc?: string;
}

/**
 * 预设原则：字幕翻译用 Flash / Mini 档即可，不必上 Pro / Max。
 * 模型 ID 随厂商更新，优先「当前代 × 轻量档」。
 */
export const LLM_PROVIDER_PRESETS: LlmProviderPreset[] = [
  {
    id: 'custom',
    name: '自定义',
    shortName: '自定义',
    baseURL: '',
    model: '',
    hint: '手填任意 OpenAI 兼容接口',
  },
  {
    id: 'agnes',
    name: 'Agnes AI',
    shortName: 'Agnes',
    baseURL: 'https://apihub.agnes-ai.com/v1',
    model: 'agnes-2.0-flash',
    badge: '免费',
    badgeTone: 'free',
    keyUrl: 'https://platform.agnes-ai.com/',
    hint: '免费 Flash',
    iconSrc: '/icons/providers/agnes.svg',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    shortName: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    badge: '推荐',
    badgeTone: 'recommend',
    keyUrl: 'https://platform.deepseek.com/',
    hint: 'V4 Flash · 翻译够用',
    iconSrc: '/icons/providers/deepseek.svg',
  },
  {
    id: 'qwen',
    name: '通义千问',
    shortName: '通义',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.6-flash',
    keyUrl: 'https://dashscope.console.aliyun.com/',
    hint: '3.6 Flash · 低成本',
    iconSrc: '/icons/providers/qwen.svg',
  },
  {
    id: 'zhipu',
    name: '智谱 AI',
    shortName: '智谱',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.7-flash',
    keyUrl: 'https://open.bigmodel.cn/',
    hint: '4.7 Flash · 免费档',
    iconSrc: '/icons/providers/zhipu.svg',
  },
  {
    id: 'doubao',
    name: '豆包',
    shortName: '豆包',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    // Seed 2.1 Turbo：当前代高频/低成本档（非 Pro）；方舟也可填接入点 ID
    model: 'doubao-seed-2-1-turbo-260628',
    keyUrl: 'https://console.volcengine.com/ark',
    hint: '2.1 Turbo · 可改成接入点 ID',
    iconSrc: '/icons/providers/doubao.svg',
  },
  {
    id: 'chatgpt',
    name: 'OpenAI',
    shortName: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-5-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    hint: 'GPT-5 mini · 高性价比',
    iconSrc: '/icons/providers/chatgpt.svg',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    shortName: 'Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    hint: '3.5 Flash · OpenAI 兼容',
    iconSrc: '/icons/providers/gemini.svg',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    shortName: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-3.5-flash',
    keyUrl: 'https://openrouter.ai/keys',
    hint: '聚合 · 默认 Gemini Flash',
    iconSrc: '/icons/providers/openrouter.svg',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    shortName: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    model: 'qwen3:8b',
    keyUrl: 'https://ollama.com/',
    hint: '本地 · 需先 ollama pull · Key 可填 ollama',
    iconSrc: '/icons/providers/ollama.svg',
  },
];

/** 根据当前 baseURL 推断选中的预设（自定义兜底） */
export function matchProviderId(baseURL: string): LlmProviderId {
  const normalized = (baseURL || '').trim().replace(/\/+$/, '').toLowerCase();
  if (!normalized) return 'custom';

  // 较长 URL 优先，避免短前缀误匹配
  const ranked = [...LLM_PROVIDER_PRESETS]
    .filter((p) => p.id !== 'custom' && p.baseURL)
    .sort((a, b) => b.baseURL.length - a.baseURL.length);

  for (const p of ranked) {
    const preset = p.baseURL.replace(/\/+$/, '').toLowerCase();
    if (normalized === preset || normalized.startsWith(`${preset}/`)) {
      return p.id;
    }
  }
  return 'custom';
}

export function getProviderById(id: LlmProviderId): LlmProviderPreset {
  return (
    LLM_PROVIDER_PRESETS.find((p) => p.id === id) ??
    LLM_PROVIDER_PRESETS.find((p) => p.id === 'custom')!
  );
}
