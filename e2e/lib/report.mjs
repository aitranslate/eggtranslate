import fs from 'node:fs';
import path from 'node:path';

export function createReporter(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const results = [];

  function pass(name, detail = '') {
    const line = { status: 'PASS', name, detail };
    results.push(line);
    console.log(`  ✓ PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  }

  function fail(name, detail = '') {
    const line = { status: 'FAIL', name, detail };
    results.push(line);
    console.error(`  ✗ FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }

  function skip(name, detail = '') {
    const line = { status: 'SKIP', name, detail };
    results.push(line);
    console.log(`  ○ SKIP  ${name}${detail ? ` — ${detail}` : ''}`);
  }

  function write(fileName = 'report.txt') {
    const passN = results.filter((r) => r.status === 'PASS').length;
    const failN = results.filter((r) => r.status === 'FAIL').length;
    const skipN = results.filter((r) => r.status === 'SKIP').length;
    const body = [
      'EggTranslate agent-browser E2E',
      `Time: ${new Date().toISOString()}`,
      `PASS: ${passN}  FAIL: ${failN}  SKIP: ${skipN}`,
      '----',
      ...results.map((r) => `[${r.status}] ${r.name}${r.detail ? ` :: ${r.detail}` : ''}`),
      '',
    ].join('\n');
    const file = path.join(outDir, fileName);
    fs.writeFileSync(file, body, 'utf8');
    return { passN, failN, skipN, file, results };
  }

  return { pass, fail, skip, write, results };
}
