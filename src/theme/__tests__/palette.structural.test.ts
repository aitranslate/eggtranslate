import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../..');

function read(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

describe('palette single source', () => {
  it('main.tsx loads palette before index.css (not via Tailwind @import)', () => {
    const main = read('main.tsx');
    const palette = main.indexOf("import './theme/palette.css'");
    const index = main.indexOf("import './index.css'");
    expect(palette).toBeGreaterThanOrEqual(0);
    expect(index).toBeGreaterThan(palette);
    const idxCss = read('index.css');
    expect(idxCss).not.toMatch(/@import\s+['"].*palette/);
  });

  it('palette defines neutrals brand and direct wb/apple aliases', () => {
    const p = read('theme/palette.css');
    expect(p).toMatch(/--palette-bg:\s*#f0f1f4/);
    expect(p).toMatch(/--palette-brand:\s*#0071e3/);
    expect(p).toMatch(/--wb-bg:\s*#f0f1f4/);
    expect(p).toMatch(/--wb-panel:\s*#ffffff/);
    expect(p).toMatch(/--apple-blue:\s*#0071e3/);
    expect(p).toMatch(/html\.dark\s*\{/);
    expect(p).toMatch(/html\.dark[\s\S]*--wb-bg:\s*#14171c/);
  });

  it('workbench does not re-own color hex scales', () => {
    const wb = read('workbench.css');
    expect(wb).not.toMatch(/--wb-bg:\s*#f2f3f5/);
    expect(wb).not.toMatch(/--wb-panel:\s*#ffffff/);
  });

  it('export menu does not use Tailwind default blue/gray', () => {
    const src = read('components/common/ExportMenu.tsx');
    expect(src).not.toMatch(/bg-blue-50|text-blue-600|border-gray-200|text-gray-700/);
    expect(src).toMatch(/--wb-brand/);
  });
});
