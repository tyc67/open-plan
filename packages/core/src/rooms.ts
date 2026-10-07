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
