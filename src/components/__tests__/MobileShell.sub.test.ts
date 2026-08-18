import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('MobileShell navigation contracts', () => {
  const src = readFileSync(join(__dirname, '../mobile/MobileShell.tsx'), 'utf8');

  it('puts project / terms / history in the top nav (not a bottom tab bar)', () => {
    expect(src).toContain('m-nav');
    expect(src).not.toContain('m-tabbar');
    expect(src).toContain('openEditor');
    expect(src).toContain('openTerms');
    expect(src).toContain('openHistory');
    expect(src).toMatch(/stage === 'editor'/);
    expect(src).toMatch(/stage === 'terms'/);
    expect(src).toMatch(/stage === 'history'/);
  });

  it('splits list selection from opening the subtitle editor', () => {
    expect(src).toContain('mobileEditorOpen');
    expect(src).toContain('openMobileEditor');
    expect(src).toContain('closeMobileEditor');
    expect(src).toContain('handleSelectTask');
    expect(src).toContain('handleOpenTask');
    expect(src).toContain('MobileTaskDock');
    expect(src).not.toContain('MobileDetailBar');
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

  it('shows product name on list home (not bare 项目 as the only title)', () => {
    expect(src).toContain('蛋蛋字幕翻译');
  });

  it('keeps top bar to navigation + settings (appearance lives in settings)', () => {
    expect(src).not.toContain('toggleTheme');
    expect(src).not.toContain('handleToggleSound');
    expect(src).not.toMatch(/aria-label=["']切换主题["']/);
    expect(src).not.toContain('Volume2');
    expect(src).toContain('MobileListEmpty');
  });
});
