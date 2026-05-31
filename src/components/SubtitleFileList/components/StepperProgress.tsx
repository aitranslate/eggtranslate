import { motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { useMemo } from 'react';
import { useSubtitleStore, useFile } from '@/stores/subtitleStore';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { shouldLineBeActive } from '@/utils/badgeHelper';
import type { ProgressPhase, PhaseProgress, FilePhases } from '@/types';

interface StepperProgressProps {
  fileId: string;
}

const CIRCLE_SIZE = 24;
const RING_RADIUS = 10;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const BRAND_BLUE = '#0066FF';

const PHASE_LABELS_CN: Record<ProgressPhase, string> = {
  converting: '视频转码',
  transcribing: 'AI 转录',
  translating: '字幕翻译',
  splitting: '断句对齐',
};

const ALL_PHASES: ProgressPhase[] = ['converting', 'transcribing', 'translating', 'splitting'];

const Spinner: React.FC = () => (
  <div
    style={{
      width: 14, height: 14,
      border: '2px solid rgba(0,102,255,0.2)',
      borderTopColor: BRAND_BLUE,
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
    }}
  />
);

const RingProgress: React.FC<{ progress: number }> = ({ progress }) => {
  const offset = RING_CIRCUMFERENCE - (progress / 100) * RING_CIRCUMFERENCE;
  return (
    <svg
      style={{ position: 'absolute', inset: -2, width: CIRCLE_SIZE, height: CIRCLE_SIZE }}
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r={RING_RADIUS} fill="none" stroke="transparent" strokeWidth="2" />
      <motion.circle
        cx="12" cy="12" r={RING_RADIUS}
        fill="none" stroke={BRAND_BLUE} strokeWidth="2" strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        initial={{ strokeDashoffset: RING_CIRCUMFERENCE }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
};

/** 计算百分比（progress 字段本身即为 0-100 的百分比，-1 表示不确定进度） */
const getPercentage = (phase: PhaseProgress): number => {
  return phase.progress;
};

/** Connecting line between two phase nodes */
const ConnectingLine: React.FC<{
  prevStatus: string;
  nextStatus: string;
}> = ({ prevStatus, nextStatus }) => {
  const isActive = shouldLineBeActive(prevStatus, nextStatus);
  const isCompleted = prevStatus === 'completed' && nextStatus === 'completed';

  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        height: CIRCLE_SIZE,
        margin: '0 8px',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: CIRCLE_SIZE / 2,
          height: 2,
          background: '#E5E5EA',
          borderRadius: 1,
          transform: 'translateY(-50%)',
          overflow: 'hidden',
        }}
      >
        <motion.div
          style={{
            height: '100%',
            borderRadius: 1,
            backgroundColor: BRAND_BLUE,
          }}
          initial={{ width: '0%' }}
          animate={{
            width: isActive ? '100%' : '0%',
          }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
};

export const StepperProgress: React.FC<StepperProgressProps> = ({ fileId }) => {
  const file = useFile(fileId);
  const aiSegmentationEnabled = useTranscriptionStore(state => state.aiSegmentationEnabled);

  // 决定显示哪些阶段节点（根据文件类型过滤）
  const displayPhases = useMemo(() => {
    if (file?.fileType === 'srt') {
      return ALL_PHASES.filter(p => p !== 'converting' && p !== 'transcribing');
    }
    return ALL_PHASES;
  }, [file?.fileType]);

  // 根据 aiSegmentationEnabled 过滤 splitting
  const visiblePhases = useMemo(() => {
    if (!aiSegmentationEnabled) {
      return displayPhases.filter(p => p !== 'splitting');
    }
    return displayPhases;
  }, [displayPhases, aiSegmentationEnabled]);

  if (!file) return null;

  const { phases } = file;

  return (
    <div
      style={{
        background: '#FAFAFC',
        borderRadius: 12,
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: 84,
      }}
    >
      <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>

      <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%' }}>
        {displayPhases.map((phase, i) => {
          const phaseState = phases[phase];
          const isActive = phaseState.status === 'active';
          const isCompleted = phaseState.status === 'completed';
          const isFailed = phaseState.status === 'failed';
          const isUpcoming = phaseState.status === 'upcoming';
          const isLast = i === displayPhases.length - 1;

          // 计算百分比
          const percentage = getPercentage(phaseState);

          // 不确定进度（progress === -1 表示转码/转录等无法确定进度的阶段）
          const isIndeterminate = phaseState.progress === -1;

          let labelText = PHASE_LABELS_CN[phase];
          // 翻译/断句有实际进度时显示百分比文字
          if (isActive && !isIndeterminate) {
            labelText += ` ${percentage}%`;
          } else if (isFailed) {
            labelText += ' 失败';
          }

          const nodeBg = isCompleted ? BRAND_BLUE : isFailed ? '#FF3B30' : 'white';
          const nodeBorder = isUpcoming ? '#E5E5EA' : isFailed ? '#FF3B30' : BRAND_BLUE;
          const labelColor = isActive ? BRAND_BLUE : isFailed ? '#FF3B30' : isCompleted ? '#1D1D1F' : '#86868B';

          return (
            <div key={phase} style={{ display: 'contents' }}>
              {/* Node column */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  minWidth: CIRCLE_SIZE,
                }}
              >
                <motion.div
                  style={{
                    width: CIRCLE_SIZE,
                    height: CIRCLE_SIZE,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    background: nodeBg,
                    border: `2px solid ${nodeBorder}`,
                    transition: 'all 0.4s ease',
                  }}
                  animate={
                    isActive
                      ? { boxShadow: ['0 0 0 0 rgba(0,102,255,0.2)', '0 0 0 6px rgba(0,102,255,0)'] }
                      : { boxShadow: '0 0 0 0 transparent' }
                  }
                  transition={
                    isActive
                      ? { duration: 2, repeat: Infinity, ease: 'easeOut' }
                      : { duration: 0.3 }
                  }
                >
                  {isCompleted && (
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                    >
                      <Check size={12} style={{ color: 'white' }} strokeWidth={3} />
                    </motion.div>
                  )}
                  {isFailed && (
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                    >
                      <X size={12} style={{ color: 'white' }} strokeWidth={3} />
                    </motion.div>
                  )}
                  {/* 不确定进度和确定进度都显示 Spinner */}
                  {isActive && <Spinner />}
                </motion.div>

                <span
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                    minHeight: 16,
                    color: labelColor,
                    fontWeight: isActive ? 600 : 400,
                    transition: 'all 0.3s ease',
                  }}
                >
                  {labelText}
                </span>
              </div>

              {/* Connecting line (between nodes) */}
              {!isLast && (
                <ConnectingLine
                  prevStatus={phaseState.status}
                  nextStatus={displayPhases[i + 1] ? phases[displayPhases[i + 1]].status : 'upcoming'}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
