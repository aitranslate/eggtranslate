/**
 * 任务阶段 chip。桌面侧栏与移动列表共用文案与状态符号。
 */

import { Loader2 } from 'lucide-react';
import type { FilePhases, ProgressPhase } from '@/types';
import { formatTaskPhaseChipLabel } from '@/utils/badgeHelper';

interface TaskPhaseChipsProps {
  phases: ProgressPhase[];
  filePhases: FilePhases;
  translated: number;
  total: number;
  className: string;
  chipClassName?: string;
}

export function TaskPhaseChips({
  phases,
  filePhases,
  translated,
  total,
  className,
  chipClassName = 'wb-proj-phase',
}: TaskPhaseChipsProps) {
  return (
    <div className={className} data-testid="task-phase-chips">
      {phases.map((phase) => {
        const st = filePhases[phase]?.status;
        const err = filePhases[phase]?.errorMessage;
        const label = formatTaskPhaseChipLabel(phase, {
          status: st,
          segmenting: filePhases.segmenting,
          translated,
          total,
        });
        const title =
          st === 'active'
            ? `${label}中`
            : st === 'completed'
              ? `${label}完成`
              : st === 'failed'
                ? err?.trim()
                  ? `${label}失败：${err}`
                  : `${label}失败`
                : label;
        return (
          <span
            key={phase}
            className={`${chipClassName} st-${st || 'upcoming'}`}
            title={title}
          >
            {st === 'completed' ? (
              '✓'
            ) : st === 'failed' ? (
              <span className={`${chipClassName}-x`} aria-hidden>
                ×
              </span>
            ) : st === 'active' ? (
              <Loader2 className={`${chipClassName}-spin`} aria-hidden />
            ) : (
              '·'
            )}
            <span>{label}</span>
          </span>
        );
      })}
    </div>
  );
}
