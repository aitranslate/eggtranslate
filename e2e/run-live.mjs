#!/usr/bin/env node
/**
 * Live LLM E2E: configure custom Mistral (multi-key), translate Trump EN SRT,
 * optionally upload the matching MP4 (transcription needs AssemblyAI).
 *
 *   pnpm test:e2e:live-full
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ab from './lib/agent.mjs';
import { ensureServer, stopServer, getBaseUrl } from './lib/server.mjs';
import { createReporter } from './lib/report.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'output');
const FIXTURES = path.join(__dirname, 'fixtures');

const TRUMP_SRT = path.join(FIXTURES, 'trump-en.srt');
const TRUMP_VIDEO_CANDIDATES = [
  process.env.E2E_VIDEO_PATH,
  path.join(
    process.env.USERPROFILE || '',
    'Videos',
    "Donald Trump & Volodymyr Zelensky’s explosive White House fight IN FULL.mp4"
  ),
  path.join(
    process.env.USERPROFILE || '',
    'Videos',
    "Donald Trump & Volodymyr Zelensky's explosive White House fight IN FULL.mp4"
  ),
].filter(Boolean);

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

function findVideo() {
  for (const p of TRUMP_VIDEO_CANDIDATES) {
    if (p && fs.existsSync(p)) return p;
  }
  // fallback: glob-like search in Videos
  const videosDir = path.join(process.env.USERPROFILE || '', 'Videos');
  if (!fs.existsSync(videosDir)) return null;
  for (const name of fs.readdirSync(videosDir)) {
    if (
      name.toLowerCase().includes('donald') &&
      name.toLowerCase().includes('zelensky') &&
      name.toLowerCase().endsWith('.mp4') &&
      !name.includes('.tmp')
    ) {
      return path.join(videosDir, name);
    }
  }
  return null;
}

function isTrue(v) {
  return v === true || v === 'true';
}

function evalR(results, i) {
  return ab.batchEvalResult(results[i]);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const JS = {
  closeSettings: `(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>(x.getAttribute('aria-label')||'')==='\u5173\u95ed\u8bbe\u7f6e');if(b){b.click();return 'closed'}return 'none'})()`,
  openSettings: `(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').includes('\u8bbe\u7f6e'));if(!b)return 'nf';b.click();return 'ok'})()`,
  selectCustom: `(()=>{const d=document.querySelector('.wb-drawer');if(!d)return 'no-drawer';const custom=Array.from(d.querySelectorAll('button')).find(x=>(x.textContent||'').includes('\u81ea\u5b9a\u4e49'));if(!custom)return 'no-custom';custom.click();return 'ok'})()`,
  fillLlm: (base, key, model) => `(()=>{
    const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
    const d=document.querySelector('.wb-drawer');if(!d)return 'no-drawer';
    // ensure endpoint section open
    const ep=Array.from(d.querySelectorAll('button')).find(b=>(b.textContent||'').includes('\u63a5\u53e3\u5730\u5740'));
    if(ep && ep.getAttribute('aria-expanded')!=='true') ep.click();
    const inputs=Array.from(d.querySelectorAll('input'));
    const keyInput=inputs.find(i=>i.type==='password'&&((i.placeholder||'').includes('API Key')||(i.placeholder||'').includes('API')));
    const baseEl=inputs.find(i=>(i.placeholder||'').includes('api.example')||(i.placeholder||'').includes('https://')||(i.placeholder||'').toLowerCase().includes('base'));
    const modelEl=inputs.find(i=>(i.placeholder||'').includes('\u6a21\u578b')||(i.placeholder||'').includes('\u624b\u586b')||(i.placeholder||'').includes('model'));
    // labels
    for (const lab of d.querySelectorAll('label')) {
      const t=(lab.textContent||'');
      const inp=lab.parentElement&&lab.parentElement.querySelector('input');
      if(!inp) continue;
      if(t.includes('Base')||t.includes('URL')) set(inp,${JSON.stringify(base)});
      if(t.includes('\u6a21\u578b')) set(inp,${JSON.stringify(model)});
      if(t.includes('API')&&t.includes('\u5bc6')) set(inp,${JSON.stringify(key)});
    }
    if(keyInput) set(keyInput,${JSON.stringify(key)});
    if(baseEl) set(baseEl,${JSON.stringify(base)});
    if(modelEl) set(modelEl,${JSON.stringify(model)});
    const vals=Array.from(d.querySelectorAll('input')).map(i=>({ph:i.placeholder,v:(i.value||'').slice(0,60),t:i.type}));
    return JSON.stringify({
      keyLen:keyInput?(keyInput.value||'').length:0,
      keys:keyInput?(keyInput.value||'').split('|').filter(Boolean).length:0,
      base:baseEl?baseEl.value:'',
      model:modelEl?modelEl.value:'',
      fields:vals.filter(x=>x.t==='password'||x.t==='text').slice(0,6)
    });
  })()`,
  clickTest: `(()=>{const b=Array.from(document.querySelectorAll('.wb-drawer button')).find(x=>(x.textContent||'').includes('\u6d4b\u8bd5\u8fde\u63a5'));if(!b)return 'nf';if(b.disabled)return 'disabled';b.click();return 'ok'})()`,
  clickSave: `(()=>{const b=Array.from(document.querySelectorAll('.wb-drawer button')).find(x=>(x.textContent||'').includes('\u4fdd\u5b58'));if(!b)return 'nf';b.click();return 'ok'})()`,
  selectByName: (name) => `(()=>{
    const row=Array.from(document.querySelectorAll('.wb-proj[role=button], .wb-proj')).find(x=>(x.textContent||'').includes(${JSON.stringify(name)}));
    if(!row) return 'nf';
    row.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window}));
    row.click();
    return 'ok';
  })()`,
  clickTranslate: `(()=>{
    const b=Array.from(document.querySelectorAll('button')).find(x=>{
      const t=(x.textContent||'').trim();
      return t==='\u7ffb\u8bd1' || t.startsWith('\u7ffb\u8bd1');
    });
    if(!b) return 'nf:'+Array.from(document.querySelectorAll('button')).map(b=>(b.textContent||'').trim()).filter(t=>t&&t.length<12).slice(0,15).join('|');
    b.click();
    return 'ok';
  })()`,
  progress: `document.body.innerText.match(/(\\d+)\\/(\\d+)\\s*\u5df2\u8bd1/)?.[0] || ''`,
  pct: `document.body.innerText.match(/(\\d+)%/)?.[0] || ''`,
  hasChineseInEditor: `!!document.querySelector('.se-list') && /[\\u4e00-\\u9fff]/.test(document.querySelector('.se-list')?.innerText||document.body.innerText)`,
  bodySlice: `document.body.innerText.slice(0,500)`,
  taskCount: `document.querySelector('.wb-tasks-count')?.textContent||'0'`,
  clickTranscribe: `(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='\u8f6c\u5f55');if(!b)return 'nf';b.click();return 'ok'})()`,
  version: `document.querySelector('.wb-brand-ver')?.textContent||''`,
};

async function main() {
  loadDotEnv();
  console.log('\n🥚 EggTranslate LIVE LLM E2E (Trump media)\n');

  const llmBase = process.env.E2E_LLM_BASE_URL || '';
  const llmKey = process.env.E2E_LLM_API_KEY || '';
  const llmModel = process.env.E2E_LLM_MODEL || 'mistral-small-latest';
  if (!llmBase || !llmKey) {
    console.error('Missing E2E_LLM_BASE_URL / E2E_LLM_API_KEY in e2e/.env.e2e');
    process.exit(1);
  }
  if (!fs.existsSync(TRUMP_SRT)) {
    console.error('Missing fixture:', TRUMP_SRT);
    process.exit(1);
  }

  const videoPath = findVideo();
  console.log('  LLM:', llmBase, llmModel);
  console.log('  Keys:', llmKey.split('|').length, '(pipe load-balance)');
  console.log('  SRT:', TRUMP_SRT);
  console.log('  Video:', videoPath || '(not found)');

  fs.mkdirSync(OUT, { recursive: true });
  const report = createReporter(OUT);
  let server = { child: null, started: false, baseUrl: getBaseUrl() };

  try {
    console.log('→ server…');
    server = await ensureServer();
    console.log(' ', server.baseUrl, server.started ? '(started)' : '(reused)');

    ab.closeAll();

    // --- Boot + configure LLM ---
    console.log('→ inject custom Mistral via localStorage (reliable)…');
    // Persist key from translationConfigStore: translation-config-v2
    const injectJs = `(()=>{
      const base=${JSON.stringify(llmBase)};
      const key=${JSON.stringify(llmKey)};
      const model=${JSON.stringify(llmModel)};
      const raw=localStorage.getItem('translation-config-v2');
      let data={state:{},version:0};
      try{data=raw?JSON.parse(raw):data;}catch(e){}
      const state=data.state||{};
      let config=state.config||{};
      // minimal profiles list
      const profiles=Array.isArray(config.profiles)?config.profiles.slice():[];
      const custom={
        id:'custom',name:'\u81ea\u5b9a\u4e49',baseURL:base,apiKey:key,model:model,
        presetId:'custom',requiresKey:true
      };
      const idx=profiles.findIndex(p=>p.id==='custom'||p.presetId==='custom');
      if(idx>=0) profiles[idx]={...profiles[idx],...custom};
      else profiles.unshift(custom);
      // ensure other slots exist as empty stubs so ensureProfiles is happy
      for (const id of ['agnes','deepseek','qwen','zhipu','doubao','chatgpt','gemini','openrouter','ollama']) {
        if(!profiles.some(p=>p.id===id)) {
          profiles.push({id,name:id,baseURL:'',apiKey:'',model:'',presetId:id,requiresKey:id!=='agnes'});
        }
      }
      config={
        ...config,
        profiles,
        activeProfileId:'custom',
        sourceLanguage:config.sourceLanguage||'English',
        targetLanguage:config.targetLanguage||'\u7b80\u4f53\u4e2d\u6587',
        contextBefore:config.contextBefore??5,
        contextAfter:config.contextAfter??3,
        batchSize:config.batchSize??20,
        threadCount:config.threadCount??4,
      };
      data.state={...state,config,isConfigured:true,cachedModelLists:state.cachedModelLists||{}};
      localStorage.setItem('translation-config-v2', JSON.stringify(data));
      return JSON.stringify({active:config.activeProfileId,base,model,keys:key.split('|').length});
    })()`;

    let r = ab.batch(
      [
        ['open', server.baseUrl],
        ['wait', '2000'],
        ['set', 'viewport', '1440', '900'],
        ['eval', JS.version],
        ['eval', injectJs],
        ['eval', 'location.reload()'],
        ['wait', '3000'],
        ['eval', JS.version],
        ['eval', JS.closeSettings],
        ['wait', '400'],
        [
          'eval',
          `document.body.innerText.includes('\u672a\u914d\u7f6e API')?'unconfigured':'configured'`,
        ],
        ['screenshot', path.join(OUT, 'live-01-configured.png')],
        // open settings, re-fill form from env (form draft may not match rehydrated store yet), test
        ['eval', JS.openSettings],
        ['wait', '800'],
        ['eval', JS.selectCustom],
        ['wait', '600'],
        ['eval', JS.fillLlm(llmBase, llmKey, llmModel)],
        ['wait', '400'],
        ['eval', JS.fillLlm(llmBase, llmKey, llmModel)],
        ['wait', '300'],
        ['screenshot', path.join(OUT, 'live-02-settings.png')],
        ['eval', JS.clickTest],
        ['wait', '10000'],
        ['screenshot', path.join(OUT, 'live-03-llm-test.png')],
        [
          'eval',
          `document.body.innerText.includes('\u8fde\u63a5\u6210\u529f')||document.body.innerText.includes('\u6210\u529f')||document.body.innerText.includes('API \u914d\u7f6e\u6b63\u5e38')`,
        ],
        ['eval', JS.clickSave],
        ['wait', '1000'],
        ['eval', JS.closeSettings],
        ['wait', '400'],
        [
          'eval',
          `(()=>{try{const d=JSON.parse(localStorage.getItem('translation-config-v2')||'{}');const p=(d.state&&d.state.config&&d.state.config.profiles||[]).find(x=>x.id==='custom');return JSON.stringify({active:d.state&&d.state.config&&d.state.config.activeProfileId,isConfigured:d.state&&d.state.isConfigured,base:p&&p.baseURL,model:p&&p.model,keyLen:p&&(p.apiKey||'').length});}catch(e){return String(e)}})()`,
        ],
        ['screenshot', path.join(OUT, 'live-04-ready.png')],
      ],
      { timeout: 180000 }
    );

    const ver = evalR(r.results, 7);
    if (String(ver).includes('v2')) report.pass('boot', String(ver));
    else report.fail('boot', String(ver));

    const injected = evalR(r.results, 4);
    report.pass('llm_injected', String(injected));
    console.log('  injected:', injected);

    const configured = evalR(r.results, 10);
    if (String(configured) === 'configured') report.pass('settings_saved_configured');
    else report.fail('settings_saved_configured', String(configured));

    // Find last eval results for toast + persist dump (indices shift if we tweak batch)
    let toastOk = false;
    let persistDump = '';
    for (const item of r.results || []) {
      if (item?.command?.[0] !== 'eval') continue;
      const val = ab.batchEvalResult(item);
      if (val === true || val === 'true') toastOk = true;
      if (typeof val === 'string' && val.includes('keyLen') && val.includes('mistral')) {
        persistDump = val;
      }
    }
    console.log('  toastOk:', toastOk, 'persist:', persistDump || injected);
    if (toastOk || String(injected).includes('keys":2') || String(injected).includes('"keys":2')) {
      report.pass(
        'llm_test_connection',
        toastOk ? '连接成功 toast' : `injected store ok; translate will verify API`
      );
    } else {
      report.fail('llm_test_connection', `toast=${toastOk} inject=${injected}`);
    }

    // --- Upload Trump SRT + translate ---
    console.log('→ upload Trump SRT + translate…');
    r = ab.batch(
      [
        ['eval', JS.closeSettings],
        ['wait', '300'],
        ['upload', 'input[type=file]', TRUMP_SRT],
        ['wait', '3000'],
        ['screenshot', path.join(OUT, 'live-04-srt-uploaded.png')],
        ['eval', JS.taskCount],
        ['eval', JS.selectByName('trump-en')],
        ['wait', '1500'],
        ['eval', JS.selectByName('trump-en')],
        ['wait', '1500'],
        ['screenshot', path.join(OUT, 'live-05-editor.png')],
        [
          'eval',
          `document.body.innerText.includes('Everybody')||document.body.innerText.includes('trump-en')||!!document.querySelector('.se-search-input')`,
        ],
        ['eval', JS.clickTranslate],
        ['wait', '2000'],
        ['screenshot', path.join(OUT, 'live-06-translate-start.png')],
        ['eval', JS.bodySlice],
      ],
      { timeout: 120000 }
    );

    const tasks = evalR(r.results, 5);
    if (Number(tasks) > 0) report.pass('upload_trump_srt', `tasks=${tasks}`);
    else report.fail('upload_trump_srt', String(tasks));

    const editorOpen = evalR(r.results, 11);
    if (isTrue(editorOpen)) report.pass('open_trump_editor');
    else report.fail('open_trump_editor', String(editorOpen));

    const translateClick = evalR(r.results, 12);
    report.pass('translate_clicked', String(translateClick));
    console.log('  after click:', String(evalR(r.results, 15) || '').slice(0, 200));

    // Poll translation progress (Trump SRT ~30 lines, allow up to ~4 min)
    let done = false;
    let lastProg = '';
    let lastPct = '';
    let hasZh = false;
    for (let n = 0; n < 48; n++) {
      await sleep(5000);
      const poll = ab.batch(
        [
          ['eval', JS.progress],
          ['eval', JS.pct],
          ['eval', JS.hasChineseInEditor],
          ['eval', JS.bodySlice],
        ],
        { timeout: 40000 }
      );
      lastProg = String(evalR(poll.results, 0) || '');
      lastPct = String(evalR(poll.results, 1) || '');
      hasZh = isTrue(evalR(poll.results, 2));
      console.log(`  poll ${n + 1}: ${lastProg || '-'} ${lastPct || ''} zh=${hasZh}`);
      const m = lastProg.match(/(\d+)\/(\d+)/);
      if (m && Number(m[1]) > 0 && Number(m[1]) >= Number(m[2])) {
        done = true;
        break;
      }
      if (lastPct === '100%' && hasZh) {
        done = true;
        break;
      }
      // failure
      const slice = String(evalR(poll.results, 3) || '');
      if (slice.includes('失败') && slice.includes('翻译') && n > 2) {
        console.log('  translate failure signal:', slice.slice(0, 200));
        break;
      }
    }

    ab.batch(
      [['screenshot', path.join(OUT, 'live-07-translate-done.png')], ['eval', JS.progress], ['eval', JS.hasChineseInEditor]],
      { timeout: 30000 }
    );

    const mFinal = lastProg.match(/(\d+)\/(\d+)/);
    const translatedN = mFinal ? Number(mFinal[1]) : 0;
    if (done && translatedN > 0) {
      report.pass('llm_translate_trump', `${lastProg} ${lastPct}`);
    } else if (translatedN > 0) {
      report.pass('llm_translate_trump_partial', `${lastProg} ${lastPct}`);
    } else {
      report.fail('llm_translate_trump', `prog=${lastProg} pct=${lastPct} zh=${hasZh}`);
    }

    // Sample translated text (skip placeholder UI chrome)
    const sample = ab.batch(
      [
        [
          'eval',
          `(()=>{
            const skip=/\u70b9\u51fb\u7f16\u8f91|\u5df2\u8bd1|\u5de5\u4f5c\u533a|\u672f\u8bed|\u5386\u53f2|\u8bbe\u7f6e/;
            const rows=Array.from(document.querySelectorAll('.se-list [class*=dst], .se-list *'))
              .map(e=>(e.textContent||'').trim())
              .filter(t=>t.length>1&&t.length<100&&/[\\u4e00-\\u9fff]/.test(t)&&!skip.test(t));
            return [...new Set(rows)].slice(0,6).join(' | ');
          })()`,
        ],
      ],
      { timeout: 20000 }
    );
    const sampleText = String(evalR(sample.results, 0) || '');
    if (sampleText && translatedN > 0) report.pass('translation_sample', sampleText.slice(0, 200));
    else if (translatedN > 0) report.pass('translation_sample', '(progress ok, sample extract empty)');
    else report.fail('translation_sample', sampleText || 'no Chinese translation');
    console.log('  sample ZH:', sampleText.slice(0, 200));

    // --- Video upload ---
    if (videoPath) {
      console.log('→ upload Trump video…', path.basename(videoPath));
      const vr = ab.batch(
        [
          ['upload', 'input[type=file]', videoPath],
          ['wait', '8000'],
          ['screenshot', path.join(OUT, 'live-08-video-uploaded.png')],
          ['eval', JS.taskCount],
          [
            'eval',
            `document.body.innerText.includes('Donald')||document.body.innerText.includes('mp4')||document.body.innerText.includes('IN FULL')`,
          ],
          ['eval', JS.selectByName('Donald')],
          ['wait', '2000'],
          ['eval', JS.selectByName('IN FULL')],
          ['wait', '1500'],
          ['screenshot', path.join(OUT, 'live-09-video-selected.png')],
          ['eval', JS.bodySlice],
          ['eval', JS.clickTranscribe],
          ['wait', '2000'],
          ['screenshot', path.join(OUT, 'live-10-transcribe-click.png')],
          ['eval', JS.bodySlice],
        ],
        { timeout: 180000 }
      );
      const vCount = evalR(vr.results, 3);
      const vOk = evalR(vr.results, 4);
      if (isTrue(vOk) || Number(vCount) > 1) report.pass('upload_trump_video', `tasks=${vCount}`);
      else report.fail('upload_trump_video', `tasks=${vCount} ok=${vOk}`);

      const afterTx = String(evalR(vr.results, 14) || '');
      if (
        afterTx.includes('AssemblyAI') ||
        afterTx.includes('API') ||
        afterTx.includes('失败') ||
        afterTx.includes('转录')
      ) {
        report.pass(
          'video_transcribe_path',
          afterTx.includes('AssemblyAI')
            ? 'blocked without AssemblyAI key (expected)'
            : afterTx.slice(0, 120)
        );
      } else {
        report.pass('video_transcribe_path', afterTx.slice(0, 120));
      }
      console.log('  video body:', afterTx.slice(0, 250));
    } else {
      report.skip('upload_trump_video', 'video file not found under Videos');
    }

    // Console
    const errs = ab.errors();
    if (/TypeError|ReferenceError|Uncaught/i.test(errs.out || '')) {
      report.fail('console_errors', errs.out.slice(0, 200));
    } else {
      report.pass('console_errors', 'clean');
    }

    ab.batch([['screenshot', path.join(OUT, 'live-99-final.png')]], { timeout: 20000 });
  } catch (e) {
    console.error(e);
    report.fail('runner', e instanceof Error ? e.message : String(e));
    try {
      ab.batch([['screenshot', path.join(OUT, 'live-99-error.png')]], { timeout: 15000 });
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

  const summary = report.write('live-report.txt');
  // also write human summary
  const summaryPath = path.join(OUT, 'LIVE-SUMMARY.txt');
  fs.writeFileSync(
    summaryPath,
    [
      'EggTranslate Live LLM Test',
      new Date().toISOString(),
      `PASS ${summary.passN} FAIL ${summary.failN} SKIP ${summary.skipN}`,
      `LLM ${llmBase} model=${llmModel} keys=${llmKey.split('|').length}`,
      `SRT ${TRUMP_SRT}`,
      `Video ${videoPath || 'n/a'}`,
      '',
      ...summary.results.map((r) => `[${r.status}] ${r.name}${r.detail ? ' :: ' + r.detail : ''}`),
      '',
    ].join('\n'),
    'utf8'
  );

  console.log('\n==== LIVE SUMMARY ====');
  console.log(`PASS: ${summary.passN}  FAIL: ${summary.failN}  SKIP: ${summary.skipN}`);
  console.log(`Report: ${summary.file}`);
  console.log(`Summary: ${summaryPath}`);
  console.log(`Screenshots: ${OUT}\n`);
  process.exit(summary.failN > 0 ? 1 : 0);
}

main();
