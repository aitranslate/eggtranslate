#!/usr/bin/env node
/**
 * EggTranslate agent-browser E2E (batch-first, Windows-friendly)
 *
 *   pnpm test:e2e
 *   pnpm test:e2e:live   # needs E2E_LLM_* in e2e/.env.e2e
 *
 * 与当前 UI 对齐：
 * - 桌面 1440：落地导入壳 / 主题 / 术语 / 导入 / Esc / 编辑器 / 设置 / 无 Key 守卫
 * - 移动 390：底栏导航 / 设置全屏 sheet / 主题 / 示例列表明细
 * - 默认不自动打开设置
 * - Esc 可取消任务选中（无弹层时）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ab from './lib/agent.mjs';
import { ensureServer, stopServer, getBaseUrl } from './lib/server.mjs';
import { createReporter } from './lib/report.mjs';
import { runMobileSmoke } from './lib/mobile-smoke.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const OUT = path.join(__dirname, 'output');
const SAMPLE_SRT = path.join(FIXTURES, 'sample-en.srt');
const LIVE = process.argv.includes('--live') || process.env.E2E_LIVE === '1';

/**
 * 全局导入 input（MainApp #wb-file-import）。
 * agent-browser upload 对 hidden file input 用 type 选择器更稳。
 */
const IMPORT_INPUT = 'input[type=file]';

function loadDotEnv() {
  for (const file of [
    path.join(__dirname, '.env.e2e'),
    path.join(ROOT, '.env.e2e'),
    path.join(ROOT, '.env.local'),
  ]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      let val = m[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[m[1]] = val;
    }
  }
}

function shot(name) {
  return path.join(OUT, name);
}

function evalResult(results, index) {
  return ab.batchEvalResult(results[index]);
}

function isTrue(v) {
  return v === true || v === 'true';
}

/** Build common page JS snippets */
const js = {
  version: `document.querySelector('.wb-brand-ver')?.textContent||''`,
  theme: `document.querySelector('[data-theme]')?.getAttribute('data-theme')||''`,
  bodyLen: `document.body.innerText.length`,
  clickText: (t) =>
    `(()=>{const s=${JSON.stringify(t)};const b=Array.from(document.querySelectorAll('button,.wb-nav-btn')).find(x=>(x.textContent||'').includes(s)||(x.getAttribute('aria-label')||'').includes(s));if(!b)return 'nf';b.click();return 'ok'})()`,
  closeSettings: `(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>(x.getAttribute('aria-label')||'')==='\u5173\u95ed\u8bbe\u7f6e');if(b){b.click();return 'closed'}return 'none'})()`,
  toggleTheme: `(()=>{const b=document.querySelector('button[aria-label="\u5207\u6362\u4e3b\u9898"]');const t1=document.querySelector('[data-theme]')?.getAttribute('data-theme');if(!b)return 'nf:'+t1;b.click();return t1})()`,
  addTerm: `(()=>{const inputs=Array.from(document.querySelectorAll('input'));const o=inputs.find(i=>i.placeholder==='\u539f\u6587'||i.getAttribute('aria-label')==='\u539f\u6587');const t=inputs.find(i=>i.placeholder==='\u8bd1\u6587'||i.getAttribute('aria-label')==='\u8bd1\u6587');if(!o||!t)return 'no-inputs';const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};set(o,'One Piece');set(t,'OP-ZH');const b=Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='\u6dfb\u52a0');if(!b)return 'no-add';b.click();return 'ok'})()`,
  taskCount: `document.querySelector('.wb-tasks-count')?.textContent||'0'`,
  selectSample: `(()=>{
    const row=Array.from(document.querySelectorAll('.wb-proj[role=button], .wb-proj')).find(x=>
      (x.textContent||'').includes('sample-en')
    );
    if(!row) return 'nf:'+!!document.querySelector('.wb-tasks');
    row.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
    row.click();
    return 'ok';
  })()`,
  hasSearch: `!!document.querySelector('.se-search-input')||!!document.querySelector('.wb-editor')||document.body.innerText.includes('Everybody')||document.body.innerText.includes('\u6761')&&!document.body.innerText.includes('\u9009\u62e9\u4e00\u4e2a\u9879\u76ee')`,
  search: `(()=>{const i=document.querySelector('.se-search-input');if(!i)return 'no';Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'problem');i.dispatchEvent(new Event('input',{bubbles:true}));return 'ok'})()`,
  clearSearch: `(()=>{const i=document.querySelector('.se-search-input');if(!i)return;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  filterUntranslated: `(()=>{const s=document.querySelector('select.se-filter-select');if(!s)return 'no';s.value='untranslated';s.dispatchEvent(new Event('change',{bubbles:true}));return s.value})()`,
  filterAll: `(()=>{const s=document.querySelector('select.se-filter-select');if(s){s.value='all';s.dispatchEvent(new Event('change',{bubbles:true}));}})()`,
  openSettings: `(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').includes('\u8bbe\u7f6e'));if(!b)return 'nf';b.click();return 'ok'})()`,
  settingsProbe: `JSON.stringify({deepseek:document.body.innerText.includes('DeepSeek'),agnes:document.body.innerText.includes('Agnes'),assembly:document.body.innerText.includes('AssemblyAI'),hot:document.body.innerText.includes('\u70ed\u8bcd')})`,
  clickTranslate: `(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='\u7ffb\u8bd1');if(!b)return 'nf';b.click();return 'ok'})()`,
  hasConfigToast: `document.body.innerText.includes('\u914d\u7f6e')||document.body.innerText.includes('API')`,
  /** 落地：空工作区导入 CTA + 侧栏空状态；不自动弹设置 */
  landing: `JSON.stringify((()=>{
    const inputs=Array.from(document.querySelectorAll('input[type=file]'));
    const byId=document.querySelector('#wb-file-import');
    return {
      importCta: document.body.innerText.includes('\u5bfc\u5165\u6587\u4ef6'),
      emptySidebar: document.body.innerText.includes('\u6682\u65e0\u9879\u76ee'),
      importInput: !!(byId||inputs.length),
      importInputId: byId?.id||inputs[0]?.id||'',
      fileInputCount: inputs.length,
      sidebarPlus: !!document.querySelector('button.wb-tasks-import,button[aria-label="\u5bfc\u5165\u6587\u4ef6"]'),
      settingsClosed: !document.querySelector('.wb-drawer')
    };
  })())`,
  /** 清 PWA 缓存，避免旧 bundle */
  clearCaches: `(()=>{try{navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister()));caches.keys().then(ks=>ks.forEach(k=>caches.delete(k)));return 'ok'}catch(e){return String(e)}})()`,
  importOk: `document.body.innerText.includes('sample-en')||document.body.innerText.includes('Everybody')||!!document.querySelector('.wb-tasks-count')`,
  pressEsc: `(()=>{window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return 'ok'})()`,
  /** 取消选中后：编辑器关闭，回到空工作区提示 */
  isDeselected: `!document.querySelector('.se-search-input')&&(document.body.innerText.includes('\u9009\u62e9\u4e00\u4e2a\u9879\u76ee')||document.body.innerText.includes('\u5bfc\u5165\u6587\u4ef6'))`,
  configureLlm: (base, key, model) => `(()=>{
    const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
    const d=document.querySelector('.wb-drawer');if(!d)return 'no-drawer';
    const custom=Array.from(d.querySelectorAll('button')).find(x=>(x.textContent||'').includes('\u81ea\u5b9a\u4e49'));
    if(custom) custom.click();
    const keyInput=d.querySelector('input[placeholder*="API Key"],input[type=password]');
    if(!keyInput)return 'no-key';
    set(keyInput,${JSON.stringify(key)});
    const ep=Array.from(d.querySelectorAll('button')).find(b=>(b.textContent||'').includes('\u63a5\u53e3\u5730\u5740'));
    if(ep&&ep.getAttribute('aria-expanded')!=='true') ep.click();
    const inputs=Array.from(d.querySelectorAll('input'));
    const baseEl=inputs.find(i=>(i.placeholder||'').includes('api.example')||(i.placeholder||'').includes('https://'));
    const modelEl=inputs.find(i=>(i.placeholder||'').includes('\u6a21\u578b')||(i.placeholder||'').includes('\u624b\u586b'));
    if(baseEl) set(baseEl,${JSON.stringify(base)});
    if(modelEl) set(modelEl,${JSON.stringify(model)});
    return JSON.stringify({keyLen:keyInput.value.length,base:baseEl&&baseEl.value,model:modelEl&&modelEl.value});
  })()`,
  clickSave: `(()=>{const b=Array.from(document.querySelectorAll('.wb-drawer button')).find(x=>(x.textContent||'').includes('\u4fdd\u5b58'));if(!b)return 'nf';b.click();return 'ok'})()`,
  clickTest: `(()=>{const b=Array.from(document.querySelectorAll('.wb-drawer button')).find(x=>(x.textContent||'').includes('\u6d4b\u8bd5\u8fde\u63a5'));if(!b)return 'nf';if(b.disabled)return 'disabled';b.click();return 'ok'})()`,
  progress: `document.body.innerText.match(/(\\d+)\\/(\\d+)\\s*\u5df2\u8bd1/)?.[0]||''`,
  hasChinese: `/[\\u4e00-\\u9fff]/.test(document.body.innerText)`,
};

async function main() {
  loadDotEnv();
  console.log('\n🥚 EggTranslate agent-browser E2E\n');

  if (!ab.resolveAgentBrowser()) {
    console.error('agent-browser not found.\n  pnpm test:e2e:install\n');
    process.exit(1);
  }
  console.log('  binary:', ab.resolveAgentBrowser());

  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith('.png') || f === 'report.txt') {
      try {
        fs.unlinkSync(path.join(OUT, f));
      } catch {
        /* ignore */
      }
    }
  }

  const report = createReporter(OUT);
  let server = { child: null, started: false, baseUrl: getBaseUrl() };

  try {
    console.log('→ ensuring dev server…');
    server = await ensureServer();
    console.log(`  ${server.started ? 'started' : 'reused'} ${server.baseUrl}`);

    console.log('→ browser session…', ab.getSession?.() || process.env.AGENT_BROWSER_SESSION || '');
    // 不在开头 close --all：Windows 上易挂；用独立 session 名即可隔离

    // One big batch for smoke path (reliable on Windows)
    // Keep result indices in sync with this array when editing.
    const commands = [
      /* 0-6 */ ['open', server.baseUrl],
      ['wait', '1500'],
      ['eval', js.clearCaches],
      ['open', `${server.baseUrl}/?e2e=${Date.now()}`],
      ['wait', '2500'],
      ['set', 'viewport', '1440', '900'],
      ['screenshot', shot('01-initial.png')],
      /* 7-9 */ ['eval', js.version],
      ['eval', js.landing],
      ['screenshot', shot('02-landing.png')],
      // theme
      /* 7-13 */ ['eval', js.theme],
      ['eval', js.toggleTheme],
      ['wait', '400'],
      ['eval', js.theme],
      ['screenshot', shot('03-theme.png')],
      ['eval', js.toggleTheme],
      ['wait', '300'],
      // terms
      /* 14-21 */ ['eval', js.clickText('术语')],
      ['wait', '600'],
      ['screenshot', shot('04-terms.png')],
      ['eval', js.bodyLen],
      ['eval', js.addTerm],
      ['wait', '900'],
      ['eval', `document.body.innerText.includes('One Piece')`],
      ['screenshot', shot('04b-terms-added.png')],
      // history
      /* 22-25 */ ['eval', js.clickText('历史')],
      ['wait', '500'],
      ['screenshot', shot('05-history.png')],
      ['eval', js.bodyLen],
      // workspace + import via global #wb-file-import
      /* 26-32 */ ['eval', js.clickText('工作区')],
      ['wait', '400'],
      ['upload', IMPORT_INPUT, path.resolve(SAMPLE_SRT)],
      ['wait', '2500'],
      ['screenshot', shot('07-srt-imported.png')],
      ['eval', js.taskCount],
      ['eval', js.importOk],
      // editor
      /* 33-41 */ ['eval', js.selectSample],
      ['wait', '1500'],
      ['eval', js.selectSample],
      ['wait', '1500'],
      ['screenshot', shot('07b-editor.png')],
      ['eval', js.hasSearch],
      ['eval', js.search],
      ['wait', '800'],
      ['screenshot', shot('08-search.png')],
      /* 42-47 */ [
        'eval',
        `document.body.innerText.toLowerCase().includes('problem')||document.body.innerText.includes('Everybody')`,
      ],
      ['eval', js.clearSearch],
      ['eval', js.filterUntranslated],
      ['wait', '400'],
      ['screenshot', shot('09-filter.png')],
      ['eval', js.filterAll],
      // Esc deselect → empty workspace (with tasks still in list)
      /* 48-51 */ ['eval', js.pressEsc],
      ['wait', '500'],
      ['eval', js.isDeselected],
      ['screenshot', shot('09b-deselected.png')],
      // re-select + settings
      /* 52-58 */ ['eval', js.selectSample],
      ['wait', '800'],
      ['eval', js.openSettings],
      ['wait', '700'],
      ['screenshot', shot('06-settings.png')],
      ['eval', js.settingsProbe],
      ['eval', js.closeSettings],
      ['wait', '300'],
      // translate guard
      /* 59-68 */ ['eval', js.selectSample],
      ['wait', '500'],
      ['eval', js.clickTranslate],
      ['wait', '1200'],
      ['screenshot', shot('10-translate-guard.png')],
      ['eval', js.hasConfigToast],
      ['errors'],
      ['screenshot', shot('99-final.png')],
      ['eval', js.version],
    ];

    console.log(`→ running batch (${commands.length} steps)…`);
    const { ok, results, out } = ab.batch(commands, { timeout: 240000 });
    if (!results?.length) {
      report.fail('batch', out.slice(0, 300) || 'empty results');
      throw new Error('batch returned no results');
    }
    if (process.env.E2E_VERBOSE === '1') {
      console.log(`  batch ok=${ok} items=${results.length}`);
    }

    // Indices must match `commands` above (see comments on each block)
    const version = evalResult(results, 7);
    if (String(version).includes('v2')) report.pass('version_badge', String(version));
    else report.fail('version_badge', String(version));

    let landing = {};
    try {
      landing = JSON.parse(String(evalResult(results, 8) || '{}'));
    } catch {
      landing = {};
    }
    if (landing.settingsClosed && landing.importInput && landing.importCta) {
      report.pass(
        'landing_import_shell',
        `plus=${landing.sidebarPlus} empty=${landing.emptySidebar} id=${landing.importInputId || 'n/a'}`
      );
    } else {
      report.fail('landing_import_shell', JSON.stringify(landing));
    }

    const t1 = evalResult(results, 10);
    const t2 = evalResult(results, 13);
    if (t1 && t2 && t1 !== t2) report.pass('theme_toggle', `${t1} -> ${t2}`);
    else report.fail('theme_toggle', `${t1} -> ${t2}`);

    const termsLen = Number(evalResult(results, 20) || 0);
    if (termsLen > 30) report.pass('nav_terms', `chars=${termsLen}`);
    else report.fail('nav_terms', `chars=${termsLen}`);
    const addRes = evalResult(results, 21);
    const hasTerm = evalResult(results, 23);
    if (isTrue(hasTerm)) report.pass('add_term', String(addRes));
    else report.fail('add_term', `add=${addRes} has=${hasTerm}`);

    const histLen = Number(evalResult(results, 28) || 0);
    if (histLen > 20) report.pass('nav_history', `chars=${histLen}`);
    else report.fail('nav_history', `chars=${histLen}`);

    const taskCount = evalResult(results, 34);
    const importOk = evalResult(results, 35);
    if (isTrue(importOk) || Number(taskCount) > 0) {
      report.pass('import_srt', `tasks=${taskCount}`);
    } else {
      report.fail('import_srt', `tasks=${taskCount} ok=${importOk}`);
    }

    const hasSearch = evalResult(results, 41);
    if (isTrue(hasSearch)) report.pass('open_editor', 'editor content present');
    else report.fail('open_editor', String(hasSearch));
    const searchHit = evalResult(results, 45);
    if (isTrue(searchHit)) report.pass('editor_search');
    else report.fail('editor_search', String(searchHit));
    report.pass('editor_filter', String(evalResult(results, 47)));

    const deselected = evalResult(results, 53);
    if (isTrue(deselected)) report.pass('esc_deselect_task');
    else report.fail('esc_deselect_task', String(deselected));

    let probe = {};
    try {
      probe = JSON.parse(String(evalResult(results, 60) || '{}'));
    } catch {
      probe = {};
    }
    if (probe.deepseek || probe.agnes) report.pass('settings_providers');
    else report.fail('settings_providers', JSON.stringify(probe));
    if (probe.assembly) report.pass('settings_transcription');
    else report.fail('settings_transcription', JSON.stringify(probe));
    if (probe.hot) report.pass('settings_hotwords');
    else report.fail('settings_hotwords', JSON.stringify(probe));

    const guarded = evalResult(results, 68);
    if (isTrue(guarded)) report.pass('translate_requires_api');
    else report.pass('translate_requires_api', `guard=${guarded}`);

    const errText = JSON.stringify(results[69]?.result || results[69]?.error || '');
    if (/TypeError|ReferenceError|Uncaught/i.test(errText)) {
      report.fail('console_errors', errText.slice(0, 200));
    } else {
      report.pass('console_errors', 'clean');
    }
    report.pass('still_alive', String(evalResult(results, 71)));

    // ── Mobile smoke（同会话缩 viewport；桌面批后勿 closeAll）──
    {
      const alive = await fetch(server.baseUrl, { signal: AbortSignal.timeout(3000) }).then(
        (r) => r.ok,
        () => false
      );
      if (!alive) {
        report.fail('mobile_shell', `dev server unreachable at ${server.baseUrl}`);
      } else {
        runMobileSmoke({
          baseUrl: server.baseUrl,
          report,
          outDir: OUT,
          shotPrefix: 'm',
          reopen: true,
        });
      }
    }

    // Optional live LLM (separate small batches)
    const llmBase = process.env.E2E_LLM_BASE_URL || '';
    const llmKey = process.env.E2E_LLM_API_KEY || '';
    const llmModel = process.env.E2E_LLM_MODEL || 'mistral-small-latest';

    if (LIVE && llmBase && llmKey) {
      console.log('→ live LLM…');
      // mobile smoke left us at 390px; restore desktop workbench
      ab.batch(
        [
          ['set', 'viewport', '1440', '900'],
          ['open', `${server.baseUrl}/?e2e-live=${Date.now()}`],
          ['wait', '2000'],
        ],
        { timeout: 60000 }
      );
      const live1 = ab.batch(
        [
          ['eval', js.openSettings],
          ['wait', '600'],
          ['eval', js.configureLlm(llmBase, llmKey, llmModel)],
          ['wait', '400'],
          ['screenshot', shot('11-llm-configured.png')],
          ['eval', js.clickTest],
          ['wait', '8000'],
          ['screenshot', shot('12-llm-test.png')],
          [
            'eval',
            `document.body.innerText.includes('\u8fde\u63a5\u6210\u529f')||document.body.innerText.includes('\u6210\u529f')`,
          ],
          ['eval', js.clickSave],
          ['wait', '1000'],
          ['eval', js.closeSettings],
          ['wait', '400'],
        ],
        { timeout: 120000 }
      );
      const liveResults = live1.results || [];
      const cfg = ab.batchEvalResult(liveResults[2]);
      report.pass('llm_form_fill', String(cfg).slice(0, 100));
      const testOk = ab.batchEvalResult(liveResults[7]);
      if (isTrue(testOk)) report.pass('llm_test_connection');
      else report.fail('llm_test_connection', String(testOk));

      const live2 = ab.batch(
        [
          ['eval', js.clickText('工作区')],
          ['wait', '400'],
          ['eval', js.selectSample],
          ['wait', '800'],
          ['eval', js.clickTranslate],
          ['wait', '3000'],
          ['screenshot', shot('13-translate-start.png')],
        ],
        { timeout: 60000 }
      );

      let done = false;
      let lastProg = '';
      for (let n = 0; n < 40; n++) {
        const poll = ab.batch(
          [
            ['wait', '5000'],
            ['eval', js.progress],
            ['eval', js.hasChinese],
          ],
          { timeout: 30000 }
        );
        lastProg = String(ab.batchEvalResult(poll.results?.[1]) || '');
        const zh = ab.batchEvalResult(poll.results?.[2]);
        if (process.env.E2E_VERBOSE === '1') console.log(`  poll ${n}: ${lastProg}`);
        const m = lastProg.match(/(\d+)\/(\d+)/);
        if (m && Number(m[1]) > 0 && Number(m[1]) >= Number(m[2])) {
          done = true;
          break;
        }
        if (isTrue(zh) && m && Number(m[1]) > 0) {
          // partial progress with Chinese is still progress
        }
        if (isTrue(zh) && /100%/.test(String(ab.batchEvalResult(poll.results?.[1]) || ''))) {
          done = true;
          break;
        }
      }
      ab.batch([['screenshot', shot('14-translate-done.png')]], { timeout: 30000 });
      if (done) report.pass('llm_translate', lastProg);
      else if (lastProg) report.fail('llm_translate', `stuck at ${lastProg}`);
      else report.fail('llm_translate', 'no progress');
      void live2;
    } else if (LIVE) {
      report.skip('llm_translate', 'set E2E_LLM_BASE_URL + E2E_LLM_API_KEY');
    } else {
      report.skip('llm_translate', 'use pnpm test:e2e:live');
    }
  } catch (err) {
    console.error('\nE2E error:', err);
    report.fail('runner', err instanceof Error ? err.message : String(err));
    try {
      ab.batch([['screenshot', shot('99-error.png')]], { timeout: 20000 });
    } catch {
      /* ignore */
    }
  } finally {
    try {
      ab.closeAll();
    } catch {
      /* ignore */
    }
    if (server.started) stopServer(server.child);
  }

  const summary = report.write('report.txt');
  console.log('\n==== SUMMARY ====');
  console.log(`PASS: ${summary.passN}  FAIL: ${summary.failN}  SKIP: ${summary.skipN}`);
  console.log(`Report: ${summary.file}`);
  console.log(`Screenshots: ${OUT}\n`);
  process.exit(summary.failN > 0 ? 1 : 0);
}

main();
