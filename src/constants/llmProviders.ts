/**
 * 翻译 LLM 服务商预设（快捷填入）
 * 多数用户走自定义 OpenAI 兼容接口；预设只是一点写入 URL + 模型
 */

export type LlmProviderId =
  | 'agnes'
  | 'index-translate'
  | 'deepseek'
  | 'qwen'
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
  /** 是否必须填写 API Key（如 Agnes 免费接口可免 Key） */
  requiresKey?: boolean;
  /** 卡片副文案 */
  hint?: string;
  /** public 下图标路径；无则用通用图标 */
  iconSrc?: string;
  /**
   * 单色 / currentColor 图标：暗色模式下需反白，否则贴在深底上几乎看不见
   * （有品牌色的 SVG 不要开）
   */
  iconMono?: boolean;
}

/**
 * 预设原则：字幕翻译用 Flash / Lite / Mini 档即可，不必上 Pro / Max。
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
    id: 'index-translate',
    name: 'Index-Translate（bilibili）',
    shortName: 'Index',
    baseURL: 'https://index-translate.bilibili.com/v1',
    model: 'Index-Translate-35B-A3B',
    badge: '免费',
    badgeTone: 'free',
    requiresKey: false,
    keyUrl: 'https://github.com/bilibili/Index-Translate',
    // 免 Key 且 CORS 开放，浏览器可直接调；批量建议 ≤10（公共网关约 10s 超时）
    hint: '免 Key · 公开 CORS · 批次建议 ≤10',
    iconSrc: '/icons/providers/index-translate.svg',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    shortName: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    // 旧的 deepseek-chat / deepseek-reasoner 已于 2026-07-24 弃用，别再回填
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
    // Qwen Flash 线最新在售：qwen3.8-flash（其后才是 3.7 / 3.6）
    model: 'qwen3.8-flash',
    keyUrl: 'https://dashscope.console.aliyun.com/',
    hint: '3.8 Flash · 低成本',
    iconSrc: '/icons/providers/qwen.svg',
  },
  {
    id: 'doubao',
    name: '豆包',
    shortName: '豆包',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    // 豆包没有 flash 命名，mini 档即对位档；原 2.1-turbo 已被官方列入「即将下线」
    model: 'doubao-seed-2.0-mini',
    keyUrl: 'https://console.volcengine.com/ark',
    hint: 'Seed 2.0 Mini · 可改成接入点 ID',
    iconSrc: '/icons/providers/doubao.svg',
  },
  {
    id: 'chatgpt',
    name: 'OpenAI',
    shortName: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    // GPT-6 世代分 Astra / Sol / Luna，Luna 即「高效高吞吐」那一档。
    // 注意：6.1 目前只出了 Sol（贵一档），Luna 仍是 gpt-6-luna，没有 6.1-luna
    model: 'gpt-6-luna',
    keyUrl: 'https://platform.openai.com/api-keys',
    hint: 'GPT-6 Luna · 轻量档',
    iconSrc: '/icons/providers/chatgpt.svg',
    iconMono: true,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    shortName: 'Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.8-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    hint: '3.8 Flash · OpenAI 兼容',
    iconSrc: '/icons/providers/gemini.svg',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    shortName: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    // 跟随上面 Gemini 的 flash 档
    model: 'google/gemini-3.8-flash',
    keyUrl: 'https://openrouter.ai/keys',
    hint: '聚合 · 默认 Gemini Flash',
    iconSrc: '/icons/providers/openrouter.svg',
    iconMono: true,
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
    iconMono: true,
  },
];

export function getProviderById(id: LlmProviderId): LlmProviderPreset {
  return (
    LLM_PROVIDER_PRESETS.find((p) => p.id === id) ??
    LLM_PROVIDER_PRESETS.find((p) => p.id === 'custom')!
  );
}
