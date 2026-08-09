import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../..');

function read(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

describe('palette single source', () => {
  it('index.css loads palette before apple and workbench', () => {
    const css = read('index.css');
    const palette = css.indexOf("theme/palette.css");
    const apple = css.indexOf('apple-style.css');
    const wb = css.indexOf('workbench.css');
    expect(palette).toBeGreaterThanOrEqual(0);
    expect(apple).toBeGreaterThan(palette);
    expect(wb).toBeGreaterThan(apple);
  });

  it('palette defines neutrals brand semantic and aliases', () => {
    const p = read('theme/palette.css');
    expect(p).toMatch(/--palette-bg:\s*#f0f1f4/);
    expect(p).toMatch(/--palette-brand:\s*#0071e3/);
    expect(p).toMatch(/--wb-bg:\s*var\(--palette-bg\)/);
    expect(p).toMatch(/--apple-blue:\s*var\(--palette-brand\)/);
    expect(p).toMatch(/html\.dark\s*\{/);
  });

  it('workbench does not re-own color hex scales', () => {
    const wb = read('workbench.css');
    // layout tokens only — no independent light shell hex
    expect(wb).not.toMatch(/--wb-bg:\s*#f2f3f5/);
    expect(wb).not.toMatch(/--wb-panel:\s*#ffffff/);
  });

  it('export menu does not use Tailwind default blue/gray', () => {
    const src = read('components/common/ExportMenu.tsx');
    expect(src).not.toMatch(/bg-blue-50|text-blue-600|border-gray-200|text-gray-700/);
    expect(src).toMatch(/--wb-brand/);
  });
});
