import type { PlanV2 } from './types.js';

/** Valid ceiling heights in millimetres (roadmap A2). */
export const CEILING_MIN = 2000, CEILING_MAX = 6000;

/**
 * The ceiling height to draw with, in millimetres: the stored value clamped to the valid range.
 * The stored value is kept as it is; an out-of-range value is a tolerable issue (a warning), not an error.
 */
export const effectiveCeilingHeight = (plan: Pick<PlanV2, 'ceilingHeight'>): number =>
  Math.min(CEILING_MAX, Math.max(CEILING_MIN, plan.ceilingHeight));
