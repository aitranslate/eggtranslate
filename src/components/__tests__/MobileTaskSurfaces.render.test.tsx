/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SubtitleFileMetadata } from '@/types';
import { MobileTaskDock } from '@/components/mobile/MobileTaskDock';
import { MobileTaskCard } from '@/components/mobile/MobileTaskCard';
import { MobileListEmpty } from '@/components/mobile/MobileListEmpty';

function srtFile(partial?: Partial<SubtitleFileMetadata>): SubtitleFileMetadata {
  return {
    id: 'f1',
    taskId: 't1',
    name: 'demo.srt',
    fileType: 'srt',
    fileSize: 1,
    entryCount: 120,
    translatedCount: 13,
    selectedKeytermGroupId: null,
    phases: {
      workflow: 'translate',
      converting: { status: 'completed', progress: 100, tokens: 0 },
      transcribing: { status: 'upcoming', progress: 0, tokens: 0 },
      translating: { status: 'active', progress: 10, tokens: 0 },
    },
    ...partial,
  } as SubtitleFileMetadata;
}

describe('mobile task surfaces', () => {
  it('binds the list dock to the selected file with 翻译 n/m', () => {
    render(<MobileTaskDock file={srtFile()} />);
    expect(screen.getByTestId('mobile-dock-primary')).toBeTruthy();
    expect(screen.getByTestId('mobile-task-dock').textContent).toContain('demo.srt');
    expect(screen.getByTestId('mobile-detail-status').textContent).toBe('翻译 13/120');
    expect(screen.queryByLabelText('热词分组')).toBeNull();
  });

  it('selects on the card body and opens the editor only from the chevron', () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    render(
      <MobileTaskCard
        file={srtFile()}
        selected
        isQueued={false}
        queuePosition={0}
        isActive
        onSelect={onSelect}
        onOpen={onOpen}
      />
    );
    expect(screen.getByTestId('task-phase-chips').textContent).toContain('翻译 13/120');
    fireEvent.click(screen.getByTestId('mobile-task-card'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('mobile-task-open'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('unconfigured empty state is a single configure-first surface', () => {
    render(
      <MobileListEmpty
        isConfigured={false}
        sampleLoading={false}
        onConfigure={() => {}}
        onImport={() => {}}
        onSample={() => {}}
      />
    );
    expect(screen.getByRole('heading', { name: '先配置翻译 API' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '配置 API' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '试用示例字幕' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '导入文件' })).toBeTruthy();
  });
});
