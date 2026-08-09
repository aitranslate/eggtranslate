import { describe, it, expect } from 'vitest';
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_SPRING_SOFT,
  backdropFade,
  overlayPanelMotion,
  popoverMotion,
  tooltipMotion,
  edgeDrawerMotion,
  stageMotion,
  collapseMotion,
  progressWidthTransition,
  indeterminateBarMotion,
  staggerItemMotion,
  countDuration,
} from '@/motion';

describe('motion tokens', () => {
  it('exports stable duration hierarchy', () => {
    expect(MOTION_DURATION.micro).toBeLessThan(MOTION_DURATION.base);
    expect(MOTION_DURATION.base).toBeLessThan(MOTION_DURATION.drawer);
    expect(MOTION_DURATION.progress).toBeGreaterThan(MOTION_DURATION.base);
    expect(MOTION_EASE.out).toHaveLength(4);
    expect(MOTION_SPRING_SOFT.type).toBe('spring');
  });
});

describe('motion presets respect reduced-motion', () => {
  it('backdrop is instant when reduced', () => {
    const m = backdropFade(true);
    expect(m.transition.duration).toBe(0);
  });

  it('overlay panel drops scale when reduced', () => {
    const full = overlayPanelMotion(false);
    const red = overlayPanelMotion(true);
    expect(full.initial).toMatchObject({ scale: 0.98 });
    expect(red.initial).toEqual({ opacity: 0 });
    expect(red.transition).toEqual({ duration: 0 });
  });

  it('popover / tooltip share soft spring when motion on', () => {
    const p = popoverMotion(false);
    const t = tooltipMotion(false);
    expect(p.transition).toMatchObject({ type: 'spring', stiffness: 380 });
    expect(t.transition).toMatchObject({ type: 'spring', stiffness: 380 });
  });

  it('drawer uses tween duration from tokens', () => {
    const d = edgeDrawerMotion(false, 'x');
    expect(d.transition).toMatchObject({
      type: 'tween',
      duration: MOTION_DURATION.drawer,
    });
    expect(d.initial).toEqual({ x: '100%' });
    const red = edgeDrawerMotion(true, 'y');
    expect(red.transition.duration).toBe(0);
  });

  it('stage motion zeros when reduced', () => {
    const s = stageMotion(true);
    expect(s.transition.duration).toBe(0);
    const full = stageMotion(false);
    expect(full.transition.duration).toBe(MOTION_DURATION.base);
  });

  it('collapse and progress stop when reduced', () => {
    expect(collapseMotion(true).transition.duration).toBe(0);
    expect(progressWidthTransition(true).duration).toBe(0);
    expect(progressWidthTransition(false).duration).toBe(MOTION_DURATION.progress);
  });

  it('indeterminate bar does not loop when reduced', () => {
    const red = indeterminateBarMotion(true);
    expect(red.transition.duration).toBe(0);
    expect(red.transition).not.toHaveProperty('repeat');
    const full = indeterminateBarMotion(false);
    expect(full.transition).toMatchObject({ repeat: Infinity });
  });

  it('stagger items have no delay when reduced', () => {
    const red = staggerItemMotion(3, true);
    expect(red.transition.duration).toBe(0);
    const full = staggerItemMotion(2, false);
    expect(full.transition.delay).toBeCloseTo(0.06);
  });

  it('countDuration', () => {
    expect(countDuration(true)).toBe(0);
    expect(countDuration(false)).toBe(MOTION_DURATION.count);
    expect(countDuration(false, 1.2)).toBe(1.2);
  });
});
