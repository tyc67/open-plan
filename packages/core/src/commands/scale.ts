import type { DimensionChain, OpeningV2, PlanV2, Point, WallV2 } from '../types.js';
import { validatePlan } from '../validate.js';
import type { PlanCommand } from './types.js';
import { readFields, refuse, type Step } from './support.js';

/** Results are rounded to 0.1 mm (roadmap D3). */
const round = (v: number) => Math.round(v * 10) / 10 + 0;

/**
 * The plan scaled by `f` about `pivot`. Only the D3 fields scale. Openings are placed from the scaled plan points of
 * their two edges, rounded like the wall ends, so an opening that ended at its wall end, or touched the next opening,
 * still does after the rounding (offset and width rounded alone could each move by 0.1 mm).
 */
export function scalePlan(plan: PlanV2, f: number, pivot: Point): PlanV2 {
  const sx = (x: number) => round(pivot[0] + f * (x - pivot[0])), sy = (y: number) => round(pivot[1] + f * (y - pivot[1]));
  const sp = ([x, y]: Point): Point => [sx(x), sy(y)];
  const walls = new Map<string, WallV2>(), scaledWalls = plan.walls.map(w => {
    const next = { ...w, a: sp(w.a), b: sp(w.b), thickness: round(w.thickness * f) };
    walls.set(w.id, next);
    return next;
  });
  const openings = plan.openings.map((o): OpeningV2 => {
    const wall = plan.walls.find(w => w.id === o.wallId)!, next = walls.get(o.wallId)!;
    const k = wall.a[1] === wall.b[1] ? 0 : 1, dir = Math.sign(wall.b[k] - wall.a[k]), scale = k === 0 ? sx : sy;
    // Distance from the scaled `a` end to the scaled plan point of an edge.
    const edge = (s: number) => Math.abs(scale(wall.a[k] + dir * s) - next.a[k]);
    const start = edge(o.offset), end = edge(o.offset + o.width);
    return { ...o, offset: round(start), width: round(end - start) };
  });
  const dimension = (d: DimensionChain): DimensionChain => ({
    ...d, at: d.horizontal ? sy(d.at) : sx(d.at), start: d.horizontal ? sx(d.start) : sy(d.start), segments: d.segments.map(s => round(s * f)),
  });
  return {
    ...plan, walls: scaledWalls, openings,
    rooms: plan.rooms.map(r => ({ ...r, poly: r.poly.map(sp), ...(r.at ? { at: sp(r.at) } : {}) })),
    // Furniture keeps its real size and rotation; only its position scales.
    furniture: plan.furniture.map(i => ({ ...i, cx: sx(i.cx), cy: sy(i.cy) })),
    ...(plan.measurements ? { measurements: plan.measurements.map(m => ({ ...m, a: { x: sx(m.a.x), y: sy(m.a.y) }, b: { x: sx(m.b.x), y: sy(m.b.y) } })) } : {}),
    ...(plan.dimensions ? { dimensions: plan.dimensions.map(dimension) } : {}),
  };
}

function scale(plan: PlanV2, c: Extract<PlanCommand, { op: 'scale_plan' }>): Step {
  let factor: number, pivot: Point;
  if (Object.hasOwn(c, 'factor')) {
    readFields(c, { required: { factor: 'number', pivot: 'point' } });
    const given = c as { factor: number; pivot: Point };
    if (!(given.factor > 0)) refuse('factor', 'size-not-positive', { value: given.factor });
    [factor, pivot] = [given.factor, given.pivot];
  } else {
    readFields(c, { required: { a: 'point', b: 'point', distance: 'number' } });
    const given = c as { a: Point; b: Point; distance: number }, measured = Math.hypot(given.b[0] - given.a[0], given.b[1] - given.a[1]);
    if (measured === 0) refuse('b', 'scale-points-same');
    if (!(given.distance > 0)) refuse('distance', 'size-not-positive', { value: given.distance });
    [factor, pivot] = [given.distance / measured, given.a];
  }
  const next = scalePlan(plan, factor, pivot);
  // D3: the scaling is refused with no change if the result has errors. A plan larger than the size limit counts as an
  // error here, although the validator only warns about it in a saved plan.
  const result = validatePlan(next, 'saved');
  const issues = [...result.errors, ...result.warnings.filter(w => w.code === 'plan-too-large')];
  if (issues.length) refuse(null, 'scale-result-invalid', { factor, issues: issues.slice(0, 20), count: issues.length });
  return { plan: next, notes: [{ code: 'plan-scaled', params: { factor, pivot } }] };
}

export const SCALE_COMMANDS = { scale_plan: scale } as const;
