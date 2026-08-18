import type { FilePhases, PhaseProgress, ProgressPhase } from '@/types';
import { ALL_PHASES } from '@/types';
import { formatAiSegmentProgress, formatPhaseCountProgress } from '@/utils/uxHelpers';

interface BadgeInfo {
  text: string;
  color: 'green' | 'blue' | 'gray' | 'red' | 'yellow';
}

/**
 * 根据 phases 和 displayPhases 计算 badge 信息
 * 规则：
 * - 有 active 阶段 → "处理中" 蓝色（列表副标题不展示文案，只用 color 驱动圆点/色调）
 * - displayPhases 全部 completed → "已完成" 绿色
 * - displayPhases 部分 completed（最后一个完成阶段的名称）+ "完成" 蓝色
 * - 全 upcoming → "未开始" 灰色
 * - 有 failed → "失败" 红色
 */
export function getCardBadge(
  phases: FilePhases,
  displayPhases: ProgressPhase[],
  isQueued?: boolean,
  queuePosition?: number
): BadgeInfo {
  // 排队中优先级最高（在 phase 判断之前）
  if (isQueued && queuePosition != null) {
    return getQueueBadge(queuePosition);
  }

  const statuses = displayPhases.map(p => phases[p].status);

  if (statuses.includes('active')) {
    return { text: '处理中', color: 'blue' };
  }

  if (statuses.includes('failed')) {
    // 阶段名失败，避免空泛的「失败」+ 红框再喊一遍
    if (phases.translating?.status === 'failed') {
      return { text: '翻译失败', color: 'red' };
    }
    if (phases.transcribing?.status === 'failed') {
      return { text: '识别失败', color: 'red' };
    }
    if (phases.converting?.status === 'failed') {
      return { text: '转码失败', color: 'red' };
    }
    return { text: '失败', color: 'red' };
  }

  const completedCount = statuses.filter(s => s === 'completed').length;

  if (completedCount === displayPhases.length) {
    return { text: '已完成', color: 'green' };
  }

  if (completedCount > 0) {
    // 找最后一个 completed 阶段
    let lastCompletedIndex = -1;
    for (let i = statuses.length - 1; i >= 0; i--) {
      if (statuses[i] === 'completed') {
        lastCompletedIndex = i;
        break;
      }
    }
    const lastCompletedPhase = displayPhases[lastCompletedIndex];
    const phaseNames: Record<ProgressPhase, string> = {
      converting: '转码',
      transcribing: '转录',
      segmenting: 'AI断句',
      translating: '翻译'
    };
    return { text: `${phaseNames[lastCompletedPhase]}完成`, color: 'blue' };
  }

  return { text: '未开始', color: 'gray' };
}

/**
 * 排队中状态的 badge
 * 排队中不是 phases 的 status，而是从 taskQueue 派生的 UI 状态
 */
function getQueueBadge(queuePosition: number): BadgeInfo {
  return { text: `排队中 #${queuePosition}`, color: 'yellow' };
}

/** 阶段 chip「翻译」文案（Agent 路径已移除，恒为「翻译」）。 */
export function resolveTranslatePhaseLabel(): string {
  return '翻译';
}

/**
 * 列表/详情要展示的阶段。转码不单独露；SRT 无识别/断句；
 * AI 断句仅在任务创建时带了该阶段才出现。
 */
export function getDisplayPhases(file: {
  fileType?: string | null;
  phases: FilePhases;
}): ProgressPhase[] {
  const base =
    file.fileType === 'srt'
      ? ALL_PHASES.filter(
          (p) => p !== 'converting' && p !== 'transcribing' && p !== 'segmenting'
        )
      : ALL_PHASES.filter((p) => p !== 'converting');
  return base.filter((p) => p !== 'segmenting' || Boolean(file.phases.segmenting));
}

export function formatTaskPhaseChipLabel(
  phase: ProgressPhase,
  opts: {
    status?: PhaseProgress['status'];
    segmenting?: Pick<PhaseProgress, 'entryCount' | 'totalEntries'> | null;
    translated: number;
    total: number;
  }
): string {
  if (phase === 'converting') return '转码';
  if (phase === 'transcribing') return '识别';
  if (phase === 'segmenting') {
    return opts.status === 'active'
      ? formatAiSegmentProgress(opts.segmenting) ?? 'AI断句'
      : 'AI断句';
  }
  return formatPhaseCountProgress(
    resolveTranslatePhaseLabel(),
    opts.translated,
    opts.total
  );
}
