import type { DoorV2, OpeningV2, Point, Rect, WallV2 } from './types.js';

type WallLine = Pick<WallV2, 'a' | 'b' | 'thickness'>;

/** Centre line along the longer side of a rect; the shorter side is the thickness. A square becomes horizontal. */
export function lineFromRect([x0, y0, x1, y1]: Rect): WallLine {
  if (x1 - x0 >= y1 - y0) { const y = (y0 + y1) / 2; return { a: [x0, y], b: [x1, y], thickness: y1 - y0 }; }
  const x = (x0 + x1) / 2;
  return { a: [x, y0], b: [x, y1], thickness: x1 - x0 };
}

export const wallLength = ({ a, b }: WallLine): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Unit direction from a to b. */
export function wallDirection(wall: WallLine): Point {
  const length = wallLength(wall);
  return [(wall.b[0] - wall.a[0]) / length, (wall.b[1] - wall.a[1]) / length];
}

/** Right normal on screen (y down): the direction turned 90° clockwise. */
export const rightNormal = ([dx, dy]: Point): Point => [-dy, dx];

const isAxisAligned = ({ a, b }: WallLine) => a[0] === b[0] || a[1] === b[1];

/** Rect of the part of a wall between two distances from `a`, with the full thickness. Axis-aligned walls only in this phase. */
export function segmentRect(wall: WallLine, from: number, to: number): Rect {
  if (!isAxisAligned(wall)) throw new Error('wall-not-axis-aligned');
  const [ux, uy] = wallDirection(wall), half = wall.thickness / 2;
  const p: Point = [wall.a[0] + from * ux, wall.a[1] + from * uy], q: Point = [wall.a[0] + to * ux, wall.a[1] + to * uy];
  if (wall.a[1] === wall.b[1]) return [Math.min(p[0], q[0]), wall.a[1] - half, Math.max(p[0], q[0]), wall.a[1] + half];
  return [wall.a[0] - half, Math.min(p[1], q[1]), wall.a[0] + half, Math.max(p[1], q[1])];
}

export const wallRect = (wall: WallLine): Rect => segmentRect(wall, 0, wallLength(wall));

export const openingRect = (opening: Pick<OpeningV2, 'offset' | 'width'>, wall: WallLine): Rect =>
  segmentRect(wall, opening.offset, opening.offset + opening.width);

/** Hinge on the wall face on the swing side: a + t·u + s·(thickness / 2)·n. */
export function hingePoint(door: Pick<DoorV2, 'offset' | 'width' | 'hinge' | 'swing'>, wall: WallLine): Point {
  const u = wallDirection(wall), n = rightNormal(u);
  const t = door.hinge === 'start' ? door.offset : door.offset + door.width, s = door.swing === 'right' ? 1 : -1, half = wall.thickness / 2;
  return [wall.a[0] + t * u[0] + s * half * n[0], wall.a[1] + t * u[1] + s * half * n[1]];
}
