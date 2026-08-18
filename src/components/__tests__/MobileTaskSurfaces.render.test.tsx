/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SubtitleFileMetadata } from '@/types';
import { MobileDetailBar } from '@/components/mobile/MobileDetailBar';
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
  it('always shows the detail primary button and 翻译 n/m', () => {
    render(<MobileDetailBar file={srtFile()} />);
    expect(screen.getByTestId('mobile-detail-primary')).toBeTruthy();
    expect(screen.getByTestId('mobile-detail-status').textContent).toBe('翻译 13/120');
    expect(screen.queryByLabelText('展开操作：热词、导出、转录、翻译')).toBeNull();
  });

  it('shows 翻译 n/m on the list card', () => {
    render(
      <MobileTaskCard
        file={srtFile()}
        isQueued={false}
        queuePosition={0}
        isActive
        onOpen={() => {}}
      />
    );
    expect(screen.getByTestId('task-phase-chips').textContent).toContain('翻译 13/120');
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
