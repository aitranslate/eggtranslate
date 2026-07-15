import { rateLimiter } from './rateLimiter';
import { API_CONSTANTS } from '@/constants/api';
import { logger } from '@/utils/logger';

// 导入类型并重新导出，保持向后兼容
import type { LLMConfig } from '@/types';
export type { LLMConfig };

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface CallLLMOptions {
  maxRetries?: number;
  temperature?: number;
  signal?: AbortSignal;
}

interface CallLLMStreamOptions extends CallLLMOptions {
  /** 每个 content delta 回调；accumulated 为截至目前的完整文本 */
  onDelta?: (delta: string, accumulated: string) => void;
}

interface CallLLMResult {
  content: string;
  tokensUsed: number;
}

// 模块级的 API Key 轮询索引（避免依赖 React 的 useRef）
let apiKeyIndex = 0;

/**
 * 从多个 API Key 中轮询获取一个
 */
function getNextApiKey(apiKeyStr: string): string {
  const apiKeys = apiKeyStr.split('|').map(key => key.trim()).filter(key => key.length > 0);
  if (apiKeys.length === 0) {
    throw new Error('未配置有效的API密钥');
  }

  const currentIndex = apiKeyIndex % apiKeys.length;
  apiKeyIndex = (apiKeyIndex + 1) % apiKeys.length;

  return apiKeys[currentIndex];
}

function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function emptyContentError(finishReason: string): Error {
  if (finishReason === 'length') {
    return new Error(
      '模型输出被 max_tokens 截断，未生成最终内容。' +
        '推理类模型(如 step-3.7-flash / DeepSeek-R1)的思考过程会消耗大量 token，' +
        '请在配置中减小批次大小(batchSize)。'
    );
  }
  return new Error(
    '模型返回内容为空(content 为空)。该模型可能不兼容 OpenAI 格式，' +
      '或为推理模型将答案放在 reasoning_content 字段中。'
  );
}

/**
 * 统一的 LLM API 调用函数（非流式）
 *
 * 自动具备以下能力：
 * 1. 失败重试（最多 MAX_RETRIES 次，指数退避）
 * 2. 多 API Key 轮询（支持用 | 分隔多个 key）
 * 3. 频率限制（通过 RPM 配置）
 * 4. Token 统计（自动返回消耗的 tokens）
 */
export async function callLLM(
  config: LLMConfig,
  messages: LLMMessage[],
  options: CallLLMOptions = {}
): Promise<CallLLMResult> {
  const { maxRetries = API_CONSTANTS.MAX_RETRIES,
          temperature = API_CONSTANTS.DEFAULT_TEMPERATURE,
          signal } = options;

  if (config.rpm !== undefined) {
    rateLimiter.setRPM(config.rpm);
  }

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('请求被取消', 'AbortError');
    }

    try {
      await rateLimiter.waitForAvailability();

      if (signal?.aborted) {
        throw new DOMException('请求被取消', 'AbortError');
      }

      const apiKey = config.apiKey?.trim() ? getNextApiKey(config.apiKey) : '';

      const response = await fetch(`${config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(apiKey),
        body: JSON.stringify({
          model: config.model,
          messages: messages,
          temperature
        }),
        signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const choice = data.choices?.[0];
      const content: string = choice?.message?.content ?? '';
      const finishReason: string = choice?.finish_reason ?? '';
      const tokensUsed = data.usage?.total_tokens || 0;

      if (!content) {
        throw emptyContentError(finishReason);
      }

      return { content, tokensUsed };
    } catch (error) {
      lastError = error;

      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }

      if (attempt === maxRetries) {
        throw error;
      }

      const delay = 1000 * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * 流式 LLM 调用（OpenAI-compatible SSE）。
 * onDelta 在每个 content 增量时触发；最终返回完整 content + tokens。
 * 若服务端未返回 body 流，自动回退为非流式 callLLM（仍会触发一次 onDelta）。
 */
export async function callLLMStream(
  config: LLMConfig,
  messages: LLMMessage[],
  options: CallLLMStreamOptions = {}
): Promise<CallLLMResult> {
  const {
    maxRetries = API_CONSTANTS.MAX_RETRIES,
    temperature = API_CONSTANTS.DEFAULT_TEMPERATURE,
    signal,
    onDelta,
  } = options;

  if (config.rpm !== undefined) {
    rateLimiter.setRPM(config.rpm);
  }

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('请求被取消', 'AbortError');
    }

    // 本轮尝试专用 AbortController：idle 超时可掐断 fetch，又不误杀整任务 signal
    const attemptAc = new AbortController();
    const onParentAbort = () => attemptAc.abort();
    signal?.addEventListener('abort', onParentAbort);

    try {
      await rateLimiter.waitForAvailability();

      if (signal?.aborted || attemptAc.signal.aborted) {
        throw new DOMException('请求被取消', 'AbortError');
      }

      const apiKey = config.apiKey?.trim() ? getNextApiKey(config.apiKey) : '';

      const response = await fetch(`${config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(apiKey),
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature,
          stream: true,
          // OpenAI 兼容：末帧附带 usage，避免流式 token 统计恒为 0
          stream_options: { include_usage: true },
        }),
        signal: attemptAc.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      // 无流式 body：回退非流式
      if (!response.body) {
        const fallback = await callLLM(config, messages, {
          maxRetries: 1,
          temperature,
          signal: attemptAc.signal,
        });
        onDelta?.(fallback.content, fallback.content);
        return fallback;
      }

      const result = await consumeChatCompletionStream(
        response.body,
        onDelta,
        attemptAc.signal,
        () => attemptAc.abort()
      );

      if (!result.content) {
        throw emptyContentError(result.finishReason);
      }

      return { content: result.content, tokensUsed: result.tokensUsed };
    } catch (error) {
      lastError = error;

      // 任务级取消才向上抛 AbortError；attempt 级 abort 走重试
      if (error instanceof Error && error.name === 'AbortError') {
        if (signal?.aborted) throw error;
        // idle / attempt abort：若没有 content 则按普通错误重试
      }

      if (attempt === maxRetries) {
        throw error;
      }

      const delay = 1000 * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    } finally {
      signal?.removeEventListener('abort', onParentAbort);
    }
  }

  throw lastError;
}

interface StreamConsumeResult {
  content: string;
  tokensUsed: number;
  finishReason: string;
}

/**
 * 解析 OpenAI chat.completions SSE 流。
 * 同时兼容少数网关把完整 JSON 当 body 一次返回的情况。
 */
async function consumeChatCompletionStream(
  body: ReadableStream<Uint8Array>,
  onDelta: ((delta: string, accumulated: string) => void) | undefined,
  signal?: AbortSignal,
  /** idle 时调用：应 abort 本轮 fetch AbortController */
  onIdleTimeout?: () => void
): Promise<StreamConsumeResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let tokensUsed = 0;
  let finishReason = '';
  const idleMs = API_CONSTANTS.STREAM_IDLE_TIMEOUT_MS;

  /** 带空闲超时的 read：卡住时 abort fetch + 抢救已有 content */
  const readChunk = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          idleTimer = setTimeout(() => {
            const msg = `流式响应空闲超时（${Math.round(idleMs / 1000)}s 无新数据），将重试或回退`;
            onIdleTimeout?.();
            reject(new Error(msg));
          }, idleMs);
        }),
      ]);
    } finally {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
    }
  };

  try {
    while (true) {
      if (signal?.aborted) {
        // 空闲 abort 后可能仍有 partial content
        if (content.trim() && finishReason !== 'abort') {
          return { content, tokensUsed, finishReason: finishReason || 'idle_timeout' };
        }
        throw new DOMException('请求被取消', 'AbortError');
      }

      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await readChunk();
      } catch (idleErr) {
        try {
          await reader.cancel(String(idleErr));
        } catch {
          /* ignore */
        }
        logger.error(String(idleErr));
        // 已有部分 content 时仍返回，交给 translateBatch 抢救
        if (content.trim()) {
          return { content, tokensUsed, finishReason: finishReason || 'idle_timeout' };
        }
        throw idleErr;
      }
      const { done, value } = chunk;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE 按行解析；也容忍 \r\n
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(':')) continue;

        // 非 SSE：整段 JSON 一次性响应
        if (line.startsWith('{') && !line.startsWith('data:')) {
          try {
            const data = JSON.parse(line);
            const full: string = data.choices?.[0]?.message?.content ?? '';
            if (full) {
              const delta = full.slice(content.length);
              content = full;
              if (delta) onDelta?.(delta, content);
            }
            tokensUsed = data.usage?.total_tokens || tokensUsed;
            finishReason = data.choices?.[0]?.finish_reason ?? finishReason;
          } catch {
            // 可能是不完整 JSON，拼回 buffer 等待后续
            buffer = line + '\n' + buffer;
          }
          continue;
        }

        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
          const data = JSON.parse(payload);
          const delta: string =
            data.choices?.[0]?.delta?.content ??
            data.choices?.[0]?.message?.content ??
            '';
          if (delta) {
            content += delta;
            onDelta?.(delta, content);
          }
          if (data.choices?.[0]?.finish_reason) {
            finishReason = data.choices[0].finish_reason;
          }
          // 末帧 usage 可能 total_tokens=0 以外的合法值；用 nullish 判断
          if (data.usage?.total_tokens != null) {
            tokensUsed = data.usage.total_tokens;
          }
        } catch {
          // 忽略单行解析失败（残缺 chunk）
        }
      }
    }

    // 处理尾巴
    const tail = buffer.trim();
    if (tail.startsWith('data:')) {
      const payload = tail.slice(5).trim();
      if (payload && payload !== '[DONE]') {
        try {
          const data = JSON.parse(payload);
          const delta: string = data.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            content += delta;
            onDelta?.(delta, content);
          }
          if (data.usage?.total_tokens != null) {
            tokensUsed = data.usage.total_tokens;
          }
          if (data.choices?.[0]?.finish_reason) {
            finishReason = data.choices[0].finish_reason;
          }
        } catch {
          /* ignore */
        }
      }
    } else if (tail.startsWith('{')) {
      try {
        const data = JSON.parse(tail);
        const full: string = data.choices?.[0]?.message?.content ?? '';
        if (full && full !== content) {
          const delta = full.slice(content.length) || full;
          content = full;
          onDelta?.(delta, content);
        }
        if (data.usage?.total_tokens != null) {
          tokensUsed = data.usage.total_tokens;
        }
        finishReason = data.choices?.[0]?.finish_reason ?? finishReason;
      } catch {
        /* ignore */
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { content, tokensUsed, finishReason };
}
