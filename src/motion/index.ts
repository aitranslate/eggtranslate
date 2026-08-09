/**
 * App motion system — import from `@/motion`.
 */

export {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_SPRING_SOFT,
  MOTION_STAGGER,
} from './tokens';

export {
  type ReduceMotion,
  backdropFade,
  backdropTransition,
  overlayPanelMotion,
  overlayPanelTransition,
  popoverMotion,
  tooltipMotion,
  drawerTransition,
  edgeDrawerMotion,
  stageMotion,
  collapseMotion,
  collapseTransition,
  progressWidthTransition,
  indeterminateBarMotion,
  staggerItemMotion,
  countDuration,
} from './presets';
