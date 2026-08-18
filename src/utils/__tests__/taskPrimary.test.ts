import { describe, expect, it } from 'vitest';
import { resolveTaskPrimary, type TaskPrimaryFile } from '../taskPrimary';
import type { FilePhases } from '@/types';

function avFile(overrides: Partial<TaskPrimaryFile> & { phases?: Partial<FilePhases> } = {}): TaskPrimaryFile {
  const { phases, ...rest } = overrides;
  return {
    fileType: 'video',
    entryCount: 0,
    translatedCount: 0,
    aiSegmentationEnabled: false,
    phases: {
      workflow: 'full',
      converting: { status: 'completed', progress: 100, tokens: 0 },
      transcribing: { status: 'upcoming', progress: 0, tokens: 0 },
      translating: { status: 'upcoming', progress: 0, tokens: 0 },
      ...phases,
    },
    ...rest,
  };
}

describe('resolveTaskPrimary', () => {
  it('keeps 转译 as the AV primary even after transcription fails', () => {
    const file = avFile({
      phases: {
        workflow: 'transcribe',
        converting: { status: 'completed', progress: 100, tokens: 0 },
        transcribing: { status: 'failed', progress: 40, tokens: 0, transcriptId: 'tid' },
        translating: { status: 'upcoming', progress: 0, tokens: 0 },
      },
    });
    const primary = resolveTaskPrimary(file, { isQueued: false, isBusy: false });
    expect(primary).toMatchObject({
      action: 'full',
      label: '重转译',
      title: '转录翻译',
      enabled: true,
    });
  });

  it('uses 转译 before any work starts', () => {
    const primary = resolveTaskPrimary(avFile(), { isQueued: false, isBusy: false });
    expect(primary.action).toBe('full');
    expect(primary.label).toBe('转译');
    expect(primary.enabled).toBe(true);
  });

  it('switches to 翻译 after transcription is done', () => {
    const file = avFile({
      entryCount: 10,
      translatedCount: 0,
      phases: {
        workflow: 'full',
        converting: { status: 'completed', progress: 100, tokens: 0 },
        transcribing: { status: 'completed', progress: 100, tokens: 0 },
        translating: { status: 'upcoming', progress: 0, tokens: 0 },
      },
    });
    const primary = resolveTaskPrimary(file, { isQueued: false, isBusy: false });
    expect(primary).toMatchObject({ action: 'translate', label: '翻译', enabled: true });
  });

  it('disables while busy and becomes 取消排队 when queued', () => {
    const file = avFile();
    expect(resolveTaskPrimary(file, { isQueued: false, isBusy: true }).enabled).toBe(false);
    expect(resolveTaskPrimary(file, { isQueued: true, isBusy: false })).toMatchObject({
      action: 'cancel',
      label: '取消排队',
      enabled: true,
    });
  });
});
