import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('MainApp workbench shell', () => {
  const src = readFileSync(join(__dirname, '../MainApp.tsx'), 'utf8');

  it('uses length-only useFileCount, not full useFiles for has-files UI', () => {
    expect(src).toContain('useFileCount');
    expect(src).toMatch(/const fileCount = useFileCount\(/);
    expect(src).not.toMatch(/const files = useFiles\(/);
    // 空态状态机在 EmptyWorkspaceHero，MainApp 只传 fileCount
    expect(src).toContain('EmptyWorkspaceHero');
    expect(src).toContain('fileCount={fileCount}');
  });

  it('does not mount onboarding layer', () => {
    expect(src).not.toContain('OnboardingHost');
    expect(src).not.toContain('onboardingStore');
    expect(src).toContain('EmptyWorkspaceHero');
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
    // 首次打开后保持挂载；isOpen 控制显隐，不占用 stage
    expect(src).toContain('settingsMounted');
    expect(src).toContain('LazySettingsModal');
    expect(src).toMatch(/isOpen=\{settingsOpen\}/);
    expect(src).not.toContain("stage === 'settings'");
  });

  it('keeps workbench grid pure: overlays are siblings outside .workbench', () => {
    // 布局壳在 StatusBar 后闭合；设置挂载在「浮层」注释之后
    expect(src).toMatch(/<StatusBar\s*\/>\s*<\/div>/);
    expect(src).toMatch(
      /<StatusBar\s*\/>\s*<\/div>\s*\{\/\*\s*浮层[\s\S]*?<LazySettingsModal[\s\S]*?<MobileMenu/
    );
    // 设置不得再出现在 workbench 开标签与 StatusBar 之间
    const wbOpen = src.indexOf('className={`workbench');
    const status = src.indexOf('<StatusBar');
    const slice = src.slice(wbOpen, status);
    expect(slice).not.toMatch(/<LazySettingsModal/);
    expect(slice).not.toMatch(/<MobileMenu/);
  });

  it('defaults to editor-first without auto-opening settings', () => {
    expect(src).toContain('openEditor');
    expect(src).not.toMatch(/if\s*\(\s*!isConfigured\s*\)\s*\{\s*openSettings/);
    expect(src).toContain('useFileImport');
    // 侧栏导入按钮在 SubtitleFileList 头栏，MainApp 只传 onImport
    expect(src).toContain('onImport={openFilePicker}');
    expect(src).toContain('importShortcut={importShortcut}');
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
