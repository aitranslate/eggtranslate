import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('MainApp workbench shell', () => {
  const src = readFileSync(join(__dirname, '../MainApp.tsx'), 'utf8');

  it('uses length-only useFileCount, not full useFiles for has-files UI', () => {
    expect(src).toContain('useFileCount');
    expect(src).toMatch(/const fileCount = useFileCount\(/);
    expect(src).not.toMatch(/const files = useFiles\(/);
    expect(src).toContain('fileCount > 0');
  });

  it('uses workbench layout and stage routing', () => {
    expect(src).toContain('workbench');
    expect(src).toContain('useWorkspaceStore');
    expect(src).toContain('selectedFileId');
    expect(src).toContain('variant="sidebar"');
    expect(src).toContain('StatusBar');
    expect(src).toContain('工作区');
  });

  it('settings is a drawer overlay, not a stage that replaces workspace', () => {
    expect(src).toContain('settingsOpen');
    expect(src).toContain('<SettingsModal isOpen={settingsOpen}');
    expect(src).not.toContain("stage === 'settings'");
  });

  it('defaults to editor-first without auto-opening settings', () => {
    expect(src).toContain('openEditor');
    expect(src).not.toMatch(/if\s*\(\s*!isConfigured\s*\)\s*\{\s*openSettings/);
    expect(src).toContain('useFileImport');
    expect(src).toContain('wb-tasks-import');
  });

  it('branches to MobileShell on mobile breakpoint', () => {
    expect(src).toContain('useIsMobile');
    expect(src).toContain('MobileShell');
    expect(src).toMatch(/if\s*\(\s*isMobile\s*\)/);
  });

  it('does not mount per-character SplitHeading', () => {
    expect(src).not.toContain('SplitHeading');
    expect(src).not.toContain('from \'./motion/FadeIn\'');
  });
});
