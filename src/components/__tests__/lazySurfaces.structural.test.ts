/**
 * Structural proof: workbench shells must not statically import full
 * Settings / History / Terms module graphs on the cold path.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('lazy surface wiring', () => {
  it('lazySurfaces uses React.lazy + dynamic import for Settings/History/Terms', () => {
    const src = readSrc('components/lazySurfaces.tsx');
    expect(src).toMatch(/React\.lazy\s*\(/);
    expect(src).toMatch(/import\(['"]\.\/SettingsModal['"]\)/);
    expect(src).toMatch(/import\(['"]\.\/TermsManager['"]\)/);
    expect(src).toMatch(/import\(['"]\.\/HistoryModal['"]\)/);
  });

  it('MainApp does not statically import modal implementations', () => {
    const src = readSrc('components/MainApp.tsx');
    expect(src).toMatch(/from ['"]\.\/lazySurfaces['"]/);
    expect(src).not.toMatch(/from ['"]\.\/SettingsModal['"]/);
    expect(src).not.toMatch(/from ['"]\.\/TermsManager['"]/);
    expect(src).not.toMatch(/from ['"]\.\/HistoryModal['"]/);
    expect(src).toMatch(/LazySettingsModal|LazyTermsManager|LazyHistoryModal/);
  });

  it('MainApp lazy-loads MobileShell (desktop cold path skips mobile graph)', () => {
    const src = readSrc('components/MainApp.tsx');
    expect(src).toMatch(/LazyMobileShell/);
    expect(src).toMatch(/prefetchMobileShell/);
    expect(src).not.toMatch(/from ['"]@\/components\/mobile\/MobileShell['"]/);
    expect(src).not.toMatch(/from ['"]\.\/mobile\/MobileShell['"]/);
  });

  it('lazySurfaces exposes LazyMobileShell + LazyAgentProcessControl', () => {
    const src = readSrc('components/lazySurfaces.tsx');
    expect(src).toMatch(/LazyMobileShell\s*=\s*React\.lazy/);
    expect(src).toMatch(/import\(['"]\.\/mobile\/MobileShell['"]\)/);
    expect(src).toMatch(/LazyAgentProcessControl\s*=\s*React\.lazy/);
    expect(src).toMatch(/import\(['"]\.\/agent\/AgentProcessControl['"]\)/);
  });

  it('lazyPrefetch triggers the same dynamic graphs without mounting UI', () => {
    const src = readSrc('components/lazyPrefetch.ts');
    expect(src).toMatch(/export function prefetchMobileShell/);
    expect(src).toMatch(/import\(['"]\.\/mobile\/MobileShell['"]\)/);
    expect(src).toMatch(/export function prefetchAgentProcessControl/);
    expect(src).toMatch(/import\(['"]\.\/agent\/AgentProcessControl['"]\)/);
  });

  it('SubtitleEditor lazy-loads AgentProcessControl (separator inside Suspense)', () => {
    const src = readSrc('components/SubtitleEditor.tsx');
    expect(src).toMatch(/LazyAgentProcessControl/);
    expect(src).toMatch(/prefetchAgentProcessControl/);
    expect(src).toMatch(/from ['"]@\/components\/lazyPrefetch['"]/);
    expect(src).not.toMatch(
      /from ['"]@\/components\/agent\/AgentProcessControl['"]/
    );
    // 分隔符必须在 LazySurface 内，避免孤立「·」
    expect(src).toMatch(
      /LazySurface\s+fallback=\{null\}[\s\S]*?hidden sm:inline[\s\S]*?LazyAgentProcessControl/
    );
  });

  it('heavy libs stay dynamic-only; vite keeps them out of static vendor', () => {
    const asm = readSrc('services/assemblyaiService.ts');
    expect(asm).toMatch(/await\s+import\(['"]assemblyai['"]\)/);
    // 允许 import type，禁止值导入
    expect(asm).not.toMatch(
      /import\s+(?!type\b)[^'"\n]*from\s+['"]assemblyai['"]/
    );

    const exp = readSrc('services/SubtitleExporter.ts');
    expect(exp).toMatch(/import\(['"]jszip['"]\)/);
    expect(exp).not.toMatch(
      /import\s+(?!type\b)[^'"\n]*from\s+['"]jszip['"]/
    );

    const hard = readSrc('services/sentenceSegmentation/hardSplit.ts');
    // sentence-splitter 仅由动态 import 的 sentenceSegmentation 图持有
    expect(hard).toMatch(/from\s+['"]sentence-splitter['"]/);
    const aaiCaller = readSrc('services/assemblyaiService.ts');
    expect(aaiCaller).toMatch(
      /import\(['"]@\/services\/sentenceSegmentation['"]\)/
    );

    // project root is parent of src/
    const vite = readFileSync(resolve(root, '../vite.config.ts'), 'utf8');
    expect(vite).toMatch(/assemblyai/);
    expect(vite).toMatch(/sentence-splitter/);
    expect(vite).toMatch(/return undefined/);
  });

  it('MobileShell does not statically import modal implementations', () => {
    const src = readSrc('components/mobile/MobileShell.tsx');
    expect(src).toMatch(/from ['"]@\/components\/lazySurfaces['"]/);
    expect(src).not.toMatch(/from ['"]@\/components\/SettingsModal['"]/);
    expect(src).not.toMatch(/from ['"]@\/components\/TermsManager['"]/);
    expect(src).not.toMatch(/from ['"]@\/components\/HistoryModal['"]/);
  });

  it('LazySurface preserves explicit null fallback (no ?? that revives SurfaceFallback)', () => {
    const src = readSrc('components/lazySurfaces.tsx');
    // 默认参数写法：fallback = <SurfaceFallback />，再原样交给 Suspense
    expect(src).toMatch(/fallback\s*=\s*<SurfaceFallback/);
    expect(src).toMatch(/<Suspense\s+fallback=\{fallback\}/);
    // 禁止 fallback ?? …：null 会被 ?? 吃掉，设置首次打开会在状态栏下闪「加载中…」
    expect(src).not.toMatch(/fallback\s*\?\?/);
  });

  it('settings uses null fallback and mounts outside layout shells', () => {
    const main = readSrc('components/MainApp.tsx');
    const mobile = readSrc('components/mobile/MobileShell.tsx');
    expect(main).toMatch(/LazySurface\s+fallback=\{null\}/);
    expect(mobile).toMatch(/LazySurface\s+fallback=\{null\}/);
    // 源头：浮层与布局壳兄弟
    expect(main).toMatch(
      /<StatusBar\s*\/>\s*<\/div>\s*\{\/\*\s*浮层[\s\S]*?<LazySettingsModal/
    );
    expect(mobile).toMatch(
      /\{\/\*\s*浮层：在 m-shell 外[\s\S]*?<LazySettingsModal/
    );
  });

  it('translationService dynamically imports agent pipeline (not static)', () => {
    const src = readSrc('services/translationService.ts');
    expect(src).toMatch(/await\s+import\(['"]\.\/agent['"]\)/);
    expect(src).not.toMatch(
      /import\s*\{\s*runAgentTranslation\s*\}\s*from\s*['"]\.\/agent['"]/
    );
  });
});
