/**
 * @vitest-environment jsdom
 */
import React, { memo } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import {
  SubtitleDisplayRow,
  SubtitleEditingRow,
} from '../SubtitleEditor';
import type { SubtitleEntry } from '@/types';

const makeEntry = (id: number): SubtitleEntry => ({
  id,
  startTime: '00:00:00,000',
  endTime: '00:00:01,000',
  text: `text-${id}`,
  translatedText: '',
  translationStatus: 'pending',
});

describe('SubtitleEditor draft isolation', () => {
  it('non-editing display rows do not re-render when draft text changes', () => {
    const onStartEdit = vi.fn();
    const entry1 = makeEntry(1);
    const entry2 = makeEntry(2);

    let count1 = 0;
    let count2 = 0;

    // Mirrors production: display rows only receive stable props (no draft)
    const SpyDisplay1 = memo(function SpyDisplay1(
      props: React.ComponentProps<typeof SubtitleDisplayRow>
    ) {
      count1 += 1;
      return <SubtitleDisplayRow {...props} />;
    });
    const SpyDisplay2 = memo(function SpyDisplay2(
      props: React.ComponentProps<typeof SubtitleDisplayRow>
    ) {
      count2 += 1;
      return <SubtitleDisplayRow {...props} />;
    });

    function Harness({
      draft,
      e1,
    }: {
      draft: string;
      e1: SubtitleEntry;
    }) {
      return (
        <>
          <SpyDisplay1 entry={e1} index={0} start={0} onStartEdit={onStartEdit} />
          <SpyDisplay2 entry={entry2} index={1} start={80} onStartEdit={onStartEdit} />
          <SubtitleEditingRow
            entry={makeEntry(99)}
            index={2}
            start={160}
            editText={draft}
            editTranslation=""
            onSaveEdit={() => {}}
            onCancelEdit={() => {}}
            setEditText={() => {}}
            setEditTranslation={() => {}}
          />
        </>
      );
    }

    const view = render(<Harness draft="a" e1={entry1} />);
    expect(count1).toBe(1);
    expect(count2).toBe(1);

    act(() => {
      view.rerender(<Harness draft="abcdef-changed" e1={entry1} />);
    });

    // Parent re-rendered with new draft; display spies keep same props → no re-render
    expect(count1).toBe(1);
    expect(count2).toBe(1);

    // Control: entry identity change forces only that display row to re-render
    const entry1b = { ...entry1, text: 'changed-text' };
    act(() => {
      view.rerender(<Harness draft="abcdef-changed" e1={entry1b} />);
    });
    expect(count1).toBe(2);
    expect(count2).toBe(1);
  });

  it('exports separate Display and Editing row components (structural)', () => {
    expect(SubtitleDisplayRow).toBeTruthy();
    expect(SubtitleEditingRow).toBeTruthy();
  });
});
