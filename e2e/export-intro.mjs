import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ab from './lib/agent.mjs';
import { ensureServer } from './lib/server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'output');
const DEST = path.join(
  process.env.USERPROFILE || 'C:\\Users\\ADMIN',
  'Videos',
  '1. Introduction.mp4_translated_zh.srt'
);

const server = await ensureServer();
ab.closeAll();

// Scroll through virtual list and collect entries is hard; use store via page eval of zustand persist files
// files may be in localforage - try window and also download via export button
const r = ab.batch(
  [
    ['open', server.baseUrl],
    ['wait', '2500'],
    [
      'eval',
      `(()=>{const row=Array.from(document.querySelectorAll('.wb-proj')).find(x=>(x.textContent||'').includes('introduction'));if(!row)return 'nf';row.click();return 'ok'})()`,
    ],
    ['wait', '1500'],
    ['eval', `document.body.innerText.match(/(\\d+)\\/(\\d+)\\s*已译/)?.[0]||''`],
    // Click export on selected row - open menu 译文
    [
      'eval',
      `(()=>{
        const row=Array.from(document.querySelectorAll('.wb-proj')).find(x=>(x.textContent||'').includes('introduction')&&(x.textContent||'').includes('完成'));
        if(!row) return 'no-row';
        row.click();
        const exp=row.querySelector('button[aria-label], button');
        // find download icon button in trail
        const btns=Array.from(row.querySelectorAll('button'));
        // hover to show actions
        row.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true}));
        return 'btns='+btns.length;
      })()`,
    ],
    ['wait', '500'],
    // Use page store: files are in memory; try to access via React fiber is fragile.
    // Scroll full list and scrape with virtualizer - expand by setting filter all and reading progress text only
    [
      'eval',
      `(()=>{
        // Dump from zustand if attached - some builds expose __ZUSTAND__
        // Fall back: read IndexedDB localforage keys asynchronously via promise - batch eval may not await
        return 'need-async';
      })()`,
    ],
  ],
  { timeout: 60000 }
);

console.log(r.results?.map((x) => x.result?.result ?? x.error));

// Async IDB read
const dump = ab.batch(
  [
    [
      'eval',
      `(() => new Promise((resolve) => {
        const req = indexedDB.open('localforage');
        req.onerror = () => resolve('idb-error');
        req.onsuccess = () => {
          const db = req.result;
          const names = [...db.objectStoreNames];
          resolve(JSON.stringify(names));
        };
      }).then(r => r))()`,
    ],
  ],
  { timeout: 30000 }
);
console.log('idb', dump.results?.[0]);

// Simpler: export via UI click 导出 -> 译文 and set download path
const dlDir = path.join(OUT, 'downloads');
fs.mkdirSync(dlDir, { recursive: true });

ab.batch(
  [
    [
      'eval',
      `(()=>{
        const row=document.querySelector('.wb-proj.is-selected')||Array.from(document.querySelectorAll('.wb-proj')).find(x=>(x.textContent||'').includes('introduction'));
        if(row) row.click();
        return !!row;
      })()`,
    ],
    ['wait', '800'],
    // Click any export button with text 导出 in project area
    [
      'eval',
      `(()=>{
        const buttons=Array.from(document.querySelectorAll('button'));
        const exp=buttons.find(b=>(b.textContent||'').trim()==='导出'||b.getAttribute('aria-label')==='导出');
        if(exp){exp.click();return 'export-clicked'}
        // icon-only export
        const row=document.querySelector('.wb-proj.is-selected')||document.querySelector('.wb-proj');
        const icon=row&&row.querySelector('.wb-proj-hover-acts button, button');
        if(icon){icon.click();return 'icon'}
        return 'no-export';
      })()`,
    ],
    ['wait', '600'],
    ['screenshot', path.join(OUT, 'intro-03-export.png')],
    [
      'eval',
      `(()=>{
        const items=Array.from(document.querySelectorAll('button,[role=menuitem]')).map(b=>(b.textContent||'').trim()).filter(Boolean);
        return items.slice(0,20).join('|');
      })()`,
    ],
    [
      'eval',
      `(()=>{
        const b=Array.from(document.querySelectorAll('button,[role=menuitem]')).find(x=>(x.textContent||'').includes('译文'));
        if(!b)return 'no-zh';
        b.click();
        return 'zh-clicked';
      })()`,
    ],
    ['wait', '2000'],
    ['screenshot', path.join(OUT, 'intro-04-after-export.png')],
  ],
  { timeout: 60000 }
);

// Also try to build SRT from visible virtual rows by scrolling
const built = ab.batch(
  [
    [
      'eval',
      `(() => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        return (async () => {
          const scroller = document.querySelector('.se-list');
          if (!scroller) return 'no-scroller';
          const map = new Map();
          for (let y = 0; y < scroller.scrollHeight + 200; y += 200) {
            scroller.scrollTop = y;
            await sleep(50);
            // each row roughly: index, times, src, dst
            const text = scroller.innerText;
            // parse blocks loosely
            const lines = text.split(/\\n/).map(l => l.trim()).filter(Boolean);
            // store snapshot chunks
            map.set(y, lines.join('\\n'));
          }
          return [...map.values()].join('\\n---\\n').slice(0, 50000);
        })();
      })()`,
    ],
  ],
  { timeout: 120000 }
);

const scraped = String(ab.batchEvalResult(built.results?.[0]) || '');
fs.writeFileSync(path.join(OUT, 'intro-scraped.txt'), scraped, 'utf8');
console.log('scraped bytes', scraped.length);
console.log('export screenshots in e2e/output/intro-03*.png');
ab.closeAll();
