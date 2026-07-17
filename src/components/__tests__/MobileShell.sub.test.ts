import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('MobileShell navigation contracts', () => {
  const src = readFileSync(join(__dirname, '../mobile/MobileShell.tsx'), 'utf8');

  it('exposes bottom tab bar for workspace / terms / history', () => {
    expect(src).toContain('m-tabbar');
    expect(src).toContain('openEditor');
    expect(src).toContain('openTerms');
    expect(src).toContain('openHistory');
    expect(src).toMatch(/stage === 'editor'/);
    expect(src).toMatch(/stage === 'terms'/);
    expect(src).toMatch(/stage === 'history'/);
  });

  it('mounts LazyTermsManager and LazyHistoryModal as panel surfaces', () => {
    expect(src).toContain('LazyTermsManager');
    expect(src).toContain('LazyHistoryModal');
    expect(src).toContain('variant="panel"');
  });

  it('keeps settings entry with unconfigured warning affordance', () => {
    expect(src).toContain('openSettings');
    expect(src).toMatch(/!isConfigured/);
    expect(src).toContain('m-dot-warn');
    expect(src).toContain('aria-label="设置"');
  });

  it('does not depend on removed MobileMenu / Radix dialog', () => {
    expect(src).not.toContain('MobileMenu');
    expect(src).not.toContain('radix');
    expect(src).not.toContain('@radix-ui');
  });
});
