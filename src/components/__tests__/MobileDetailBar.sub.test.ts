import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('MobileTaskDock command surface', () => {
  const src = readFileSync(join(__dirname, '../mobile/MobileTaskDock.tsx'), 'utf8');

  it('is a list command dock without keyterms or a collapse sheet', () => {
    expect(src).toContain('data-testid="mobile-dock-primary"');
    expect(src).toContain('resolveTaskPrimary');
    expect(src).toContain('data-testid="mobile-task-dock"');
    expect(src).not.toContain('is-collapsed');
    expect(src).not.toContain('aria-label="热词分组"');
    expect(src).not.toContain('selectedKeytermGroupId');
    expect(src).not.toContain('setExpanded');
    expect(src).not.toContain('MOBILE_DETAIL_SCROLL_EVENT');
  });

  it('shows translation progress with the shared n/m formatter', () => {
    expect(src).toContain('formatTaskPhaseChipLabel');
    expect(src).toContain('useTaskDisplayModel');
    expect(src).toContain('data-testid="mobile-detail-status"');
  });
});

describe('editor no longer drives a collapsible detail bar', () => {
  const editor = readFileSync(join(__dirname, '../SubtitleEditor.tsx'), 'utf8');

  it('does not import MobileDetailBar scroll events', () => {
    expect(editor).not.toContain('MOBILE_DETAIL_SCROLL_EVENT');
    expect(editor).not.toContain('MobileDetailBar');
  });

  it('hosts per-task keyterms in the mobile chrome', () => {
    expect(editor).toContain('editor-keyterm-select');
    expect(editor).toContain('下次转录才生效');
  });
});
