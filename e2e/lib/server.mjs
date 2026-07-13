/**
 * Start / stop Vite for E2E (bound to 127.0.0.1 for Windows + agent-browser).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

export function getPort() {
  return Number(process.env.E2E_PORT || 5173);
}

export function getBaseUrl() {
  if (process.env.E2E_BASE_URL) return process.env.E2E_BASE_URL.replace(/\/$/, '');
  return `http://127.0.0.1:${getPort()}`;
}

export async function waitForUrl(url, { timeoutMs = 60000, intervalMs = 400 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 304) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export async function ensureServer() {
  const baseUrl = getBaseUrl();
  const port = getPort();

  if (process.env.E2E_SKIP_SERVER === '1') {
    const ok = await waitForUrl(baseUrl, { timeoutMs: 5000 });
    if (!ok) throw new Error(`E2E_SKIP_SERVER=1 but ${baseUrl} is not reachable`);
    return { baseUrl, child: null, started: false };
  }

  if (await waitForUrl(baseUrl, { timeoutMs: 1500, intervalMs: 300 })) {
    return { baseUrl, child: null, started: false };
  }

  const child = spawn(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'vite', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BROWSER: 'none' },
      shell: true,
      windowsHide: true,
    }
  );

  let log = '';
  child.stdout?.on('data', (d) => {
    log += d.toString();
  });
  child.stderr?.on('data', (d) => {
    log += d.toString();
  });

  const ok = await waitForUrl(baseUrl, { timeoutMs: 60000 });
  if (!ok) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { shell: true });
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      /* ignore */
    }
    throw new Error(`Vite failed to start on ${baseUrl}\n${log.slice(-1500)}`);
  }

  return { baseUrl, child, started: true };
}

export function stopServer(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { shell: true });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    /* ignore */
  }
}
