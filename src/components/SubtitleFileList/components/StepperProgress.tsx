/**
 * 工作流进度：按阶段数 + 终态自适应
 * - 全部完成：紧凑摘要行（不占大步进）
 * - 1 步进行中/未开始：统一状态行 + 进度条
 * - 2+ 步进行中：紧凑节点轨 + 可填充软连线
 */

import { Check, X, Mic, Languages, Loader2, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';
import { useFilesStore } from '@/stores/filesStore';
import { generateStableFileId } from '@/utils/taskIdGenerator';
import { PhaseTooltipCard } from './PhaseTooltipCard';
import { shouldLineBeActive } from '@/utils/badgeHelper';
import { ALL_PHASES, type ProgressPhase, type PhaseProgress } from '@/types';

interface StepperProgressProps {
  fileId: string;
  onTooltipVisibleChange?: (visible: boolean) => void;
}

/** 使用设计 token（CSS 变量），避免散落硬编码蓝 */
const BRAND = 'var(--apple-blue)';
const BRAND_SOFT = 'var(--apple-blue-soft-strong)';
const BRAND_SOFT_WEAK = 'var(--apple-blue-soft)';
const GRAY_LINE = 'var(--apple-border-lighter)';
const GRAY_MUTED = 'var(--apple-text-secondary)';
const GRAY_TEXT = 'var(--apple-text-primary)';
const RED = 'var(--apple-danger)';
const GREEN = 'var(--apple-success)';
const GREEN_SOFT = 'var(--apple-success-soft)';
const SHELL_BG = 'var(--apple-bg-secondary)';

const PHASE_LABELS: Record<ProgressPhase, string> = {
  converting: '视频转码',
  transcribing: '语音识别',
  translating: '字幕翻译',
};

const PHASE_SHORT: Record<ProgressPhase, string> = {
  converting: '转码',
  transcribing: '识别',
  translating: '翻译',
};

const PHASE_ICONS: Record<ProgressPhase, React.ReactNode> = {
  converting: null,
  transcribing: <Mic className="w-3.5 h-3.5" strokeWidth={2.2} />,
  translating: <Languages className="w-3.5 h-3.5" strokeWidth={2.2} />,
};

function phaseMeta(phase: PhaseProgress, opts?: { idleHint?: string }): string | null {
  if (phase.status === 'failed') {
    return phase.errorMessage?.trim() ? phase.errorMessage : '失败';
  }
  if (
    phase.entryCount != null &&
    phase.totalEntries != null &&
    phase.totalEntries > 0 &&
    (phase.status === 'active' || phase.status === 'completed')
  ) {
    return `${phase.entryCount}/${phase.totalEntries} 条`;
  }
  if (phase.status === 'active' && phase.progress >= 0) {
    return `${Math.round(phase.progress)}%`;
  }
  if (phase.status === 'active') return '处理中';
  if (phase.status === 'completed') return '已完成';
  if (phase.status === 'upcoming') return opts?.idleHint ?? '等待中';
  return null;
}

function lineFillRatio(prev: PhaseProgress, next: PhaseProgress): number {
  if (prev.status === 'failed' || next.status === 'failed') {
    return prev.status === 'completed' ? 1 : prev.status === 'active' ? 0.35 : 0;
  }
  if (prev.status === 'completed' && next.status === 'completed') return 1;
  if (prev.status === 'completed' && next.status === 'active') {
    if (next.progress < 0) return 0.55;
    return 0.35 + 0.65 * Math.min(1, Math.max(0, next.progress / 100));
  }
  if (prev.status === 'completed' && next.status !== 'upcoming') return 1;
  if (prev.status === 'active') {
    if (prev.progress < 0) return 0.4;
    return 0.15 + 0.35 * Math.min(1, Math.max(0, prev.progress / 100));
  }
  if (shouldLineBeActive(prev.status, next.status)) return 1;
  return 0;
}

const Shell: React.FC<{
  children: React.ReactNode;
  className?: string;
  tone?: 'default' | 'success' | 'idle' | 'danger';
}> = ({ children, className = '', tone = 'default' }) => {
  const bg =
    tone === 'success'
      ? GREEN_SOFT
      : tone === 'idle'
        ? `linear-gradient(180deg, ${BRAND_SOFT_WEAK} 0%, ${SHELL_BG} 100%)`
        : tone === 'danger'
          ? 'var(--apple-danger-soft)'
          : SHELL_BG;
  const ring =
    tone === 'success'
      ? '0 0 0 1px color-mix(in srgb, var(--apple-success) 18%, transparent)'
      : tone === 'idle'
        ? `0 0 0 1px ${BRAND_SOFT}`
        : tone === 'danger'
          ? '0 0 0 1px color-mix(in srgb, var(--apple-danger) 16%, transparent)'
          : '0 0 0 1px rgba(0,0,0,0.03)';

  return (
    <div
      className={`rounded-xl px-4 py-3 md:px-4 md:py-3.5 ${className}`}
      style={{ background: bg, boxShadow: ring }}
    >
      {children}
    </div>
  );
};

/** 全部完成：紧凑摘要，避免大步进重复占位 */
const CompletedSummary: React.FC<{
  phases: ProgressPhase[];
  phaseMap: Record<ProgressPhase, PhaseProgress>;
}> = ({ phases, phaseMap }) => {
  const totalEntries = phases.reduce((max, k) => {
    const n = phaseMap[k]?.totalEntries ?? phaseMap[k]?.entryCount ?? 0;
    return Math.max(max, n);
  }, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
    >
      <Shell tone="success" className="!py-2.5">
        <div className="flex items-center gap-3">
          <motion.div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'white', boxShadow: `0 0 0 1px rgba(16,185,129,0.2)` }}
            initial={{ scale: 0.7 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 18 }}
          >
            <Check className="w-4 h-4" style={{ color: 'var(--apple-success)' }} strokeWidth={2.8} />
          </motion.div>

          <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            {phases.map((key, i) => (
              <span key={key} className="inline-flex items-center gap-1 text-[12px] text-gray-700">
                {i > 0 && <span className="text-gray-300 mx-0.5">·</span>}
                <span
                  className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full"
                  style={{ background: 'color-mix(in srgb, var(--apple-success) 18%, transparent)' }}
                >
                  <Check className="w-2.5 h-2.5" style={{ color: 'var(--apple-success)' }} strokeWidth={3} />
                </span>
                <span className="font-medium">{PHASE_SHORT[key]}</span>
              </span>
            ))}
          </div>

          {totalEntries > 0 && (
            <span
              className="text-[11px] tabular-nums font-medium shrink-0"
              style={{ color: 'color-mix(in srgb, var(--apple-success) 80%, black)' }}
            >
              {totalEntries} 条
            </span>
          )}
        </div>
      </Shell>
    </motion.div>
  );
};

/** 统一状态行（1 步：未开始 / 进行中 / 失败；也可用作视觉语言基准） */
const StatusProgressRow: React.FC<{
  phaseKey: ProgressPhase;
  phase: PhaseProgress;
  onHoverChange: (v: boolean) => void;
}> = ({ phaseKey, phase, onHoverChange }) => {
  const [hovered, setHovered] = useState(false);
  const isActive = phase.status === 'active';
  const isCompleted = phase.status === 'completed';
  const isFailed = phase.status === 'failed';
  const isUpcoming = phase.status === 'upcoming';
  const indeterminate = isActive && phase.progress < 0;
  const pct =
    isActive && phase.progress >= 0
      ? Math.min(100, phase.progress)
      : isCompleted
        ? 100
        : 0;

  const meta = phaseMeta(phase, {
    idleHint: '点击下方开始',
  });

  const accent = isFailed ? RED : isCompleted ? GREEN : isActive ? BRAND : BRAND;
  const iconColor = isFailed ? RED : isCompleted ? GREEN : isActive ? BRAND : BRAND;

  const setHover = (v: boolean) => {
    setHovered(v);
    onHoverChange(v);
  };

  const shellTone = isFailed ? 'danger' : isUpcoming ? 'idle' : isCompleted ? 'success' : 'default';

  return (
    <div className="relative" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <Shell tone={shellTone}>
        <div className="flex items-center gap-3">
          <div
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{
              background: isUpcoming
                ? '#EFF6FF'
                : isFailed
                  ? '#FFF5F5'
                  : isCompleted
                    ? 'white'
                    : '#EFF6FF',
              boxShadow: isActive
                ? `0 0 0 3px ${BRAND}18`
                : isUpcoming
                  ? `0 0 0 1px ${BRAND_SOFT}`
                  : 'none',
            }}
          >
            {isCompleted ? (
              <motion.span
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 420, damping: 16 }}
              >
                <Check className="w-4 h-4" style={{ color: GREEN }} strokeWidth={2.8} />
              </motion.span>
            ) : isFailed ? (
              <X className="w-4 h-4" style={{ color: RED }} strokeWidth={2.8} />
            ) : isActive ? (
              /* 仅 spin，不做 scale 呼吸（会看起来像上下颠） */
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: BRAND }} strokeWidth={2.4} />
            ) : (
              <span className="relative" style={{ color: iconColor }}>
                {PHASE_ICONS[phaseKey] ?? <Sparkles className="w-3.5 h-3.5" />}
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="min-w-0">
                <span
                  className="text-[13px] font-semibold"
                  style={{ color: isFailed ? RED : GRAY_TEXT }}
                >
                  {PHASE_LABELS[phaseKey]}
                </span>
                {isUpcoming && (
                  <p className="text-[11px] mt-0.5" style={{ color: GRAY_MUTED }}>
                    准备就绪，开始后将显示进度
                  </p>
                )}
              </div>
              {meta && (
                <span
                  className="text-[11px] font-medium tabular-nums shrink-0"
                  style={{
                    color: isFailed ? RED : isActive ? BRAND : isUpcoming ? BRAND : GRAY_MUTED,
                  }}
                >
                  {meta}
                </span>
              )}
            </div>

            <div
              className="h-1.5 rounded-full overflow-hidden"
              style={{
                background: isUpcoming ? BRAND_SOFT_WEAK : GRAY_LINE,
              }}
            >
              {indeterminate ? (
                <motion.div
                  className="h-full w-1/3 rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${BRAND}88, ${BRAND})`,
                  }}
                  animate={{ x: ['-30%', '300%'] }}
                  transition={{ duration: 1.15, repeat: Infinity, ease: 'easeInOut' }}
                />
              ) : isUpcoming ? (
                // 未开始：极淡品牌色轨，避免整条死灰
                <div
                  className="h-full w-full rounded-full opacity-40"
                  style={{
                    background:
                      'repeating-linear-gradient(90deg, transparent, transparent 6px, var(--apple-blue-soft-strong) 6px, var(--apple-blue-soft-strong) 8px)',
                  }}
                />
              ) : (
                <motion.div
                  className="h-full rounded-full origin-left"
                  style={{
                    background: isFailed
                      ? RED
                      : isCompleted
                        ? `linear-gradient(90deg, color-mix(in srgb, ${GREEN} 70%, white), ${GREEN})`
                        : `linear-gradient(90deg, color-mix(in srgb, ${BRAND} 75%, white), ${BRAND})`,
                  }}
                  initial={false}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                />
              )}
            </div>
          </div>
        </div>
      </Shell>

      <div className="absolute left-1/2 -translate-x-1/2 top-full z-[100]">
        <PhaseTooltipCard
          phaseName={PHASE_LABELS[phaseKey]}
          progress={phase.progress > 0 && phase.progress < 100 ? phase.progress : undefined}
          tokens={phase.tokens > 0 ? phase.tokens : undefined}
          entryCount={phase.entryCount}
          totalEntries={phase.totalEntries}
          language={phase.language}
          errorMessage={phase.errorMessage}
          keytermGroupName={phase.keytermGroupName}
          isVisible={
            hovered &&
            Boolean(
              phase.errorMessage ||
                phase.tokens ||
                phase.language ||
                phase.keytermGroupName ||
                (phase.entryCount != null && phase.totalEntries != null)
            )
          }
        />
      </div>
    </div>
  );
};

const PhaseNode: React.FC<{
  phaseKey: ProgressPhase;
  phase: PhaseProgress;
  isHovered: boolean;
  onHover: (v: boolean) => void;
}> = ({ phaseKey, phase, isHovered, onHover }) => {
  const isActive = phase.status === 'active';
  const isCompleted = phase.status === 'completed';
  const isFailed = phase.status === 'failed';
  const isUpcoming = phase.status === 'upcoming';
  const meta = phaseMeta(phase);

  const border = isUpcoming ? GRAY_LINE : isFailed ? RED : BRAND;
  const bg = isCompleted ? BRAND : isFailed ? RED : 'white';
  const labelColor = isActive ? BRAND : isFailed ? RED : isCompleted ? GRAY_TEXT : GRAY_MUTED;

  return (
    <div className="relative flex flex-col items-center" style={{ minWidth: 68 }}>
      <motion.div
        className="relative flex h-7 w-7 items-center justify-center rounded-full"
        style={{
          background: bg,
          border: `2px solid ${border}`,
          boxShadow: isActive ? `0 0 0 4px ${BRAND}14` : 'none',
        }}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
      >
        <AnimatePresence mode="wait">
          {isCompleted && (
            <motion.span
              key="check"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 16 }}
            >
              <Check size={13} color="white" strokeWidth={3} />
            </motion.span>
          )}
          {isFailed && (
            <motion.span key="x" initial={{ scale: 0.5 }} animate={{ scale: 1 }}>
              <X size={13} color="white" strokeWidth={3} />
            </motion.span>
          )}
          {isActive && (
            <motion.span key="spin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex">
              {/* 仅旋转，不做上下/缩放呼吸，避免「颠簸」感 */}
              <Loader2 size={14} className="animate-spin" style={{ color: BRAND }} strokeWidth={2.5} />
            </motion.span>
          )}
          {isUpcoming && (
            <span key="idle" className="h-2 w-2 rounded-full" style={{ background: GRAY_LINE }} />
          )}
        </AnimatePresence>
      </motion.div>

      <PhaseTooltipCard
        phaseName={PHASE_LABELS[phaseKey]}
        progress={phase.progress > 0 && phase.progress < 100 ? phase.progress : undefined}
        tokens={phase.tokens > 0 ? phase.tokens : undefined}
        entryCount={phase.entryCount}
        totalEntries={phase.totalEntries}
        language={phase.language}
        errorMessage={phase.errorMessage}
        keytermGroupName={phase.keytermGroupName}
        isVisible={isHovered}
      />

      <div className="mt-2 flex flex-col items-center gap-0.5 min-h-[32px]">
        <span
          className="text-[12px] whitespace-nowrap transition-colors duration-300"
          style={{ color: labelColor, fontWeight: isActive ? 600 : 500 }}
        >
          {PHASE_LABELS[phaseKey]}
        </span>
        <AnimatePresence mode="wait">
          {meta && !isUpcoming && (
            <motion.span
              key={meta}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-[10px] tabular-nums"
              style={{ color: isFailed ? RED : isActive ? BRAND : GRAY_MUTED }}
            >
              {meta}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

/** 进行中的多阶段轨（未全部完成） */
const MultiPhaseRail: React.FC<{
  phases: ProgressPhase[];
  phaseMap: Record<ProgressPhase, PhaseProgress>;
  onTooltipVisibleChange?: (visible: boolean) => void;
}> = ({ phases, phaseMap, onTooltipVisibleChange }) => {
  const [hovered, setHovered] = useState<ProgressPhase | null>(null);
  const isCompact = phases.length === 2;

  const setHover = (p: ProgressPhase | null) => {
    setHovered(p);
    onTooltipVisibleChange?.(p !== null);
  };

  return (
    <Shell>
      <div
        className="flex items-start w-full mx-auto"
        style={{ maxWidth: isCompact ? 340 : '100%' }}
      >
        {phases.map((key, i) => {
          const phase = phaseMap[key];
          const isLast = i === phases.length - 1;
          const nextKey = phases[i + 1];
          const nextPhase = nextKey ? phaseMap[nextKey] : null;
          const fill = nextPhase ? lineFillRatio(phase, nextPhase) : 0;
          const lineFailed = phase.status === 'failed' || nextPhase?.status === 'failed';

          return (
            <div key={key} className="contents">
              <PhaseNode
                phaseKey={key}
                phase={phase}
                isHovered={hovered === key}
                onHover={(v) => setHover(v ? key : null)}
              />

              {!isLast && (
                <div
                  className="relative flex-1 self-start"
                  style={{ height: 28, minWidth: isCompact ? 56 : 28 }}
                >
                  <div
                    className="absolute left-1.5 right-1.5 top-1/2 -translate-y-1/2 h-[3px] overflow-hidden rounded-full"
                    style={{ background: GRAY_LINE }}
                  >
                    <motion.div
                      className="h-full origin-left rounded-full"
                      style={{
                        background: lineFailed
                          ? RED
                          : `linear-gradient(90deg, color-mix(in srgb, ${BRAND} 70%, white) 0%, ${BRAND} 100%)`,
                        boxShadow: fill > 0.2 ? `0 0 8px ${BRAND_SOFT}` : 'none',
                      }}
                      initial={false}
                      animate={{ scaleX: fill }}
                      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Shell>
  );
};

export const StepperProgress: React.FC<StepperProgressProps> = ({
  fileId,
  onTooltipVisibleChange,
}) => {
  const fileSnapshot = useFilesStore(
    useShallow((state) => {
      const task = state.tasks.find((t) => generateStableFileId(t.taskId) === fileId);
      if (!task) return undefined;
      return { phases: task.phases, fileType: task.fileType };
    })
  );

  const displayPhases = useMemo(() => {
    if (fileSnapshot?.fileType === 'srt') {
      return ALL_PHASES.filter((p) => p !== 'converting' && p !== 'transcribing');
    }
    return ALL_PHASES.filter((p) => p !== 'converting');
  }, [fileSnapshot?.fileType]);

  if (!fileSnapshot) return null;

  const { phases } = fileSnapshot;
  const allDone = displayPhases.every((p) => phases[p]?.status === 'completed');
  const anyFailed = displayPhases.some((p) => phases[p]?.status === 'failed');

  // 全部成功完成 → 摘要行（失败仍走详细 UI）
  if (allDone && !anyFailed) {
    return <CompletedSummary phases={displayPhases} phaseMap={phases} />;
  }

  if (displayPhases.length === 1) {
    const key = displayPhases[0];
    return (
      <StatusProgressRow
        phaseKey={key}
        phase={phases[key]}
        onHoverChange={(v) => onTooltipVisibleChange?.(v)}
      />
    );
  }

  return (
    <MultiPhaseRail
      phases={displayPhases}
      phaseMap={phases}
      onTooltipVisibleChange={onTooltipVisibleChange}
    />
  );
};
