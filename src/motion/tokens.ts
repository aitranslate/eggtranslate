/**
 * Workbench motion tokens — single source of truth for timing & easing.
 *
 * Design intent (tool UI, not marketing):
 * - micro: hover-adjacent / mask fade
 * - base: stage switch, light fades
 * - drawer: edge sheet enter/exit
 * - expand: accordion / collapse
 * - progress: determinate bar fill
 *
 * CSS mirror: --wb-motion-* on :root (workbench.css). Prefer these constants
 * in framer-motion; use CSS vars for pure CSS transitions.
 */

/** Seconds (framer-motion uses seconds) */
export const MOTION_DURATION = {
  instant: 0,
  /** Mask, alert backdrop, micro UI */
  micro: 0.12,
  /** Stage switch, list fade, menu item */
  base: 0.15,
  /** Settings / Agent edge drawers */
  drawer: 0.22,
  /** Accordion height */
  expand: 0.2,
  /** Determinate progress width */
  progress: 0.5,
  /** Indeterminate sweep loop */
  sweep: 1.15,
  /** History CountUp default */
  count: 0.7,
} as const;

/** Cubic-bezier tuples for framer-motion */
export const MOTION_EASE = {
  /** Standard decelerate (Material-ish out) */
  out: [0.4, 0, 0.2, 1] as const,
  /** Soft settle (progress / expand) */
  soft: [0.16, 1, 0.3, 1] as const,
} as const;

/**
 * Soft spring for floating surfaces (dialogs, menus, tooltips, modals).
 * One spring only — no mixed stiffness across the app.
 */
export const MOTION_SPRING_SOFT = {
  type: 'spring' as const,
  stiffness: 380,
  damping: 28,
};

/** Stagger between sequential menu items (seconds) */
export const MOTION_STAGGER = 0.03;
