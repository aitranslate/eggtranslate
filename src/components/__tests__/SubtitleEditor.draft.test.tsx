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
          <SpyDisplay2 entry={entry2} index={1} start={72} onStartEdit={onStartEdit} />
          <SubtitleEditingRow
            entry={makeEntry(99)}
            index={2}
            start={144}
            editText={draft}
            editTranslation=""
            editStartTime="00:00:00,000"
            editEndTime="00:00:01,000"
            focusField="translation"
            onSaveEdit={() => {}}
            onCancelEdit={() => {}}
            setEditText={() => {}}
            setEditTranslation={() => {}}
            setEditStartTime={() => {}}
            setEditEndTime={() => {}}
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

    expect(count1).toBe(1);
    expect(count2).toBe(1);

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

  it('editing row is inline (same se-row shell, no expand chrome)', () => {
    const { container } = render(
      <SubtitleEditingRow
        entry={makeEntry(1)}
        index={0}
        start={0}
        editText="hello"
        editTranslation="你好"
        editStartTime="00:00:00,000"
        editEndTime="00:00:01,000"
        focusField="translation"
        onSaveEdit={() => {}}
        onCancelEdit={() => {}}
        setEditText={() => {}}
        setEditTranslation={() => {}}
        setEditStartTime={() => {}}
        setEditEndTime={() => {}}
      />
    );
    const row = container.querySelector('[data-editing="true"]');
    expect(row?.classList.contains('se-row')).toBe(true);
    expect(row?.classList.contains('se-row-editing')).toBe(true);
    // 无大按钮展开区（时间行是 label+input）
    expect(container.querySelectorAll('button').length).toBe(0);
    expect(container.querySelectorAll('textarea.se-inline-input').length).toBe(2);
    expect(container.querySelectorAll('input.se-time-input').length).toBe(2);
  });

  it('display row is five flat columns: # start end src dst', () => {
    const { container } = render(
      <SubtitleDisplayRow
        entry={makeEntry(1)}
        index={0}
        start={0}
        onStartEdit={() => {}}
      />
    );
    const row = container.querySelector('.se-row');
    expect(row?.querySelector('.se-row-idx')?.textContent).toBe('#1');
    const times = container.querySelectorAll('button.se-row-time');
    expect(times).toHaveLength(2);
    expect(times[0].textContent).toBe('00:00:00,000');
    expect(times[1].textContent).toBe('00:00:01,000');
    expect(container.querySelector('.se-row-src')?.textContent).toContain('text-1');
    expect(container.querySelector('.se-row-dst')).toBeTruthy();
  });
});
