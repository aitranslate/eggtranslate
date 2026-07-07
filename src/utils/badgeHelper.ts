import type { FilePhases, ProgressPhase } from '@/types';

export interface BadgeInfo {
  text: string;
  color: 'green' | 'blue' | 'gray' | 'red' | 'yellow';
}

/**
 * 根据 phases 和 displayPhases 计算 badge 信息
 * 规则：
 * - 有 active 阶段 → "处理中" 蓝色
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
export function getQueueBadge(queuePosition: number): BadgeInfo {
  return { text: `排队中 #${queuePosition}`, color: 'yellow' };
}

/**
 * 判断连接线是否亮起
 * 规则：前节点 completed + 后节点 status !== 'upcoming' → 蓝
 */
export function shouldLineBeActive(
  prevPhaseStatus: string,
  nextPhaseStatus: string
): boolean {
  return prevPhaseStatus === 'completed' && nextPhaseStatus !== 'upcoming';
}