/**
 * 移动端冒烟（agent-browser + 窄视口）
 * 供 run.mjs 全流程与 run-mobile.mjs 独立入口共用。
 *
 * 注意：桌面批之后不要 closeAll 再接移动——Windows 上 CDP 偶发拒连。
 * 同一会话内 set viewport + open 即可。
 */
import path from 'node:path';
import * as ab from './agent.mjs';

export const MOBILE_VW = 390;
export const MOBILE_VH = 844;

function evalResult(results, index) {
  return ab.batchEvalResult(results[index]);
}

function isTrue(v) {
  return v === true || v === 'true';
}

const js = {
  clearCaches: `(()=>{try{navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister()));caches.keys().then(ks=>ks.forEach(k=>caches.delete(k)));return 'ok'}catch(e){return String(e)}})()`,
  /** 清 localStorage + IndexedDB（localforage），避免桌面批残留任务直接进详情 */
  clearAppState: `(()=>{
    try{localStorage.clear();sessionStorage.clear();}catch(e){}
    try{
      if(indexedDB.databases){
        indexedDB.databases().then(dbs=>dbs.forEach(d=>{if(d&&d.name)indexedDB.deleteDatabase(d.name)}));
      }else{
        ['localforage','keyval-store','zustand'].forEach(n=>{try{indexedDB.deleteDatabase(n)}catch(e){}});
      }
    }catch(e){}
    return 'ok';
  })()`,
  probe: `JSON.stringify({
    shell:!!document.querySelector('.m-shell'),
    tabbar:!!document.querySelector('.m-tabbar'),
    menu:!!document.querySelector('button[aria-label="菜单"]')||!!document.querySelector('button[aria-label="打开菜单"]'),
    w:window.innerWidth,
    title:document.querySelector('.m-top-title')?.textContent||'',
    tabs:Array.from(document.querySelectorAll('.m-tab')).map(t=>t.textContent.trim()),
    mm:matchMedia('(max-width: 767.98px)').matches,
    wb:!!document.querySelector('.workbench'),
    bodyLen:document.body?.innerText?.length||0,
    rootKids:document.getElementById('root')?.childElementCount||0
  })`,
  title: `document.querySelector('.m-top-title')?.textContent?.trim()||''`,
  activeTab: `document.querySelector('.m-tab.is-active')?.textContent?.trim()||''`,
  tabbar: `!!document.querySelector('.m-tabbar')`,
  inList: `!!document.querySelector('.m-list')`,
  inDetail: `!!document.querySelector('.m-detail')`,
  settingsOpen: `!!document.querySelector('.wb-drawer')`,
  settingsZ: `(()=>{const d=document.querySelector('.wb-drawer');if(!d)return 0;return Number(getComputedStyle(d).zIndex)||0})()`,
  bodyOverflow: `document.body.style.overflow||''`,
  panelNoDesktopHeader: `(()=>{const h=document.querySelector('.m-shell .wb-panel-header');if(!h)return true;return getComputedStyle(h).display==='none'})()`,
  clickTab: (t) =>
    `(()=>{const s=${JSON.stringify(t)};const b=Array.from(document.querySelectorAll('.m-tab')).find(x=>(x.textContent||'').includes(s));if(!b)return 'nf';b.click();return 'ok'})()`,
  clickAria: (label) =>
    `(()=>{const b=document.querySelector('button[aria-label=${JSON.stringify(label)}]');if(!b)return 'nf';b.click();return 'ok'})()`,
  closeSettings: `(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>(x.getAttribute('aria-label')||'')==='关闭设置');if(b){b.click();return 'closed'}return 'none'})()`,
  clickSample: `(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>(x.textContent||'').includes('试用示例'));if(!b)return 'nf';b.click();return 'ok'})()`,
  clickBack: `(()=>{const b=document.querySelector('button[aria-label="返回"]');if(!b)return 'nf';b.click();return 'ok'})()`,
  themeBeforeToggle: `(()=>{const t=document.querySelector('.m-shell')?.getAttribute('data-theme')||'light';const b=document.querySelector('button[aria-label="切换主题"]');if(!b)return 'nf:'+t;b.click();return t})()`,
  themeNow: `document.querySelector('.m-shell')?.getAttribute('data-theme')||''`,
  themeToggleBack: `document.querySelector('button[aria-label="切换主题"]')?.click();'ok'`,
  settingsProbe: `JSON.stringify({
    hasTitle:!!document.querySelector('#wb-settings-title')||document.body.innerText.includes('设置'),
    mobileClass:!!document.querySelector('.wb-drawer.is-mobile-sheet'),
    fullH:(()=>{const d=document.querySelector('.wb-drawer');if(!d)return false;const r=d.getBoundingClientRect();return r.width>=Math.min(window.innerWidth,${MOBILE_VW})-2&&r.height>=window.innerHeight*0.85})()
  })`,
};

/**
 * @param {{
 *   baseUrl: string,
 *   report: { pass: Function, fail: Function, skip: Function },
 *   outDir: string,
 *   shotPrefix?: string,
 *   reopen?: boolean,
 * }} opts
 */
export function runMobileSmoke({
  baseUrl,
  report,
  outDir,
  shotPrefix = 'm',
  reopen = true,
}) {
  const shot = (name) => path.join(outDir, `${shotPrefix}-${name}.png`);

  console.log(`→ mobile smoke (${MOBILE_VW}x${MOBILE_VH})…`);

  // 1) 进入移动壳：同会话改 viewport + 冷加载（勿 closeAll）
  {
    const cmds = [];
    if (reopen) {
      cmds.push(
        ['set', 'viewport', String(MOBILE_VW), String(MOBILE_VH)],
        ['open', `${baseUrl}/?e2e-m=${Date.now()}`],
        ['wait', '1000'],
        ['eval', js.clearCaches],
        ['eval', js.clearAppState],
        ['wait', '400'],
        ['set', 'viewport', String(MOBILE_VW), String(MOBILE_VH)],
        ['open', `${baseUrl}/?e2e-m2=${Date.now()}`],
        ['wait', '2800']
      );
    } else {
      cmds.push(
        ['set', 'viewport', String(MOBILE_VW), String(MOBILE_VH)],
        ['wait', '800']
      );
    }
    cmds.push(['eval', js.probe], ['screenshot', shot('01-landing')]);

    const { results, out, ok } = ab.batch(cmds, { timeout: 150000 });
    if (!results.length) {
      report.fail('mobile_shell', `empty batch ok=${ok} ${String(out || '').slice(0, 180)}`);
      report.fail('mobile_tabbar', 'skipped after shell fail');
      report.fail('mobile_list_title', 'skipped after shell fail');
      // still try screenshot of whatever is left
      return;
    }
    const probeIdx = results.length - 2;
    let probe = {};
    try {
      probe = JSON.parse(String(evalResult(results, probeIdx) || '{}'));
    } catch {
      probe = {};
    }

    // 若仍桌面壳：再硬等一轮 matchMedia
    if (!isTrue(probe.shell) && isTrue(probe.mm) === false) {
      const retry = ab.batch(
        [
          ['set', 'viewport', String(MOBILE_VW), String(MOBILE_VH)],
          ['wait', '500'],
          ['open', `${baseUrl}/?e2e-m3=${Date.now()}`],
          ['wait', '2500'],
          ['eval', js.probe],
          ['screenshot', shot('01-landing-retry')],
        ],
        { timeout: 90000 }
      );
      try {
        probe = JSON.parse(String(evalResult(retry.results, 4) || '{}'));
      } catch {
        /* keep old */
      }
    }

    if (isTrue(probe.shell)) report.pass('mobile_shell', `w=${probe.w} mm=${probe.mm}`);
    else report.fail('mobile_shell', JSON.stringify(probe));

    if (isTrue(probe.tabbar)) report.pass('mobile_tabbar');
    else report.fail('mobile_tabbar', JSON.stringify(probe));

    if (!probe.menu) report.pass('mobile_no_hamburger');
    else report.fail('mobile_no_hamburger', 'hamburger still present');

    if ((probe.title || '').includes('项目')) report.pass('mobile_list_title', probe.title);
    else report.fail('mobile_list_title', String(probe.title || JSON.stringify(probe)));

    if (!isTrue(probe.shell)) {
      // 壳都没挂上，后续导航无意义
      return;
    }
  }

  // 2) 底栏：术语 / 历史 / 项目
  {
    const { results } = ab.batch(
      [
        ['eval', js.clickTab('术语')],
        ['wait', '500'],
        ['eval', js.title],
        ['eval', js.activeTab],
        ['eval', js.tabbar],
        ['eval', js.panelNoDesktopHeader],
        ['screenshot', shot('02-terms')],
        ['eval', js.clickTab('历史')],
        ['wait', '500'],
        ['eval', js.title],
        ['eval', js.activeTab],
        ['screenshot', shot('03-history')],
        ['eval', js.clickTab('项目')],
        ['wait', '400'],
        ['eval', js.inList],
        ['screenshot', shot('04-list')],
      ],
      { timeout: 90000 }
    );

    if (evalResult(results, 0) === 'ok' && String(evalResult(results, 2)).includes('术语')) {
      report.pass('mobile_nav_terms');
    } else {
      report.fail('mobile_nav_terms', `${evalResult(results, 0)}/${evalResult(results, 2)}`);
    }
    if (isTrue(evalResult(results, 4))) report.pass('mobile_tabbar_on_terms');
    else report.fail('mobile_tabbar_on_terms');
    if (isTrue(evalResult(results, 5))) report.pass('mobile_panel_header_hidden');
    else report.fail('mobile_panel_header_hidden');

    if (evalResult(results, 7) === 'ok' && String(evalResult(results, 9)).includes('历史')) {
      report.pass('mobile_nav_history');
    } else {
      report.fail('mobile_nav_history', `${evalResult(results, 7)}/${evalResult(results, 9)}`);
    }

    if (evalResult(results, 12) === 'ok' && isTrue(evalResult(results, 14))) {
      report.pass('mobile_nav_back_list');
    } else {
      report.fail('mobile_nav_back_list', String(evalResult(results, 14)));
    }
  }

  // 3) 设置全屏 sheet
  {
    const { results } = ab.batch(
      [
        ['eval', js.clickAria('设置')],
        ['wait', '700'],
        ['eval', js.settingsOpen],
        ['eval', js.settingsZ],
        ['eval', js.bodyOverflow],
        ['eval', js.settingsProbe],
        ['screenshot', shot('05-settings')],
        ['eval', js.closeSettings],
        ['wait', '500'],
        ['eval', js.settingsOpen],
        ['eval', js.bodyOverflow],
        ['screenshot', shot('06-settings-closed')],
      ],
      { timeout: 90000 }
    );

    if (evalResult(results, 0) === 'ok' && isTrue(evalResult(results, 2))) {
      report.pass('mobile_settings_open');
    } else {
      report.fail('mobile_settings_open', String(evalResult(results, 0)));
    }

    const z = Number(evalResult(results, 3) || 0);
    if (z >= 2000) report.pass('mobile_settings_zindex', String(z));
    else report.fail('mobile_settings_zindex', String(z));

    if (String(evalResult(results, 4)) === 'hidden') report.pass('mobile_settings_scroll_lock');
    else report.fail('mobile_settings_scroll_lock', String(evalResult(results, 4)));

    let sp = {};
    try {
      sp = JSON.parse(String(evalResult(results, 5) || '{}'));
    } catch {
      sp = {};
    }
    if (sp.hasTitle && sp.fullH && sp.mobileClass) {
      report.pass('mobile_settings_sheet', JSON.stringify(sp));
    } else {
      report.fail('mobile_settings_sheet', JSON.stringify(sp));
    }

    if (String(evalResult(results, 7)).startsWith('closed') && !isTrue(evalResult(results, 9))) {
      report.pass('mobile_settings_close');
    } else {
      report.fail(
        'mobile_settings_close',
        `${evalResult(results, 7)} open=${evalResult(results, 9)}`
      );
    }
    if (String(evalResult(results, 10)) !== 'hidden') report.pass('mobile_body_unlock');
    else report.fail('mobile_body_unlock', String(evalResult(results, 10)));
  }

  // 4) 主题
  {
    const { results } = ab.batch(
      [
        ['eval', js.themeBeforeToggle],
        ['wait', '350'],
        ['eval', js.themeNow],
        ['screenshot', shot('07-theme')],
        ['eval', js.themeToggleBack],
        ['wait', '250'],
      ],
      { timeout: 45000 }
    );
    const before = String(evalResult(results, 0) || '');
    const after = String(evalResult(results, 2) || '');
    if (!before.startsWith('nf') && before !== after && (after === 'dark' || after === 'light')) {
      report.pass('mobile_theme_toggle', `${before} -> ${after}`);
    } else {
      report.fail('mobile_theme_toggle', `${before} -> ${after}`);
    }
  }

  // 5) 示例 → 详情 → 返回
  {
    const { results } = ab.batch(
      [
        ['eval', js.clickSample],
        ['wait', '2500'],
        ['eval', js.inDetail],
        ['eval', js.tabbar],
        ['eval', js.clickBack],
        ['wait', '600'],
        ['eval', js.inList],
        ['eval', js.tabbar],
        ['screenshot', shot('08-sample-back')],
      ],
      { timeout: 90000 }
    );

    if (evalResult(results, 0) === 'ok' && isTrue(evalResult(results, 2))) {
      report.pass('mobile_sample_detail');
    } else {
      report.fail(
        'mobile_sample_detail',
        `click=${evalResult(results, 0)} detail=${evalResult(results, 2)}`
      );
    }
    if (!isTrue(evalResult(results, 3))) report.pass('mobile_tabbar_hidden_in_detail');
    else report.fail('mobile_tabbar_hidden_in_detail');

    if (
      evalResult(results, 4) === 'ok' &&
      isTrue(evalResult(results, 6)) &&
      isTrue(evalResult(results, 7))
    ) {
      report.pass('mobile_back_to_list');
    } else {
      report.fail(
        'mobile_back_to_list',
        `back=${evalResult(results, 4)} list=${evalResult(results, 6)} tab=${evalResult(results, 7)}`
      );
    }
  }

  ab.batch([['screenshot', shot('99-final')]], { timeout: 20000 });
}
