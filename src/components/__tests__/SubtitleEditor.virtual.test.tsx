/**
 * @vitest-environment jsdom
 */
import React, { createRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SubtitleDisplayRow } from '../SubtitleEditor';
import type { SubtitleEntry } from '@/types';

const makeEntry = (id: number): SubtitleEntry => ({
  id,
  startTime: '00:00:00,000',
  endTime: '00:00:01,000',
  text: `text-${id}`,
  translatedText: `tr-${id}`,
  translationStatus: 'completed',
});

describe('SubtitleEditor virtual row contracts', () => {
  const src = readFileSync(join(__dirname, '../SubtitleEditor.tsx'), 'utf8');

  it('uses mobile-aware estimateSize, getItemKey, and layout-style contain', () => {
    expect(src).toContain('ROW_HEIGHT_MOBILE_ESTIMATE');
    expect(src).toContain('useIsMobile');
    expect(src).toContain('getItemKey');
    expect(src).toContain("contain: 'layout style'");
    expect(src).toContain('virtualizer.measureElement');
    expect(src).toContain('virtualizer.measure()');
  });

  it('forwards ref and exposes data-index for measureElement', () => {
    const ref = createRef<HTMLDivElement>();
    const onStartEdit = vi.fn();
    render(
      <SubtitleDisplayRow
        ref={ref}
        entry={makeEntry(7)}
        index={3}
        start={128}
        onStartEdit={onStartEdit}
      />
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current?.getAttribute('data-index')).toBe('3');
    expect(ref.current?.getAttribute('data-testid')).toBe('subtitle-row-7');
  });
});
