import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('MainApp subscription + shell motion', () => {
  const src = readFileSync(join(__dirname, '../MainApp.tsx'), 'utf8');

  it('uses length-only useFileCount, not full useFiles for has-files UI', () => {
    expect(src).toContain('useFileCount');
    expect(src).toMatch(/const fileCount = useFileCount\(/);
    expect(src).not.toMatch(/const files = useFiles\(/);
    expect(src).toContain('fileCount > 0');
  });

  it('does not mount per-character SplitHeading or shell FadeIn', () => {
    expect(src).not.toContain('SplitHeading');
    expect(src).not.toContain('from \'./motion/FadeIn\'');
    expect(src).not.toContain('from "framer-motion"');
    expect(src).not.toContain("from 'framer-motion'");
  });
});
