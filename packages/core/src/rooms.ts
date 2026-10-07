import type { Point } from './types.js';

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
