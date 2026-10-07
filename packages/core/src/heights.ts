import type { OpeningV2, PlanV2 } from './types.js';

/** Valid ceiling heights in millimetres (roadmap A2). */
export const CEILING_MIN = 2000, CEILING_MAX = 6000;
/** Lowest valid head of a door, sliding door or hole, in millimetres (roadmap A2). */
export const HEAD_MIN = 1800;

/**
 * The ceiling height to draw with, in millimetres: the stored value clamped to the valid range.
 * The stored value is kept as it is; an out-of-range value is a tolerable issue (a warning), not an error.
 */
export const effectiveCeilingHeight = (plan: Pick<PlanV2, 'ceilingHeight'>): number =>
  Math.min(CEILING_MAX, Math.max(CEILING_MIN, plan.ceilingHeight));

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The opening heights to draw with, in millimetres, for a ceiling of `ceiling` mm (use the effective ceiling).
 * Out-of-range stored values are tolerable issues: they are kept, and drawn clamped to the A2 ranges.
 * A window gets 0 ≤ sill ≤ head ≤ ceiling; other openings get HEAD_MIN ≤ head ≤ ceiling.
 */
export function effectiveOpeningHeights(opening: OpeningV2, ceiling: number): { sill: number; head: number } {
  if (opening.type === 'window') {
    const sill = clamp(opening.sill, 0, ceiling);
    return { sill, head: clamp(opening.head, sill, ceiling) };
  }
  return { sill: 0, head: clamp(opening.head, Math.min(HEAD_MIN, ceiling), ceiling) };
}
