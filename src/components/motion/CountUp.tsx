import { useEffect } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { useReducedMotion } from 'framer-motion';

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
  duration = 1.2,
  format = (n) => Math.round(n).toLocaleString(),
  className,
}) => {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const display = useTransform(mv, format);

  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [value, duration, reduce, mv]);

  return <motion.span className={className}>{display}</motion.span>;
};
