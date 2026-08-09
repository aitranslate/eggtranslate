/**
 * Ready-to-spread motion props for framer-motion.
 * All paths take `reduce` from useReducedMotion() — no silent infinite loops.
 */

import type { Transition } from 'framer-motion';
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_SPRING_SOFT,
  MOTION_STAGGER,
} from './tokens';

export type ReduceMotion = boolean | null;

function isReduce(reduce: ReduceMotion): boolean {
  return Boolean(reduce);
}

// ── Backdrop (masks) ──────────────────────────────────────────

export function backdropTransition(reduce: ReduceMotion): Transition {
  return { duration: isReduce(reduce) ? 0 : MOTION_DURATION.micro };
}

export function backdropFade(reduce: ReduceMotion) {
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: backdropTransition(reduce),
  } as const;
}

// ── Overlay panels (dialog / menu / tooltip / modal content) ──
// Unified soft spring; reduced-motion → opacity only / instant.

const OVERLAY_ENTER = { opacity: 0, scale: 0.98, y: 6 } as const;
const OVERLAY_CENTER = { opacity: 1, scale: 1, y: 0 } as const;
const OVERLAY_EXIT = { opacity: 0, scale: 0.98, y: 4 } as const;

export function overlayPanelTransition(reduce: ReduceMotion): Transition {
  if (isReduce(reduce)) return { duration: 0 };
  return MOTION_SPRING_SOFT;
}

/** Centered dialog / alert / modal body */
export function overlayPanelMotion(reduce: ReduceMotion) {
  if (isReduce(reduce)) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0 } as Transition,
    };
  }
  return {
    initial: { ...OVERLAY_ENTER },
    animate: { ...OVERLAY_CENTER },
    exit: { ...OVERLAY_EXIT },
    transition: MOTION_SPRING_SOFT as Transition,
  };
}

/** Popover / dropdown anchored top-right (export menu) */
export function popoverMotion(reduce: ReduceMotion) {
  if (isReduce(reduce)) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0 } as Transition,
    };
  }
  return {
    initial: { opacity: 0, scale: 0.98, y: -4 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.98, y: -4 },
    transition: MOTION_SPRING_SOFT as Transition,
  };
}

/** Tooltip below anchor */
export function tooltipMotion(reduce: ReduceMotion) {
  if (isReduce(reduce)) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0 } as Transition,
    };
  }
  return {
    initial: { opacity: 0, y: 6, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: 4, scale: 0.98 },
    transition: MOTION_SPRING_SOFT as Transition,
  };
}

// ── Drawers (edge sheets) ─────────────────────────────────────

export function drawerTransition(reduce: ReduceMotion): Transition {
  return {
    type: 'tween',
    duration: isReduce(reduce) ? 0 : MOTION_DURATION.drawer,
    ease: MOTION_EASE.out,
  };
}

/** Desktop right sheet or mobile bottom sheet */
export function edgeDrawerMotion(
  reduce: ReduceMotion,
  axis: 'x' | 'y'
) {
  const off = axis === 'x' ? { x: '100%' } : { y: '100%' };
  const on = axis === 'x' ? { x: 0 } : { y: 0 };
  const t = drawerTransition(reduce);
  if (isReduce(reduce)) {
    return {
      initial: false as const,
      animate: on,
      exit: on,
      transition: t,
    };
  }
  return {
    initial: off,
    animate: on,
    exit: off,
    transition: t,
  };
}

// ── Stage (workspace / terms / history) ───────────────────────

export function stageMotion(reduce: ReduceMotion) {
  if (isReduce(reduce)) {
    return {
      initial: false as const,
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 1, y: 0 },
      transition: { duration: 0 } as Transition,
    };
  }
  return {
    initial: { opacity: 0, y: 5 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
    transition: {
      duration: MOTION_DURATION.base,
      ease: MOTION_EASE.out,
    } as Transition,
  };
}

// ── Collapse / accordion ──────────────────────────────────────

export function collapseTransition(reduce: ReduceMotion): Transition {
  return {
    duration: isReduce(reduce) ? 0 : MOTION_DURATION.expand,
    ease: MOTION_EASE.soft,
  };
}

export function collapseMotion(reduce: ReduceMotion) {
  const t = collapseTransition(reduce);
  if (isReduce(reduce)) {
    return {
      initial: false as const,
      animate: { height: 'auto', opacity: 1 },
      exit: { height: 0, opacity: 0 },
      transition: t,
    };
  }
  return {
    initial: { height: 0, opacity: 0 },
    animate: { height: 'auto', opacity: 1 },
    exit: { height: 0, opacity: 0 },
    transition: t,
  };
}

// ── Progress ──────────────────────────────────────────────────

export function progressWidthTransition(reduce: ReduceMotion): Transition {
  return {
    duration: isReduce(reduce) ? 0 : MOTION_DURATION.progress,
    ease: MOTION_EASE.soft,
  };
}

/**
 * Indeterminate bar sweep. When reduced-motion: static mid fill (no loop).
 */
export function indeterminateBarMotion(reduce: ReduceMotion) {
  if (isReduce(reduce)) {
    return {
      animate: { x: '100%' as const },
      transition: { duration: 0 } as Transition,
    };
  }
  return {
    animate: { x: ['-30%', '300%'] as string[] },
    transition: {
      duration: MOTION_DURATION.sweep,
      repeat: Infinity,
      ease: 'easeInOut' as const,
    } as Transition,
  };
}

// ── Stagger list items ────────────────────────────────────────

export function staggerItemMotion(index: number, reduce: ReduceMotion) {
  if (isReduce(reduce)) {
    return {
      initial: false as const,
      animate: { opacity: 1, x: 0 },
      transition: { duration: 0 } as Transition,
    };
  }
  return {
    initial: { opacity: 0, x: -4 },
    animate: { opacity: 1, x: 0 },
    transition: {
      delay: index * MOTION_STAGGER,
      duration: MOTION_DURATION.base,
      ease: MOTION_EASE.out,
    } as Transition,
  };
}

// ── Count / number ────────────────────────────────────────────

export function countDuration(reduce: ReduceMotion, override?: number): number {
  if (isReduce(reduce)) return 0;
  return override ?? MOTION_DURATION.count;
}
