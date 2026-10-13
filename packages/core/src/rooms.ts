import type { Point, Room } from './types.js';

/** Area of a room polygon in m² (coordinates in mm). */
export function roomArea(poly: Point[]): number {
  return Math.abs(poly.reduce((sum, [x, y], i) => { const [nx, ny] = poly[(i + 1) % poly.length]; return sum + x * ny - nx * y; }, 0)) / 2e6;
}

/** Perimeter of a room polygon in m. */
export function roomPerimeter(poly: Point[]): number {
  return poly.reduce((sum, [x, y], i) => { const [nx, ny] = poly[(i + 1) % poly.length]; return sum + Math.hypot(nx - x, ny - y); }, 0) / 1000;
}

/** True if the point is inside the polygon or on its edge. */
export function containsPoint(poly: Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (Math.abs(cross) < 1e-6 && x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && y >= Math.min(ay, by) && y <= Math.max(ay, by)) return true;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

/** Area of a polygon in mm². */
export const polygonArea = (poly: Point[]): number => Math.abs(poly.reduce((sum, [x, y], i) => { const [nx, ny] = poly[(i + 1) % poly.length]; return sum + x * ny - nx * y; }, 0)) / 2;
const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const onSegment = (p: Point, a: Point, b: Point) => Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);
function segmentsTouch(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && onSegment(a, c, d)) || (d2 === 0 && onSegment(b, c, d)) || (d3 === 0 && onSegment(c, a, b)) || (d4 === 0 && onSegment(d, a, b));
}
/** True if two edges that are not neighbours cross or touch. Repeated points are removed first. */
export function polygonSelfCrossing(poly: Point[]): boolean {
  const pts = poly.filter((p, i) => { const q = poly[(i + poly.length - 1) % poly.length]; return p[0] !== q[0] || p[1] !== q[1]; });
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    if (segmentsTouch(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
  }
  return false;
}

/** The X values where a horizontal line at `y` goes through the outline, sorted. `y` is not the height of a point. */
function crossings(poly: Point[], y: number): number[] {
  const xs: number[] = [];
  poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length]; if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1])); });
  return xs.sort((p, q) => p - q);
}

/**
 * A point that is inside the outline (not on its edge), for a room label. The outline is cut into bands
 * between the heights of its points; a horizontal line through the middle of a band goes through no point of the
 * outline, so its parts inside the outline are clear. The result is the middle of the part with the largest
 * width × band height. Null for an outline with no area.
 * A point in the middle of a straight side makes no band: without this, such a point would move the result off centre.
 * Repeated points go first, because a repeated corner is in line with its copy and would be removed as well.
 */
export function interiorPoint(outline: Point[]): Point | null {
  const single = outline.filter((p, i) => { const a = outline[(i + outline.length - 1) % outline.length]; return outline.length === 1 || p[0] !== a[0] || p[1] !== a[1]; });
  const poly = single.filter((p, i) => {
    const a = single[(i + single.length - 1) % single.length], b = single[(i + 1) % single.length];
    return (p[0] - a[0]) * (b[1] - a[1]) !== (p[1] - a[1]) * (b[0] - a[0]);
  });
  const heights = [...new Set(poly.map(p => p[1]))].sort((p, q) => p - q);
  let found: Point | null = null, largest = 0;
  for (let band = 0; band + 1 < heights.length; band++) {
    const y = (heights[band] + heights[band + 1]) / 2, xs = crossings(poly, y);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const size = (xs[i + 1] - xs[i]) * (heights[band + 1] - heights[band]);
      if (size > largest) { largest = size; found = [(xs[i] + xs[i + 1]) / 2, y]; }
    }
  }
  if (!found) return null;
  // The rounded point (0.1 mm) is used only when it is still inside the outline: in a very thin room, or beside a
  // sloping edge, rounding can put it on an edge or outside, and then the exact middle is kept.
  const x = Math.round(found[0] * 10) / 10, y = Math.round(found[1] * 10) / 10, xs = heights.includes(y) ? [] : crossings(poly, y);
  return xs.some((from, i) => i % 2 === 0 && from < x && x < xs[i + 1]) ? [x, y] : found;
}

/** Explicit positions stay unchanged; the fallback is display-only, also for tolerable degenerate outlines. */
export function roomLabelPoint(room: Pick<Room, 'poly' | 'at'>): Point {
  return room.at ?? interiorPoint(room.poly) ?? room.poly[0];
}
