import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

interface StaggerProps {
  children: ReactNode;
  className?: string;
  /** 每个子项延迟（秒） */
  stagger?: number;
  /** 容器内子项初始延迟 */
  initialDelay?: number;
}

/**
 * 容器：子项按 stagger 节奏依次入场。
 * 子项必须是 motion 元素（用 itemVariants 或自定义）。
 */
const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.1 },
  },
};

const reducedContainerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0, delayChildren: 0 } },
};

export const Stagger: React.FC<StaggerProps> = ({
  children,
  className,
  stagger,
  initialDelay,
}) => {
  const reduce = useReducedMotion();
  const variants = reduce
    ? reducedContainerVariants
    : {
        ...containerVariants,
        show: {
          opacity: 1,
          transition: {
            staggerChildren: stagger ?? 0.06,
            delayChildren: initialDelay ?? 0.1,
          },
        },
      };
  return (
    <motion.div className={className} initial="hidden" animate="show" variants={variants}>
      {children}
    </motion.div>
  );
};
