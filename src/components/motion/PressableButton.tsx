import { motion, useReducedMotion } from 'framer-motion';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface PressableButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode;
  /** 启用 hover scale（默认 1.02） */
  hoverScale?: number;
  /** 按下时 scale（默认 0.97） */
  pressScale?: number;
}

/**
 * 通用按钮：自带 hover 上浮 + 按下回弹的"触感"。
 * 已在 apple-style.css 中处理 prefers-reduced-motion。
 */
export const PressableButton: React.FC<PressableButtonProps> = ({
  children,
  hoverScale = 1.02,
  pressScale = 0.97,
  className,
  disabled,
  ...rest
}) => {
  const reduce = useReducedMotion();
  return (
    <motion.button
      whileHover={disabled || reduce ? undefined : { scale: hoverScale }}
      whileTap={disabled || reduce ? undefined : { scale: pressScale }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      className={className}
      disabled={disabled}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </motion.button>
  );
};
