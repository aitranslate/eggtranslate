/**
 * 拉取 OpenAI 兼容接口的模型列表：GET {baseURL}/models
 * 会按 id/能力粗分类型：翻译场景默认只展示对话/文本模型。
 */

export type LlmModelKind = 'chat' | 'image' | 'video' | 'audio' | 'embedding' | 'other';

export interface LlmModelInfo {
  id: string;
  kind: LlmModelKind;
  /** 接口原始对象里可能带的字段，便于调试 */
  rawOwnedBy?: string;
}

function firstApiKey(apiKeyStr: string): string {
  const keys = apiKeyStr
    .split('|')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  if (keys.length === 0) {
    throw new Error('请先填写 API 密钥');
  }
  return keys[0];
}

function normalizeBaseURL(baseURL: string): string {
  const base = (baseURL || '').trim().replace(/\/+$/, '');
  if (!base) {
    throw new Error('请先填写 Base URL');
  }
  return base;
}

/**
 * 根据模型 id / 元数据粗分类型。
 * 厂商很少返回统一的 capability 字段，主要靠命名约定。
 */
export function classifyModelKind(
  id: string,
  extra?: { owned_by?: string; object?: string }
): LlmModelKind {
  const s = id.toLowerCase();

  // 生图
  if (
    /(^|[-_./])(image|img|dall-e|dalle|flux|sdxl|stable-diffusion|seedream|imagen)([-_./]|$)/.test(
      s
    ) ||
    s.includes('text-to-image') ||
    s.includes('t2i')
  ) {
    return 'image';
  }

  // 视频
  if (
    /(^|[-_./])(video|seedance|sora|kling|runway)([-_./]|$)/.test(s) ||
    s.includes('text-to-video') ||
    s.includes('t2v') ||
    s.includes('i2v')
  ) {
    return 'video';
  }

  // 语音
  if (
    /(^|[-_./])(tts|whisper|audio|speech|asr|voice)([-_./]|$)/.test(s) ||
    s.includes('text-to-speech')
  ) {
    return 'audio';
  }

  // 向量
  if (s.includes('embedding') || s.includes('embed') || s.includes('bge-') || s.includes('e5-')) {
    return 'embedding';
  }

  // 明显非对话
  if (s.includes('moderation') || s.includes('rerank') || s.includes('classify')) {
    return 'other';
  }

  // 厂商很少给 capability；其余默认当对话模型（翻译可用）
  void extra;
  return 'chat';
}

export const MODEL_KIND_LABEL: Record<LlmModelKind, string> = {
  chat: '对话',
  image: '生图',
  video: '视频',
  audio: '语音',
  embedding: '向量',
  other: '其他',
};

/** 从常见响应结构中提取模型 */
function extractModels(payload: unknown): LlmModelInfo[] {
  if (!payload || typeof payload !== 'object') return [];

  const root = payload as Record<string, unknown>;
  const items: unknown[] = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.models)
      ? root.models
      : [];

  const result: LlmModelInfo[] = [];

  for (const item of items) {
    if (typeof item === 'string') {
      result.push({ id: item, kind: classifyModelKind(item) });
      continue;
    }
    if (!item || typeof item !== 'object') continue;

    const obj = item as {
      id?: unknown;
      name?: unknown;
      owned_by?: unknown;
      object?: unknown;
    };
    const id =
      typeof obj.id === 'string' ? obj.id : typeof obj.name === 'string' ? obj.name : '';
    if (!id.trim()) continue;

    result.push({
      id: id.trim(),
      kind: classifyModelKind(id, {
        owned_by: typeof obj.owned_by === 'string' ? obj.owned_by : undefined,
        object: typeof obj.object === 'string' ? obj.object : undefined,
      }),
      rawOwnedBy: typeof obj.owned_by === 'string' ? obj.owned_by : undefined,
    });
  }

  return result;
}

export interface ListLlmModelsResult {
  /** 适合翻译的对话/文本模型 */
  chatModels: LlmModelInfo[];
  /** 被过滤掉的非对话模型（生图/视频等） */
  excludedModels: LlmModelInfo[];
  /** 原始全部 */
  allModels: LlmModelInfo[];
}

export async function listLlmModels(
  baseURL: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<ListLlmModelsResult> {
  const base = normalizeBaseURL(baseURL);
  const key = firstApiKey(apiKey);

  let response: Response;
  try {
    response = await fetch(`${base}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
      },
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new Error(
      '无法请求模型列表（网络或 CORS）。可手填模型名，或换支持浏览器直连的接口。'
    );
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const msg =
      (errorData as { error?: { message?: string } })?.error?.message ||
      (errorData as { message?: string })?.message ||
      `HTTP ${response.status}`;
    throw new Error(msg);
  }

  const data = await response.json();
  const extracted = extractModels(data);

  // 去重（保留首次出现）
  const seen = new Set<string>();
  const allModels: LlmModelInfo[] = [];
  for (const m of extracted) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    allModels.push(m);
  }

  // 直接按接口返回的原始顺序倒序展示
  allModels.reverse();

  if (allModels.length === 0) {
    throw new Error('接口已响应，但未解析到模型列表，请手填模型名');
  }

  const chatModels = allModels.filter((m) => m.kind === 'chat');
  const excludedModels = allModels.filter((m) => m.kind !== 'chat');

  return { chatModels, excludedModels, allModels };
}
