import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('MobileDetailBar action dock', () => {
  const src = readFileSync(join(__dirname, '../mobile/MobileDetailBar.tsx'), 'utf8');

  it('always renders the primary action (no collapse sheet)', () => {
    expect(src).toContain('data-testid="mobile-detail-primary"');
    expect(src).toContain('resolveTaskPrimary');
    expect(src).not.toContain('is-collapsed');
    expect(src).not.toContain('setExpanded');
    expect(src).not.toContain('MOBILE_DETAIL_SCROLL_EVENT');
    expect(src).not.toContain('ChevronUp');
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
});
