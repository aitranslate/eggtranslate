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
});
