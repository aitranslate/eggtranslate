// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useFilesStore } from '@/stores/filesStore';
import { TranscodingIndicator } from '../TranscodingIndicator';
import type { SingleTask, FilePhases } from '@/types';

const UPCOMING: FilePhases = {
  workflow: 'transcribe',
  converting: { status: 'upcoming', progress: 0, tokens: 0 },
  transcribing: { status: 'upcoming', progress: 0, tokens: 0 },
  translating: { status: 'upcoming', progress: 0, tokens: 0 },
  splitting: { status: 'upcoming', progress: 0, tokens: 0 },
};

const makeTask = (overrides: Partial<SingleTask> = {}): SingleTask => ({
  taskId: 't1',
  subtitle_filename: 'video1.mp4',
  subtitle_entries: [],
  phases: UPCOMING,
  index: 0,
  fileType: 'video',
  fileSize: 1024,
  selectedKeytermGroupId: null,
  entryCount: 0,
  translatedCount: 0,
  ...overrides,
});

const makeConverting = (id: string, name: string): SingleTask => makeTask({
  taskId: id,
  subtitle_filename: name,
  phases: {
    ...UPCOMING,
    converting: { status: 'active', progress: 0, tokens: 0 },
  },
});

describe('TranscodingIndicator', () => {
  beforeEach(() => {
    useFilesStore.setState({ tasks: [], selectedFileId: null });
  });

  it('没有转码中文件时不渲染', () => {
    useFilesStore.setState({ tasks: [makeTask()] });
    const { container } = render(<TranscodingIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('1 个文件转码中：显示"正在转码 1 个文件"', () => {
    useFilesStore.setState({ tasks: [makeConverting('t1', 'a.mp4')] });
    const { container } = render(<TranscodingIndicator />);
    const countEl = container.querySelector('[data-testid="transcoding-count"]');
    expect(countEl?.textContent).toBe('正在转码 1 个文件');
  });

  it('多文件转码中：显示正确数量', () => {
    useFilesStore.setState({
      tasks: [
        makeTask({ taskId: 'idle' }),
        makeConverting('t1', 'a.mp4'),
        makeConverting('t2', 'b.m4a'),
      ],
    });
    const { container } = render(<TranscodingIndicator />);
    const countEl = container.querySelector('[data-testid="transcoding-count"]');
    expect(countEl?.textContent).toBe('正在转码 2 个文件');
  });

  it('SRT 文件不计入（即使 converting 是 upcoming 也算 0）', () => {
    useFilesStore.setState({
      tasks: [makeTask({ fileType: 'srt', taskId: 'srt1' })],
    });
    const { container } = render(<TranscodingIndicator />);
    expect(container.firstChild).toBeNull();
  });

  it('展开后显示每个转码中文件的名字', () => {
    useFilesStore.setState({
      tasks: [makeConverting('t1', 'myvideo.mp4')],
    });
    const { container } = render(<TranscodingIndicator />);
    const expandBtn = container.querySelector('[data-testid="transcoding-indicator-toggle"]') as HTMLElement;
    fireEvent.click(expandBtn);
    expect(container.textContent).toContain('myvideo.mp4');
  });

  it('转码完成（status: completed）后自动隐藏', () => {
    useFilesStore.setState({
      tasks: [makeTask({
        taskId: 't1',
        phases: {
          ...UPCOMING,
          converting: { status: 'completed', progress: 100, tokens: 0 },
        },
      })],
    });
    const { container } = render(<TranscodingIndicator />);
    expect(container.firstChild).toBeNull();
  });
});
