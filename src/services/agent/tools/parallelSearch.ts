/**
 * Parallel AI web_search（对齐 AsrAgent tools/web.py）
 * - 无需 API Key（Parallel 免费 MCP）
 * - 始终走同源 `/api/parallel-mcp`：
 *   · 本地：Vite proxy → Parallel
 *   · 线上：Cloudflare Pages Function → Parallel
 * 这样浏览器不会直连 parallel.ai，也就没有 CORS 问题。
 */

const MAX_QUERY = 200;
const MIN_QUERY = 3;
const MAX_RESULT_CHARS = 4000;
const DEFAULT_MAX_SEARCHES = 5;

/** 同源代理路径（dev Vite + prod CF Pages Function） */
export function parallelSearchEndpoint(): string {
  return '/api/parallel-mcp';
}

export function extractMcpText(raw: string): string {
  const lines = [raw.trim()];
  for (const ln of raw.split('\n')) {
    if (ln.startsWith('data: ')) lines.push(ln.slice(6).trim());
  }
  for (const candidate of lines) {
    if (!candidate.startsWith('{')) continue;
    try {
      const data = JSON.parse(candidate) as {
        result?: { content?: Array<{ text?: string }> };
      };
      const content = data.result?.content || [];
      for (const item of content) {
        if (item && typeof item.text === 'string' && item.text.trim()) {
          return item.text;
        }
      }
    } catch {
      /* try next */
    }
  }
  return '';
}

export async function parallelWebSearch(
  query: string,
  options?: { sessionId?: string; signal?: AbortSignal }
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const q = query.trim();
  if (q.length < MIN_QUERY) {
    return { ok: false, error: `query too short (min ${MIN_QUERY} chars)` };
  }
  if (q.length > MAX_QUERY) {
    return { ok: false, error: `query too long (max ${MAX_QUERY} chars)` };
  }

  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'web_search',
      arguments: {
        objective: q,
        search_queries: [q],
        session_id: options?.sessionId || 'eggtranslate_session',
      },
    },
  };

  try {
    const res = await fetch(parallelSearchEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status} ${res.statusText || ''}`.trim(),
      };
    }
    const raw = await res.text();
    let text = extractMcpText(raw);
    if (!text) {
      return { ok: false, error: 'no results' };
    }
    if (text.length > MAX_RESULT_CHARS) {
      text = text.slice(0, MAX_RESULT_CHARS) + '…';
    }
    return { ok: true, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Failed to fetch|NetworkError|CORS|Load failed/i.test(msg)) {
      return {
        ok: false,
        error:
          `${msg}. Same-origin proxy /api/parallel-mcp may be missing (deploy CF Pages Function or use pnpm dev).`,
      };
    }
    return { ok: false, error: msg };
  }
}

export { DEFAULT_MAX_SEARCHES };
