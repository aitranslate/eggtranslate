#!/usr/bin/env node
/** Translate e2e/fixtures/introduction.srt with configured Mistral (from e2e/.env.e2e) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ab from './lib/agent.mjs';
import { ensureServer, stopServer, getBaseUrl } from './lib/server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'output');
const SRT = path.join(__dirname, 'fixtures', 'introduction.srt');

function loadDotEnv() {
  for (const file of [path.join(__dirname, '.env.e2e'), path.join(ROOT, '.env.local')]) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      process.env[m[1]] = val;
    }
  }
}

function er(results, i) {
  return ab.batchEvalResult(results[i]);
}
function isTrue(v) {
  return v === true || v === 'true';
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  loadDotEnv();
  const base = process.env.E2E_LLM_BASE_URL;
  const key = process.env.E2E_LLM_API_KEY;
  const model = process.env.E2E_LLM_MODEL || 'mistral-small-latest';
  if (!base || !key) {
    console.error('Need e2e/.env.e2e with E2E_LLM_*');
    process.exit(1);
  }
  if (!fs.existsSync(SRT)) {
    console.error('Missing', SRT);
    process.exit(1);
  }

  fs.mkdirSync(OUT, { recursive: true });
  console.log('\nTranslate introduction.srt via Mistral\n');
  console.log(' ', SRT);
  console.log(' ', base, model, 'keys=', key.split('|').length);

  const server = await ensureServer();
  ab.closeAll();

  const inject = `(()=>{
    const base=${JSON.stringify(base)}, key=${JSON.stringify(key)}, model=${JSON.stringify(model)};
    let data={state:{},version:0};
    try{data=JSON.parse(localStorage.getItem('translation-config-v2')||'{}');}catch(e){}
    const state=data.state||{};
    let config=state.config||{};
    const profiles=Array.isArray(config.profiles)?config.profiles.slice():[];
    const custom={id:'custom',name:'自定义',baseURL:base,apiKey:key,model,presetId:'custom',requiresKey:true};
    const idx=profiles.findIndex(p=>p.id==='custom');
    if(idx>=0) profiles[idx]={...profiles[idx],...custom}; else profiles.unshift(custom);
    for (const id of ['agnes','deepseek','qwen','zhipu','doubao','chatgpt','gemini','openrouter','ollama']) {
      if(!profiles.some(p=>p.id===id)) profiles.push({id,name:id,baseURL:'',apiKey:'',model:'',presetId:id,requiresKey:true});
    }
    config={...config,profiles,activeProfileId:'custom',sourceLanguage:'English',targetLanguage:'简体中文',
      contextBefore:config.contextBefore??5,contextAfter:config.contextAfter??3,batchSize:config.batchSize??20,threadCount:config.threadCount??4};
    data.state={...state,config,isConfigured:true,cachedModelLists:state.cachedModelLists||{}};
    localStorage.setItem('translation-config-v2',JSON.stringify(data));
    return 'ok';
  })()`;

  ab.batch(
    [
      ['open', server.baseUrl],
      ['wait', '2000'],
      ['set', 'viewport', '1440', '900'],
      ['eval', inject],
      ['eval', 'location.reload()'],
      ['wait', '3000'],
      [
        'eval',
        `(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>(x.getAttribute('aria-label')||'')==='关闭设置');if(b)b.click();return 'c'})()`,
      ],
      ['wait', '400'],
      ['upload', 'input[type=file]', SRT],
      ['wait', '3000'],
      [
        'eval',
        `(()=>{const row=Array.from(document.querySelectorAll('.wb-proj')).find(x=>(x.textContent||'').includes('introduction'));if(!row)return 'nf';row.click();return 'ok'})()`,
      ],
      ['wait', '1500'],
      [
        'eval',
        `(()=>{const row=Array.from(document.querySelectorAll('.wb-proj')).find(x=>(x.textContent||'').includes('introduction'));if(row)row.click();return !!document.querySelector('.se-search-input')})()`,
      ],
      ['wait', '800'],
      [
        'eval',
        `(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='翻译');if(!b)return 'nf';b.click();return 'ok'})()`,
      ],
      ['wait', '2000'],
      ['screenshot', path.join(OUT, 'intro-01-start.png')],
      ['eval', `document.body.innerText.match(/(\\d+)\\/(\\d+)\\s*已译/)?.[0]||''`],
    ],
    { timeout: 120000 }
  );

  let last = '';
  let done = false;
  for (let i = 0; i < 90; i++) {
    await sleep(5000);
    const poll = ab.batch(
      [
        ['eval', `document.body.innerText.match(/(\\d+)\\/(\\d+)\\s*已译/)?.[0]||''`],
        ['eval', `document.body.innerText.match(/(\\d+)%/)?.[0]||''`],
        [
          'eval',
          `document.body.innerText.includes('失败')&&document.body.innerText.includes('翻译')?'fail':''`,
        ],
      ],
      { timeout: 30000 }
    );
    last = String(er(poll.results, 0) || '');
    const pct = String(er(poll.results, 1) || '');
    const fail = String(er(poll.results, 2) || '');
    console.log(`  poll ${i + 1}: ${last} ${pct} ${fail}`);
    const m = last.match(/(\d+)\/(\d+)/);
    if (m && Number(m[1]) > 0 && Number(m[1]) >= Number(m[2])) {
      done = true;
      break;
    }
    if (fail === 'fail' && i > 2) break;
  }

  ab.batch(
    [
      ['screenshot', path.join(OUT, 'intro-02-done.png')],
      [
        'eval',
        `(()=>{
          const skip=/点击编辑|已译|工作区|术语|历史|设置/;
          const rows=Array.from(document.querySelectorAll('.se-list *')).map(e=>(e.textContent||'').trim())
            .filter(t=>t.length>2&&t.length<120&&/[\\u4e00-\\u9fff]/.test(t)&&!skip.test(t));
          return [...new Set(rows)].slice(0,8).join('\\n');
        })()`,
      ],
      ['eval', `document.body.innerText.match(/(\\d+)\\/(\\d+)\\s*已译/)?.[0]||''`],
    ],
    { timeout: 30000 }
  );

  // Try export 译文 via UI if possible — also dump entries from page if exposed
  const sample = ab.batch(
    [
      [
        'eval',
        `(()=>{
          // Prefer zustand store dump if available via localforage/idb is hard; scrape visible
          const out=[];
          const list=document.querySelector('.se-list');
          if(!list) return '';
          return list.innerText.slice(0,1500);
        })()`,
      ],
    ],
    { timeout: 20000 }
  );

  const finalProg = last;
  const sampleText = String(er(sample.results, 0) || '');
  fs.writeFileSync(
    path.join(OUT, 'intro-result.txt'),
    [`done=${done}`, `progress=${finalProg}`, '', sampleText].join('\n'),
    'utf8'
  );

  console.log('\n==== RESULT ====');
  console.log(done ? 'PASS translate complete' : 'FAIL incomplete', finalProg);
  console.log(sampleText.slice(0, 600));
  console.log('Screenshots: e2e/output/intro-*.png');

  ab.closeAll();
  if (server.started) stopServer(server.child);
  process.exit(done ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
