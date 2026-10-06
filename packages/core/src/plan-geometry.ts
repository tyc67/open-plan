import { hingePoint, openingRect, rightNormal, segmentRect, wallDirection, wallLength } from './geometry.js';
import type { DoorV2, OpeningV2, PlanV2, Point, Rect, WallType } from './types.js';

/** A solid part of a wall: the wall minus its openings. A demolished wall is one part over its full length. */
export interface SolidPart { wallId: string; type: WallType; rect: Rect; demolished: boolean }

/**
 * A visible opening with the shapes that drawing code needs: its rect and the type of its wall (a `low` wall
 * has no lintel and cuts sills at the low-wall height). Doors also get `h` (hinge point), `c` (closed
 * direction), `o` (open direction) and `len`; sliding doors get `v` (vertical in the plan).
 */
export type OpeningShape = OpeningV2 & { rect: Rect; wallType: WallType; h?: Point; c?: Point; o?: Point; len?: number; v?: boolean };

export interface PlanGeometry { solids: SolidPart[]; openings: OpeningShape[] }

// -0 would turn atan2(-0, -1) into -π instead of π in the 3D door code.
const noNegativeZero = ([x, y]: Point): Point => [x + 0, y + 0];

// Keyed on the walls and openings arrays, not the plan: an edit to furniture or rooms makes a new plan object
// but keeps these arrays, so the shapes are not made again on every furniture drag frame.
const cache = new WeakMap<PlanV2['walls'], WeakMap<PlanV2['openings'], PlanGeometry>>();

/**
 * Shapes for drawing, snapping and measuring, made from v2 data. Plans are treated as immutable:
 * the result is cached per walls and openings array, so do not change those arrays or their items after this call.
 * Openings in a demolished wall are not returned.
 */
export function planGeometry(plan: PlanV2): PlanGeometry {
  const byOpenings = cache.get(plan.walls) ?? new WeakMap<PlanV2['openings'], PlanGeometry>();
  cache.set(plan.walls, byOpenings);
  const cached = byOpenings.get(plan.openings);
  if (cached) return cached;
  const byWall = new Map<string, OpeningV2[]>();
  for (const o of plan.openings) byWall.set(o.wallId, [...(byWall.get(o.wallId) ?? []), o]);

  const solids: SolidPart[] = [], openings: OpeningShape[] = [];
  for (const wall of plan.walls) {
    const demolished = !!wall.demolished, length = wallLength(wall);
    if (demolished) { solids.push({ wallId: wall.id, type: wall.type, rect: segmentRect(wall, 0, length), demolished }); continue; }
    let cursor = 0;
    for (const o of [...(byWall.get(wall.id) ?? [])].sort((p, q) => p.offset - q.offset)) {
      if (o.offset > cursor) solids.push({ wallId: wall.id, type: wall.type, rect: segmentRect(wall, cursor, o.offset), demolished });
      cursor = Math.max(cursor, o.offset + o.width);
    }
    if (cursor < length) solids.push({ wallId: wall.id, type: wall.type, rect: segmentRect(wall, cursor, length), demolished });
  }

  const walls = new Map(plan.walls.map(w => [w.id, w]));
  for (const o of plan.openings) {
    const wall = walls.get(o.wallId);
    if (!wall || wall.demolished) continue;
    const shape: OpeningShape = { ...o, rect: openingRect(o, wall), wallType: wall.type };
    if (o.type === 'door') {
      const u = wallDirection(wall), n = rightNormal(u), door = o as DoorV2;
      shape.h = hingePoint(door, wall);
      shape.c = noNegativeZero(door.hinge === 'start' ? u : [-u[0], -u[1]]);
      shape.o = noNegativeZero(door.swing === 'right' ? n : [-n[0], -n[1]]);
      shape.len = o.width;
    }
    if (o.type === 'sliding-door') shape.v = wall.a[0] === wall.b[0];
    openings.push(shape);
  }
  const result = { solids, openings };
  byOpenings.set(plan.openings, result);
  return result;
}
