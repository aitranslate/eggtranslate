import type { FilePhases, ProgressPhase, TranslationPath } from '@/types';

export interface BadgeInfo {
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
 * 主操作按钮在忙碌时的文案：不再写「处理中」（阶段 chip / 进度已表达）。
 * 保留「翻译」「转译」等动作名，禁用态即可。
 */
export function resolveBusyPrimaryLabel(opts: {
  isQueued: boolean;
  isBusy: boolean;
  isAudioVideo: boolean;
  isTranscriptionDone: boolean;
  idleLabel: string;
}): string {
  if (opts.isQueued) return '取消排队';
  if (!opts.isBusy) return opts.idleLabel;
  // 忙：显示原动作名（灰显），避免第三处「处理中」
  if (opts.isAudioVideo && !opts.isTranscriptionDone) return '转译';
  return opts.idleLabel === '转译' ? opts.idleLabel : '翻译';
}

/**
 * 阶段 chip「翻译」文案：按**任务事实**，不跟全局开关瞎改历史。
 *
 * 优先级：
 * 1. 已落库 translationPath（agent/batch）
 * 2. 本任务 Agent 正在跑
 * 3. 尚未写出 path 的 upcoming/active：才看全局 agentEnabled（即将走哪条路）
 * 4. 默认「翻译」
 */
export function resolveTranslatePhaseLabel(opts: {
  translationPath?: TranslationPath | null;
  agentRunActive?: boolean;
  agentEnabled?: boolean;
  translatingStatus?: string | null;
}): string {
  if (opts.translationPath === 'agent') return 'Agent翻译';
  if (opts.translationPath === 'batch') return '翻译';
  if (opts.agentRunActive) return 'Agent翻译';
  const st = opts.translatingStatus || '';
  if (
    (st === 'upcoming' || st === 'active') &&
    opts.agentEnabled
  ) {
    return 'Agent翻译';
  }
  return '翻译';
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