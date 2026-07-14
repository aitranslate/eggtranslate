#!/usr/bin/env node
/**
 * 仅跑移动端冒烟（独立入口）
 *
 *   pnpm test:e2e:mobile
 *   node e2e/run-mobile.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ab from './lib/agent.mjs';
import { ensureServer, stopServer, getBaseUrl } from './lib/server.mjs';
import { createReporter } from './lib/report.mjs';
import { runMobileSmoke } from './lib/mobile-smoke.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'output');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const report = createReporter(OUT);
  console.log('\n📱 EggTranslate mobile-only E2E\n');

  if (!ab.resolveAgentBrowser()) {
    console.error('agent-browser not found.\n  pnpm test:e2e:install\n');
    process.exit(1);
  }

  let child = null;
  try {
    const srv = await ensureServer();
    child = srv.child;
    const baseUrl = getBaseUrl();
    console.log(`  server: ${baseUrl} (${srv.started ? 'started' : 'reused'})\n`);

    ab.closeAll();
    runMobileSmoke({
      baseUrl,
      report,
      outDir: OUT,
      shotPrefix: 'm',
      reopen: true,
    });
  } catch (e) {
    console.error(e);
    report.fail('runner', e instanceof Error ? e.message : String(e));
  } finally {
    try {
      ab.closeAll();
    } catch {
      /* ignore */
    }
    stopServer(child);
  }

  const { failN, file } = report.write('mobile-report.txt');
  console.log(`\n  report: ${file}`);
  console.log(`  shots:  ${OUT}/m-*.png\n`);
  process.exit(failN > 0 ? 1 : 0);
}

main();
