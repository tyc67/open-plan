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
  for (const m of (plan.measurements ?? []) as Measurement[]) { e.add(m.a.x, m.a.y); e.add(m.b.x, m.b.y); }
  for (const c of (plan.dimensions ?? []) as DimensionChain[]) {
    const end = c.start + c.segments.reduce((sum, s) => sum + s, 0);
    if (c.horizontal) { e.add(c.start, c.at); e.add(end, c.at); } else { e.add(c.at, c.start); e.add(c.at, end); }
  }
  return e.rect();
}

/** The area that "Fit" shows in 2D: content bounds plus, on each side, 10% of that axis or 500 mm, whichever is larger. */
export function fitBounds(plan: PlanV2): Rect {
  const r = contentBounds(plan);
  if (!r) return [...EMPTY_PLAN_AREA];
  const mx = Math.max((r[2] - r[0]) * 0.1, 500), my = Math.max((r[3] - r[1]) * 0.1, 500);
  return [r[0] - mx, r[1] - my, r[2] + mx, r[3] + my];
}
