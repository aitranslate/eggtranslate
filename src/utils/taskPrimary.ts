/**
 * 任务主按钮：由「接下来该跑哪条产品路径」决定，不因某阶段失败改入口。
 *
 * - 音视频还要识别 / 断句 → 转译（中断后仍是转译，文案为重转译）
 * - 否则还要翻译 → 翻译
 * - 「仅转录」是旁路，不是识别失败后的唯一恢复口
 */
import type { SubtitleFileMetadata } from '@/types';
import { needsTranscriptionWork } from '@/utils/taskGuards';

export type TaskPrimaryAction = 'cancel' | 'full' | 'translate' | 'idle';

export interface TaskPrimary {
  action: TaskPrimaryAction;
  label: string;
  title: string;
  enabled: boolean;
}

export type TaskPrimaryFile = Pick<
  SubtitleFileMetadata,
  'fileType' | 'entryCount' | 'translatedCount' | 'phases' | 'aiSegmentationEnabled'
>;

export function resolveTaskPrimary(
  file: TaskPrimaryFile,
  ui: { isQueued: boolean; isBusy: boolean }
): TaskPrimary {
  if (ui.isQueued) {
    return { action: 'cancel', label: '取消排队', title: '取消排队', enabled: true };
  }

  if (needsTranscriptionWork(file)) {
    const interrupted =
      file.phases.transcribing.status === 'failed' ||
      file.phases.segmenting?.status === 'failed';
    const label = interrupted ? '重转译' : '转译';
    return {
      action: 'full',
      label,
      title: '转录翻译',
      enabled: !ui.isBusy,
    };
  }

  const entryCount = file.entryCount ?? 0;
  const translatedCount = file.translatedCount ?? 0;
  const translateDone =
    file.phases.translating.status === 'completed' ||
    (entryCount > 0 && translatedCount >= entryCount);

  if (translateDone) {
    return { action: 'idle', label: '已完成', title: '已完成', enabled: false };
  }

  const label = file.phases.translating.status === 'failed' ? '重试' : '翻译';
  return {
    action: 'translate',
    label,
    title: label,
    enabled: !ui.isBusy,
  };
}
