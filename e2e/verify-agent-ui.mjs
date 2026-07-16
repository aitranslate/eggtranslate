/**
 * Agent 过程 UI 落地验证（agent-browser）
 * 1. 导入示例字幕打开编辑器
 * 2. DEV hook 注入 Agent 运行态（fileId = file_${taskId}）
 * 3. 断言阶段摘要 + 大脑面板 + 任务卡短徽章 + Agent 关闭门控
 * 4. 截图写入 SCRATCH
 *
 * Usage: node e2e/verify-agent-ui.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ab, resolveAgentBrowser } from './lib/agent.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRATCH =
  process.env.AGENT_UI_SCRATCH ||
  path.join(
    process.env.TEMP || process.env.TMP || '/tmp',
    'grok-goal-a7fa4a8f53d3',
    'implementer'
  );
const OUT = fs.existsSync(path.dirname(SCRATCH))
  ? SCRATCH
  : path.join(ROOT, 'e2e', 'output', 'agent-ui');

fs.mkdirSync(OUT, { recursive: true });

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';
const report = [];
const failures = [];

function log(msg) {
  console.log(msg);
  report.push(msg);
}
function fail(msg) {
  failures.push(msg);
  log(`FAIL: ${msg}`);
}
function ok(msg) {
  log(`OK: ${msg}`);
}
function shot(name) {
  const p = path.join(OUT, name);
  const r = ab(['screenshot', p], { timeout: 20000 });
  if (!r.ok) fail(`screenshot ${name}: ${r.out}`);
  else ok(`screenshot → ${p}`);
  return p;
}
function evalJs(code) {
  return ab(['eval', code], { timeout: 15000 });
}
function countSel(sel) {
  const r = ab(['get', 'count', sel], { timeout: 10000 });
  const n = Number((r.stdout || '').trim());
  return Number.isFinite(n) ? n : 0;
}
function parseJsonOut(r) {
  const raw = (r.stdout || r.out || '').trim();
  const line = raw.split('\n').filter(Boolean).pop() || '{}';
  try {
    let v = JSON.parse(line);
    // agent-browser eval 有时再包一层字符串
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v);
      } catch {
        /* keep string */
      }
    }
    if (v && typeof v === 'object') return v;
    return { ok: false, reason: 'parse-not-object', raw: line };
  } catch {
    return { ok: false, reason: 'parse', raw: line };
  }
}

const SEED_JS = `(() => {
  const cfg = window.__eggTranslationConfigStore;
  const agent = window.__eggAgentRunStore;
  const files = window.__eggFilesStore;
  if (!cfg || !agent || !files) {
    return JSON.stringify({
      ok: false,
      reason: 'dev-hooks-missing',
      hooks: { cfg: !!cfg, agent: !!agent, files: !!files },
    });
  }
  const toFileId = (taskId) =>
    !taskId ? null : String(taskId).startsWith('file_') ? String(taskId) : 'file_' + taskId;
  const st = files.getState();
  let task = null;
  let fileId = st.selectedFileId;
  if (fileId) {
    task = (st.tasks || []).find(
      (t) => toFileId(t.taskId) === fileId || t.taskId === fileId
    );
  }
  if (!task && st.tasks && st.tasks.length) {
    task = st.tasks[0];
    fileId = toFileId(task.taskId);
    if (typeof st.setSelectedFileId === 'function') st.setSelectedFileId(fileId);
  }
  if (!fileId) {
    return JSON.stringify({ ok: false, reason: 'no-file', tasks: (st.tasks || []).length });
  }
  const taskId = (task && task.taskId) || String(fileId).replace(/^file_/, '');
  cfg.getState().updateConfig({ agentTranslationEnabled: true });
  const apply = (ev) => agent.getState().applyEvent(fileId, taskId, ev);
  apply({ type: 'pipeline_start', totalEntries: 32, totalWindows: 4 });
  apply({ type: 'stage', stage: 'terminology', detail: 'Terminology Agent…' });
  apply({
    type: 'terminology_done',
    glossary: [{ source: 'Hello', target: '你好' }],
    styleGuide: 'Natural tone.',
    tokensUsed: 12,
  });
  apply({ type: 'window_start', windowIndex: 1, entryIds: [1, 2, 3] });
  apply({
    type: 'progress',
    completedEntries: 12,
    totalEntries: 32,
    statusText: 'Agent：12/32 · 窗 2/4',
  });
  const status = agent.getState().byFileId[fileId];
  return JSON.stringify({
    ok: true,
    fileId,
    taskId,
    badge: status && status.compactBadge,
    summary: status && status.compactSummary,
    active: status && status.active,
    agentEnabled: cfg.getState().config.agentTranslationEnabled,
  });
})()`;

function writeReport() {
  const body = [
    '# Agent UI browser verify',
    `time: ${new Date().toISOString()}`,
    `failures: ${failures.length}`,
    '',
    ...report,
    '',
    failures.length ? '## Failures' : '## Result: PASS',
    ...failures.map((f) => `- ${f}`),
    '',
  ].join('\n');
  const p = path.join(OUT, 'agent-ui-browser-report.txt');
  fs.writeFileSync(p, body, 'utf8');
  console.log(`\nReport: ${p}`);
  if (failures.length) console.error(`\n${failures.length} failure(s)`);
  else console.log('\nAll browser checks passed');
}

async function main() {
  log(`SCRATCH/OUT: ${OUT}`);
  log(`BASE: ${BASE}`);

  if (!resolveAgentBrowser()) {
    fail('agent-browser binary not found');
    writeReport();
    process.exit(2);
  }

  // close 在 Windows 上偶发非 0；不阻断
  ab(['close'], { timeout: 15000 });

  let r = ab(['open', BASE], { timeout: 45000 });
  // agent-browser 有时打印成功文案但 exit≠0；以 URL/标题为准
  const opened =
    r.ok ||
    /127\.0\.0\.1:5173|蛋蛋字幕|localhost:5173/i.test(r.out || r.stdout || '');
  if (!opened) {
    fail(`open ${BASE}: ${r.out}`);
    writeReport();
    process.exit(1);
  }
  ok(`opened ${BASE}`);
  ab(['wait', '--load', 'networkidle'], { timeout: 30000 });
  ab(['wait', 1000], { timeout: 5000 });
  shot('01-landing.png');

  if (countSel('[data-testid="desktop-sample-import"]') > 0) {
    ab(['find', 'testid', 'desktop-sample-import', 'click'], { timeout: 15000 });
    ab(['wait', 2000], { timeout: 10000 });
  } else {
    evalJs(`(() => {
      const row = document.querySelector('.wb-proj-row, [data-testid="task-row"], .m-task-card');
      if (row) row.click();
      return !!row;
    })()`);
    ab(['wait', 800], { timeout: 5000 });
  }

  let seed = parseJsonOut(evalJs(SEED_JS));
  log(`seed: ${JSON.stringify(seed)}`);

  if (!seed.ok && seed.reason === 'dev-hooks-missing') {
    ab(['reload'], { timeout: 20000 });
    ab(['wait', '--load', 'networkidle'], { timeout: 30000 });
    ab(['wait', 1200], { timeout: 5000 });
    if (countSel('[data-testid="desktop-sample-import"]') > 0) {
      ab(['find', 'testid', 'desktop-sample-import', 'click'], { timeout: 15000 });
      ab(['wait', 2000], { timeout: 10000 });
    }
    seed = parseJsonOut(evalJs(SEED_JS));
    log(`seed retry: ${JSON.stringify(seed)}`);
  }

  if (!seed.ok) {
    fail(`seed agent state failed: ${JSON.stringify(seed)}`);
    shot('99-seed-failed.png');
    writeReport();
    process.exit(1);
  }
  ok(`seeded fileId=${seed.fileId} badge=${seed.badge}`);

  ab(['wait', 600], { timeout: 3000 });
  shot('02-seeded-editor.png');

  let procCount = countSel('[data-testid="agent-process-control"]');
  if (procCount < 1) {
    fail('agent-process-control not in DOM after seed');
    const dump = evalJs(`(() => JSON.stringify({
      agentKeys: Object.keys(window.__eggAgentRunStore?.getState()?.byFileId || {}),
      selected: window.__eggFilesStore?.getState()?.selectedFileId,
      tasks: (window.__eggFilesStore?.getState()?.tasks || []).map(t => t.taskId),
      agentEnabled: window.__eggTranslationConfigStore?.getState()?.config?.agentTranslationEnabled,
    }))()`);
    log(`debug: ${dump.stdout || dump.out}`);
    shot('99-no-control.png');
  } else {
    ok('agent-process-control present');
  }

  const summaryText = ab(['get', 'text', '[data-testid="agent-stage-summary"]'], {
    timeout: 10000,
  });
  const summary = (summaryText.stdout || '').trim();
  log(`stage summary text: "${summary}"`);
  if (!summary) fail('empty stage summary');
  else if (summary.length > 40) fail(`stage summary too long: ${summary.length}`);
  else ok(`stage summary short: ${summary}`);

  const badgeCount = countSel('[data-testid="task-agent-badge"]');
  if (badgeCount < 1) {
    log('WARN: task-agent-badge not found (layout may hide list)');
  } else {
    const badgeText = ab(['get', 'text', '[data-testid="task-agent-badge"]'], {
      timeout: 10000,
    });
    const bt = (badgeText.stdout || '').trim();
    log(`task badge: "${bt}"`);
    if (bt.replace(/^[·\s]+/, '').length > 28) fail(`task badge too long: ${bt}`);
    else ok(`task badge short: ${bt}`);
  }

  ab(['find', 'testid', 'agent-brain-trigger', 'click'], { timeout: 10000 });
  ab(['wait', 400], { timeout: 3000 });
  if (countSel('[data-testid="agent-brain-panel"]') < 1) fail('brain panel not open after click');
  else ok('brain panel open');

  const stepsCount = countSel('[data-testid="agent-brain-steps"] [data-stage]');
  if (stepsCount < 4) fail(`expected 4 steps, got ${stepsCount}`);
  else ok(`brain steps = ${stepsCount}`);

  shot('03-brain-panel-open.png');

  ab(['find', 'testid', 'agent-brain-close', 'click'], { timeout: 10000 });
  ab(['wait', 300], { timeout: 3000 });
  if (countSel('[data-testid="agent-brain-panel"]') > 0) fail('brain panel still open after close');
  else ok('brain panel closed');

  evalJs(`(() => {
    window.__eggTranslationConfigStore.getState().updateConfig({ agentTranslationEnabled: false });
    return true;
  })()`);
  ab(['wait', 400], { timeout: 3000 });
  if (countSel('[data-testid="agent-process-control"]') > 0) {
    fail('process control still visible when agent disabled');
  } else {
    ok('gated off when agentTranslationEnabled=false');
  }
  shot('04-agent-gated-off.png');

  evalJs(`(() => {
    window.__eggTranslationConfigStore.getState().updateConfig({ agentTranslationEnabled: true });
    return true;
  })()`);
  ab(['wait', 400], { timeout: 3000 });
  shot('05-final.png');

  ab(['close'], { timeout: 10000 });
  writeReport();
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
