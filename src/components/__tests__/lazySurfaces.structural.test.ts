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
});
