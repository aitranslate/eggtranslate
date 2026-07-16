/**
 * Cloudflare Pages Function：同源代理 Parallel AI MCP web_search
 * 路由：POST /api/parallel-mcp → https://search.parallel.ai/mcp
 *
 * 浏览器从 eggtranslate.pages.dev 调同源 API，无 CORS 问题；
 * Worker 侧服务器请求 Parallel（免费、无 Key，对齐 AsrAgent）。
 */

const PARALLEL_MCP = 'https://search.parallel.ai/mcp';

type PagesContext = { request: Request };

export const onRequestPost = async (context: PagesContext) => {
  const incoming = context.request;
  let body: string;
  try {
    body = await incoming.text();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 轻量防护：只转发 JSON-RPC 形态，限制体积
  if (!body || body.length > 32_000) {
    return new Response(JSON.stringify({ error: 'body too large or empty' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const upstream = await fetch(PARALLEL_MCP, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'User-Agent': 'EggTranslate-Pages/1.0',
      },
      body,
    });

    const text = await upstream.text();
    const contentType =
      upstream.headers.get('Content-Type') || 'application/json; charset=utf-8';

    return new Response(text, {
      status: upstream.status,
      headers: {
        'Content-Type': contentType,
        // 同源即可；显式不开放 * 跨域
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ error: 'upstream fetch failed', detail: msg }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};

/** 健康检查 */
export const onRequestGet = async () => {
  return new Response(
    JSON.stringify({
      ok: true,
      proxy: 'parallel-mcp',
      target: PARALLEL_MCP,
      note: 'POST JSON-RPC body to search (no API key)',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
};
