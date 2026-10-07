import { fitBounds } from './bounds.js';
import { planGeometry } from './plan-geometry.js';
import { roomArea } from './rooms.js';
import type { PlanV2, Point, Rect, WallType } from './types.js';

/**
 * Options for the 2D drawing. `crop` is a plan area [x0, y0, x1, y1] in mm (default: the whole plan with its
 * margin); `width` is the image width in px (the height follows the crop).
 */
export interface SvgOptions {
  crop?: Rect;
  width?: number;
  /** A 1 m grid, so an agent can compare positions with the source image. */
  grid?: boolean;
  /** The dimension chains of the plan. */
  dimensions?: boolean;
  /** Room names and areas (default on). */
  labels?: boolean;
  /** Furniture outlines (default on). */
  furniture?: boolean;
  /**
   * Text (default on). `false` removes every text element (room names, areas, dimension numbers) and keeps the
   * dimension lines: a geometry-only image that does not depend on the installed fonts.
   */
  text?: boolean;
}

const WALL_FILL: Record<WallType, string> = { e: '#2f3640', b: '#1b1f24', n: '#7b8794', low: '#b8c2cc' };
const n = (v: number) => String(Math.round(v * 10) / 10 + 0);
const pt = ([x, y]: Point) => `${n(x)},${n(y)}`;
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rect = ([x0, y0, x1, y1]: Rect, attrs: string) => `<rect x="${n(x0)}" y="${n(y0)}" width="${n(x1 - x0)}" height="${n(y1 - y0)}" ${attrs}/>`;
const line = (a: Point, b: Point, attrs: string) => `<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}" ${attrs}/>`;
const text = (at: Point, size: number, content: string, attrs = '') =>
  `<text x="${n(at[0])}" y="${n(at[1])}" font-size="${n(size)}" text-anchor="middle" dominant-baseline="middle"${attrs ? ` ${attrs}` : ''}>${escape(content)}</text>`;

/** Centre of a polygon's bounding box: the label position of a room without `at`. */
function boxCentre(poly: Point[]): Point {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/** The plan area and the image size in px that `renderPlanSvg` uses for these options; a caller can check the size first. */
export function planImageSize(plan: PlanV2, options: Pick<SvgOptions, 'crop' | 'width'> = {}): { crop: Rect; width: number; height: number } {
  const crop = options.crop ?? fitBounds(plan), width = options.width ?? 1200;
  return { crop, width, height: Math.max(1, Math.round(width * (crop[3] - crop[1]) / (crop[2] - crop[0]))) };
}

/**
 * The plan as a 2D SVG string (roadmap C1): rooms, walls, openings, labels and furniture outlines. It is a simpler
 * drawing than the editor, for checking a plan, not for presentation. The same plan and options always give the same
 * text. Coordinates are plan millimetres; line widths and text sizes follow the crop, so they look the same at any size.
 */
export function renderPlanSvg(plan: PlanV2, options: SvgOptions = {}): string {
  const { crop: [x0, y0, x1, y1], width, height } = planImageSize(plan, options), w = x1 - x0, h = y1 - y0;
  const px = w / width;                                                   // mm per image pixel
  const font = Math.max(w, h) / 70, thin = `stroke-width="${n(px)}"`;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(x0)} ${n(y0)} ${n(w)} ${n(h)}" width="${width}" height="${height}" font-family="sans-serif">`);
  out.push(rect([x0, y0, x1, y1], 'fill="#ffffff"'));

  out.push(`<g data-layer="rooms" stroke="none">${plan.rooms.map(r =>
    `<polygon data-room="${escape(r.id)}" points="${r.poly.map(pt).join(' ')}" fill="${escape(plan.materials[r.mat]?.sw ?? '#eeeeee')}"/>`).join('')}</g>`);

  const { solids, openings } = planGeometry(plan);
  out.push(`<g data-layer="walls">${solids.map(s => s.demolished
    ? rect(s.rect, `data-wall="${escape(s.wallId)}" fill="none" stroke="#d64545" stroke-width="${n(2 * px)}" stroke-dasharray="${n(8 * px)} ${n(5 * px)}"`)
    : rect(s.rect, `data-wall="${escape(s.wallId)}" fill="${WALL_FILL[s.type]}"`)).join('')}</g>`);

  const horizontalWall = new Map(plan.walls.map(w => [w.id, w.a[1] === w.b[1]]));
  const shapes = openings.map(o => {
    // The direction comes from the wall: an opening narrower than the wall thickness has a rect that is longer across.
    const [ox0, oy0, ox1, oy1] = o.rect, along = horizontalWall.get(o.wallId)!;
    const mid = along ? (oy0 + oy1) / 2 : (ox0 + ox1) / 2;
    const centreLine = along ? line([ox0, mid], [ox1, mid], '') : line([mid, oy0], [mid, oy1], '');
    const tag = `data-opening="${escape(o.id)}" data-type="${o.type}"`;
    if (o.type === 'window') return `<g ${tag}>${rect(o.rect, 'fill="#ffffff" stroke="#3e6fb5"')}${centreLine}</g>`;
    if (o.type === 'hole') return `<g ${tag}>${rect(o.rect, `fill="#ffffff" stroke="#9aa5b1" stroke-dasharray="${n(6 * px)} ${n(4 * px)}"`)}</g>`;
    if (o.type === 'sliding-door') {
      // Two panels, a quarter of the thickness to each side of the centre line, overlapping at the middle. The overlap
      // is at most a quarter of the opening width, so a narrow opening keeps its panels inside it.
      const q = (along ? oy1 - oy0 : ox1 - ox0) / 4, overlap = Math.min(q, o.width / 4), c = along ? (ox0 + ox1) / 2 : (oy0 + oy1) / 2;
      const panels = along
        ? line([ox0, mid - q], [c + overlap, mid - q], '') + line([c - overlap, mid + q], [ox1, mid + q], '')
        : line([mid - q, oy0], [mid - q, c + overlap], '') + line([mid + q, c - overlap], [mid + q, oy1], '');
      return `<g ${tag}>${rect(o.rect, 'fill="#ffffff" stroke="none"')}${panels}</g>`;
    }
    // A door: its leaf drawn open at 90°, and the arc that the leaf end draws from closed to open.
    const [h, c, d, len] = [o.h!, o.c!, o.o!, o.len!];
    const closed: Point = [h[0] + c[0] * len, h[1] + c[1] * len], open: Point = [h[0] + d[0] * len, h[1] + d[1] * len];
    const sweep = c[0] * d[1] - c[1] * d[0] > 0 ? 1 : 0;
    return `<g ${tag}>${rect(o.rect, 'fill="#ffffff" stroke="none"')}${line(h, open, '')}` +
      `<path d="M ${pt(closed)} A ${n(len)} ${n(len)} 0 0 ${sweep} ${pt(open)}" fill="none" stroke-dasharray="${n(4 * px)} ${n(3 * px)}"/></g>`;
  });
  out.push(`<g data-layer="openings" stroke="#3a3f47" ${thin}>${shapes.join('')}</g>`);

  if (options.furniture !== false) out.push(`<g data-layer="furniture" fill="none" stroke="#6b7280" ${thin}>${plan.furniture.map(f =>
    `<g data-furniture="${escape(f.id)}" transform="rotate(${n(f.rot)} ${n(f.cx)} ${n(f.cy)})">${rect([f.cx - f.w / 2, f.cy - f.d / 2, f.cx + f.w / 2, f.cy + f.d / 2], '')}</g>`).join('')}</g>`);

  if (options.dimensions && plan.dimensions?.length) {
    const parts: string[] = [];
    for (const d of plan.dimensions) {
      let pos = d.start;
      const at = (v: number): Point => d.horizontal ? [v, d.at] : [d.at, v];
      const tick = (v: number) => d.horizontal ? line([v, d.at - 4 * font / 10], [v, d.at + 4 * font / 10], '') : line([d.at - 4 * font / 10, v], [d.at + 4 * font / 10, v], '');
      parts.push(line(at(d.start), at(d.start + d.segments.reduce((s, v) => s + v, 0)), ''), tick(pos));
      for (const segment of d.segments) {
        const centre = pos + segment / 2, label: Point = d.horizontal ? [centre, d.at - font * 0.6] : [d.at - font * 0.6, centre];
        parts.push(tick(pos + segment));
        if (options.text !== false) parts.push(text(label, font * 0.6, n(segment), `stroke="none" fill="#7d7160"${d.horizontal ? '' : ` transform="rotate(-90 ${pt(label)})"`}`));
        pos += segment;
      }
    }
    out.push(`<g data-layer="dimensions" stroke="#7d7160" ${thin}>${parts.join('')}</g>`);
  }

  // On top of the rooms and walls, so it is visible everywhere; half transparent, so it hides nothing.
  if (options.grid) {
    const lines: string[] = [];
    for (let x = Math.ceil(x0 / 1000) * 1000; x <= x1; x += 1000) lines.push(line([x, y0], [x, y1], ''));
    for (let y = Math.ceil(y0 / 1000) * 1000; y <= y1; y += 1000) lines.push(line([x0, y], [x1, y], ''));
    out.push(`<g data-layer="grid" stroke="#486581" stroke-opacity="0.35" ${thin}>${lines.join('')}</g>`);
  }

  if (options.labels !== false && options.text !== false) out.push(`<g data-layer="labels" fill="#1f2933">${plan.rooms.map(r => {
    const at = r.at ?? boxCentre(r.poly);
    return text(at, font, r.name) + text([at[0], at[1] + font * 1.2], font * 0.75, `${roomArea(r.poly).toFixed(1)} m²`, 'fill="#52606d"');
  }).join('')}</g>`);

  out.push('</svg>');
  return out.join('\n');
}
