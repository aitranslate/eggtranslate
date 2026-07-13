/**
 * agent-browser wrapper — prefers `batch --json` (reliable on Windows).
 * Single commands still available via ab().
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SESSION = process.env.AGENT_BROWSER_SESSION || 'eggtranslate-e2e';
const DEFAULT_TIMEOUT = Number(process.env.AGENT_BROWSER_DEFAULT_TIMEOUT || 25000);

let cachedBin = undefined;

function candidates() {
  const list = [];
  if (process.env.AGENT_BROWSER_BIN) list.push(process.env.AGENT_BROWSER_BIN);
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  if (process.platform === 'win32') {
    list.push(
      path.join(appData, 'npm', 'node_modules', 'agent-browser', 'bin', 'agent-browser-win32-x64.exe')
    );
  } else if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
    list.push(`/usr/local/lib/node_modules/agent-browser/bin/agent-browser-darwin-${arch}`);
  } else {
    list.push('/usr/lib/node_modules/agent-browser/bin/agent-browser-linux-x64');
  }
  return list;
}

export function resolveAgentBrowser() {
  if (cachedBin !== undefined) return cachedBin;
  for (const c of candidates()) {
    try {
      if (c && fs.existsSync(c)) {
        cachedBin = c;
        return cachedBin;
      }
    } catch {
      /* ignore */
    }
  }
  cachedBin = null;
  return null;
}

function envBase() {
  return {
    ...process.env,
    AGENT_BROWSER_SESSION: SESSION,
    AGENT_BROWSER_DEFAULT_TIMEOUT: String(DEFAULT_TIMEOUT),
  };
}

/**
 * @param {string[]} args
 * @param {{ timeout?: number, input?: string }} [opts]
 */
export function ab(args, { timeout = DEFAULT_TIMEOUT, input } = {}) {
  const bin = resolveAgentBrowser();
  if (!bin) {
    throw new Error(
      'agent-browser binary not found. Run: npm install -g agent-browser && agent-browser install'
    );
  }

  if (process.env.E2E_VERBOSE === '1') {
    console.log(`  $ agent-browser ${args.join(' ')}`);
  }

  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    env: envBase(),
    input,
    shell: false,
    windowsHide: true,
    stdio: input !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    timeout: timeout + 10000,
    maxBuffer: 20 * 1024 * 1024,
  });

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  const out = [stdout, stderr].filter(Boolean).join('\n');

  if (process.env.E2E_VERBOSE === '1' && out) {
    console.log(out.slice(0, 600));
  }

  if (result.error) {
    return {
      ok: false,
      status: -1,
      stdout,
      stderr: stderr || String(result.error),
      out: out || String(result.error),
      error: result.error,
    };
  }

  return {
    ok: result.status === 0,
    status: result.status,
    stdout,
    stderr,
    out,
  };
}

/**
 * Run commands in one agent-browser process (best reliability).
 * @param {string[][]} commands
 * @param {{ timeout?: number, bail?: boolean }} [opts]
 */
export function batch(commands, { timeout = 180000, bail = false } = {}) {
  const args = ['batch', '--json'];
  if (bail) args.push('--bail');
  const r = ab(args, { timeout, input: JSON.stringify(commands) });
  let results = [];
  try {
    results = JSON.parse(r.stdout || '[]');
  } catch {
    // sometimes banners prepend JSON
    const m = (r.stdout || '').match(/\[[\s\S]*\]/);
    if (m) {
      try {
        results = JSON.parse(m[0]);
      } catch {
        results = [];
      }
    }
  }
  return { ...r, results };
}

export function batchEvalResult(item) {
  if (!item) return undefined;
  const r = item.result;
  if (r && typeof r === 'object' && 'result' in r) return r.result;
  return r;
}

export function closeAll() {
  return ab(['close', '--all'], { timeout: 20000 });
}

export function open(url) {
  return ab(['open', url], { timeout: 120000 });
}

export function evalJs(code) {
  const r = ab(['eval', code], { timeout: 30000 });
  let value = r.stdout;
  const lines = value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length) value = lines[lines.length - 1];
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      value = JSON.parse(value);
    } catch {
      value = value.slice(1, -1);
    }
  }
  return { ...r, value };
}

export function screenshot(filePath) {
  return ab(['screenshot', path.resolve(filePath)], { timeout: 30000 });
}

export function wait(ms) {
  return ab(['wait', String(ms)], { timeout: ms + 15000 });
}

export function upload(selector, filePath) {
  return ab(['upload', selector, path.resolve(filePath)], { timeout: 60000 });
}

export function setViewport(w, h) {
  return ab(['set', 'viewport', String(w), String(h)], { timeout: 15000 });
}

export function getUrl() {
  return ab(['get', 'url'], { timeout: 15000 });
}

export function getTitle() {
  return ab(['get', 'title'], { timeout: 15000 });
}

export function errors() {
  return ab(['errors'], { timeout: 15000 });
}
