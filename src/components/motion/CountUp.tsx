import { useEffect } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { useReducedMotion } from 'framer-motion';
import { countDuration, MOTION_EASE } from '@/motion';

interface CountUpProps {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}

/**
 * 数字滚动动画：从 0 平滑增长到目标值。
 * 尊重 prefers-reduced-motion，禁用时直接显示目标值。
 */
export const CountUp: React.FC<CountUpProps> = ({
  value,
  duration,
  format = (n) => Math.round(n).toLocaleString(),
  className,
}) => {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const display = useTransform(mv, format);

  useEffect(() => {
    const d = countDuration(reduce, duration);
    if (d <= 0) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: d, ease: MOTION_EASE.soft });
    return () => controls.stop();
  }, [value, duration, reduce, mv]);

  return <motion.span className={className}>{display}</motion.span>;
};
