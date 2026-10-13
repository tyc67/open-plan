import { wallRect } from './geometry.js';
import type { PlanV2, Point, Rect } from './types.js';

/** Default area when a plan has no content: 10 × 8 m with its centre at (0, 0). */
export const EMPTY_PLAN_AREA: Rect = [-5000, -4000, 5000, 4000];

// The shared fields are typed loosely in PlanCommon; these are the parts that bounds read.
interface FurnitureBox { cx: number; cy: number; w: number; d: number; rot: number }
interface DimensionChain { horizontal: boolean; at: number; start: number; segments: number[] }
interface Measurement { a: { x: number; y: number }; b: { x: number; y: number } }

class Extent {
  x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity;
  add(x: number, y: number) { this.x0 = Math.min(this.x0, x); this.y0 = Math.min(this.y0, y); this.x1 = Math.max(this.x1, x); this.y1 = Math.max(this.y1, y); }
  addRect(r: Rect) { this.add(r[0], r[1]); this.add(r[2], r[3]); }
  rect(): Rect | null { return this.x0 <= this.x1 ? [this.x0, this.y0, this.x1, this.y1] : null; }
}

/** Axis-parallel box around a rotated furniture item, the same rule as wall snapping. */
export function furnitureRect(f: FurnitureBox): Rect {
  const angle = f.rot * Math.PI / 180, c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
  const hw = (f.w * c + f.d * s) / 2, hh = (f.w * s + f.d * c) / 2;
  return [f.cx - hw, f.cy - hh, f.cx + hw, f.cy + hh];
}

function addPhysical(plan: PlanV2, e: Extent) {
  for (const w of plan.walls) e.addRect(wallRect(w));
  for (const r of plan.rooms as { poly: Point[] }[]) for (const [x, y] of r.poly) e.add(x, y);
  for (const f of plan.furniture as FurnitureBox[]) e.addRect(furnitureRect(f));
}

/** Walls, rooms and furniture: what the 3D view draws. Openings lie inside their walls. Null for an empty plan. */
export function physicalBounds(plan: PlanV2): Rect | null {
  const e = new Extent();
  addPhysical(plan, e);
  return e.rect();
}

/** All content, including measurements and dimension chains: what the 2D view must show. Null for an empty plan. */
export function contentBounds(plan: PlanV2): Rect | null {
  const e = new Extent();
  addPhysical(plan, e);
  // An annotation that the validator reports does not set the view (see `annotationReport`).
  // A report with no index is about all annotations of a plan with no physical content: then no annotation sets the view.
  const reports = annotationReport(plan), reported = new Set(reports.map(r => r.index === null ? r.list : `${r.list}[${r.index}]`));
  (plan.measurements ?? []).forEach((m, i) => { if (!reported.has('measurements') && !reported.has(`measurements[${i}]`)) for (const [x, y] of measurementPoints(m as Measurement)) e.add(x, y); });
  (plan.dimensions ?? []).forEach((c, i) => { if (!reported.has('dimensions') && !reported.has(`dimensions[${i}]`)) for (const [x, y] of chainPoints(c as DimensionChain)) e.add(x, y); });
  if (usable(e.rect())) return e.rect();
  // A box that is not finite cannot be a view: annotations very far from each other in a plan with no physical content,
  // or physical content with such values. Then the physical content alone is used, or nothing (the default area).
  const physical = physicalBounds(plan);
  return usable(physical) ? physical : null;
}
/** A box, or no box, that a view can use: its corners and its size are finite. */
const usable = (r: Rect | null) => !r || (r.every(Number.isFinite) && Number.isFinite(r[2] - r[0]) && Number.isFinite(r[3] - r[1]));

// ---- Annotations (measurements and dimension chains) far from the plan ----

/**
 * How far an annotation can be from the physical content (walls, rooms, furniture), in mm. Outside `near` (or the
 * longer side of the physical box, if that is more), an annotation is reported as a warning: it is possibly a unit
 * error. Outside `far`, or with a value that is not finite, a strict check refuses it. With no physical content there
 * is nothing to measure from: then the box around all annotations must be within `far` on each side.
 */
export const ANNOTATION_LIMITS = { near: 20_000, far: 100_000 } as const;

const measurementPoints = (m: Measurement): Point[] => [[m.a.x, m.a.y], [m.b.x, m.b.y]];
/** The start of a chain and the end of each segment. A file can have a negative length, so the last end is not always the farthest. */
function chainPoints(c: DimensionChain): Point[] {
  let pos = c.start;
  const along = [pos, ...c.segments.map(s => (pos += s))];
  return along.map((v): Point => c.horizontal ? [v, c.at] : [c.at, v]);
}
/**
 * The largest value of a coordinate or a length that a drawing uses, in mm. A drawing adds, halves and multiplies
 * its values (a centre, a rounding to 0.1 mm), and a value near the largest number gives a result that is not finite.
 * Above this value a number also cannot hold 1 mm exactly. This is the one limit for the distance from 0: a plan that
 * is moved as a whole stays valid at any smaller distance, and 1e15 mm is 1,000 million km.
 */
export const DRAWABLE_MAX = 1e15;
/** An annotation can be drawn if each coordinate and each length is finite and not above `DRAWABLE_MAX`. */
function drawable(points: Point[], lengths: number[]): boolean {
  const fits = (v: number) => Math.abs(v) <= DRAWABLE_MAX;   // false for NaN and for a value that is not finite
  for (const p of points) if (!fits(p[0]) || !fits(p[1])) return false;
  for (const v of lengths) if (!fits(v)) return false;
  return true;
}
const measurementDrawable = (m: Measurement) => drawable(measurementPoints(m), [Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y)]);
const chainDrawable = (c: DimensionChain) => drawable(chainPoints(c), c.segments);

/**
 * One reported annotation. `index` is null for the report about all annotations of a plan with no physical content.
 * `level` near: a warning for every source. far: an error of a strict check. `distance` is how far outside the
 * physical box the farthest point is (mm); for the report about all annotations, how much the longer side of their box
 * is above the limit; null if the annotation cannot be drawn.
 */
export interface AnnotationReport { list: 'measurements' | 'dimensions'; index: number | null; level: 'near' | 'far'; drawable: boolean; distance: number | null; limit: number }

/**
 * The annotations that are too far from the plan. The validator makes its issues from this list and the 2D view
 * leaves the same items out of "Fit", so the two cannot disagree. The plan must have valid fields.
 * A physical box that is itself not finite gives no report: that is a separate, known gap.
 */
export function annotationReport(plan: Pick<PlanV2, 'walls' | 'rooms' | 'furniture' | 'measurements' | 'dimensions'>): AnnotationReport[] {
  const items: { list: AnnotationReport['list']; index: number; points: Point[]; drawable: boolean }[] = [
    ...((plan.measurements ?? []) as Measurement[]).map((m, index) => ({ list: 'measurements' as const, index, points: measurementPoints(m), drawable: measurementDrawable(m) })),
    ...((plan.dimensions ?? []) as DimensionChain[]).map((c, index) => ({ list: 'dimensions' as const, index, points: chainPoints(c), drawable: chainDrawable(c) })),
  ];
  if (!items.length) return [];
  const physical = new Extent();
  addPhysical(plan as PlanV2, physical);
  const box = physical.rect(), out: AnnotationReport[] = [];
  const { near, far } = ANNOTATION_LIMITS;
  for (const item of items) if (!item.drawable) out.push({ list: item.list, index: item.index, level: 'far', drawable: false, distance: null, limit: far });
  const finite = items.filter(item => item.drawable);
  if (!box) {
    // No physical content: one report for each list that has an annotation, if the box around all of them is too large.
    const all = new Extent();
    for (const item of finite) for (const [x, y] of item.points) all.add(x, y);
    const over = Math.max(all.x1 - all.x0, all.y1 - all.y0) - far;
    if (finite.length && over > 0)
      for (const list of ['measurements', 'dimensions'] as const) if (finite.some(item => item.list === list)) out.push({ list, index: null, level: 'far', drawable: true, distance: over, limit: far });
    return out;
  }
  const side = Math.max(box[2] - box[0], box[3] - box[1]);
  if (!Number.isFinite(side)) return out;
  const nearLimit = Math.max(near, side);
  for (const item of finite) {
    let distance = 0;                                           // a loop: a chain can have more points than a call can have arguments
    for (const [x, y] of item.points) distance = Math.max(distance, box[0] - x, x - box[2], box[1] - y, y - box[3]);
    if (distance > far) out.push({ list: item.list, index: item.index, level: 'far', drawable: true, distance, limit: far });
    else if (distance > nearLimit) out.push({ list: item.list, index: item.index, level: 'near', drawable: true, distance, limit: nearLimit });
  }
  return out;
}

/** The measurements and dimension chains that can be drawn: one with a value or a length that is not finite is left out. */
export function drawableAnnotations<M, D>(plan: { measurements?: M[]; dimensions?: D[] }): { measurements: M[]; dimensions: D[] } {
  return {
    measurements: (plan.measurements ?? []).filter(m => measurementDrawable(m as unknown as Measurement)),
    dimensions: (plan.dimensions ?? []).filter(c => chainDrawable(c as unknown as DimensionChain)),
  };
}

/** The area that "Fit" shows in 2D: content bounds plus, on each side, 10% of that axis or 500 mm, whichever is larger. */
export function fitBounds(plan: PlanV2): Rect {
  const r = contentBounds(plan);
  if (!r) return [...EMPTY_PLAN_AREA];
  const mx = Math.max((r[2] - r[0]) * 0.1, 500), my = Math.max((r[3] - r[1]) * 0.1, 500);
  return [r[0] - mx, r[1] - my, r[2] + mx, r[3] + my];
}

/** What an import shows before it replaces the open plan: item counts and the size of all content in metres. */
export interface PlanSummary { walls: number; openings: number; rooms: number; furniture: number; width: number; depth: number }
export function summarizePlan(plan: PlanV2): PlanSummary {
  const r = contentBounds(plan);
  return {
    walls: plan.walls.length, openings: plan.openings.length, rooms: plan.rooms.length, furniture: plan.furniture.length,
    width: r ? (r[2] - r[0]) / 1000 : 0, depth: r ? (r[3] - r[1]) / 1000 : 0,
  };
}
