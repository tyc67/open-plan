import { wallLength } from './geometry.js';
import { CEILING_MAX, CEILING_MIN, HEAD_MIN } from './heights.js';
import type { OpeningV2, PlanV2, Point } from './types.js';

/**
 * One problem in a plan. `path` points at the field, for example `openings[2].width` (`$` is the whole plan).
 * `code` is stable; the UI makes the message text from `code` and `params`.
 */
export interface Issue { path: string; code: string; params: Record<string, unknown> }

/**
 * Where the plan comes from. A saved plan (browser storage, the `serve` file) gets tolerable issues as warnings,
 * so a plan that loaded before a save also loads after it. An import, CLI `validate` or MCP tool gets them as errors.
 */
export type ValidationSource = 'saved' | 'import';

export interface ValidationResult {
  ok: boolean;
  /** The normalized plan (every height present), when `ok`. */
  plan?: PlanV2;
  errors: Issue[];
  warnings: Issue[];
}

/** Size limits (roadmap B2). Above them a plan is a tolerable issue: it still draws, but slowly. */
export const PLAN_LIMITS = { size: 100_000, walls: 2000, openings: 2000, rooms: 500, furniture: 5000 } as const;
/** Heights that an input may leave out (roadmap A2), in mm. */
export const DEFAULT_HEIGHTS = { ceilingHeight: 2800, windowSill: 900, windowHead: 2400, head: 2100 } as const;
export const THICKNESS_MIN = 20, THICKNESS_MAX = 1000;
/** 0.01 m² in mm². */
export const ROOM_MIN_AREA = 10_000;

/**
 * Codes for issues that can be shown and edited safely. Every other code blocks rendering and is an error for
 * every source.
 */
export const TOLERABLE_CODES: ReadonlySet<string> = new Set([
  'room-area-too-small', 'room-self-crossing', 'room-material-missing', 'openings-overlap',
  'height-out-of-range', 'window-sill-not-below-head', 'window-in-low-wall', 'plan-too-large', 'too-many-items',
  'wall-not-demolishable',
]);

export const WALL_TYPES = ['e', 'b', 'n', 'low'] as const;
export const OPENING_TYPES = ['window', 'door', 'sliding-door', 'hole'] as const;

type Obj = Record<string, unknown>;
type Kind = 'string' | 'id' | 'number' | 'boolean' | 'array' | 'object' | 'point';
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isPoint = (v: unknown): v is Point => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);
const KIND_TEST: Record<Kind, (v: unknown) => boolean> = {
  string: v => typeof v === 'string',
  id: v => typeof v === 'string' && v.length > 0,
  number: v => Number.isFinite(v),
  boolean: v => typeof v === 'boolean',
  array: v => Array.isArray(v),
  object: isObject,
  point: isPoint,
};
const EXPECTED: Record<Kind, string> = { string: 'string', id: 'non-empty string', number: 'number', boolean: 'boolean', array: 'list', object: 'object', point: '[x, y]' };

class Collector {
  blocking: Issue[] = [];
  tolerable: Issue[] = [];
  add(path: string, code: string, params: Record<string, unknown> = {}) {
    (TOLERABLE_CODES.has(code) ? this.tolerable : this.blocking).push({ path, code, params });
  }
  /** Checks a field's presence and type. Returns true when it is present and has the right type. */
  field(obj: Obj, key: string, path: string, kind: Kind, optional = false): boolean {
    const value = obj[key], at = `${path}.${key}`;
    if (value === undefined) { if (!optional) this.add(at, 'missing-field', { expected: EXPECTED[kind] }); return false; }
    if (!KIND_TEST[kind](value)) { this.add(at, 'type-invalid', { expected: EXPECTED[kind] }); return false; }
    return true;
  }
  oneOf(obj: Obj, key: string, path: string, allowed: readonly string[]): boolean {
    const value = obj[key], at = `${path}.${key}`;
    if (value === undefined) { this.add(at, 'missing-field', { expected: allowed.join(' | ') }); return false; }
    if (!allowed.includes(value as string)) { this.add(at, 'enum-invalid', { allowed: [...allowed], value }); return false; }
    return true;
  }
  /** A list's items must be objects with unique, non-empty ids. Returns the items that are objects, with their index. */
  items(list: unknown[], path: string, idRequired = true): [Obj, number, string][] {
    const seen = new Set<string>(), out: [Obj, number, string][] = [];
    list.forEach((item, i) => {
      const at = `${path}[${i}]`;
      if (!isObject(item)) { this.add(at, 'type-invalid', { expected: 'object' }); return; }
      if (idRequired && this.field(item, 'id', at, 'id')) {
        if (seen.has(item.id as string)) this.add(`${at}.id`, 'id-duplicate', { id: item.id });
        seen.add(item.id as string);
      }
      out.push([item, i, at]);
    });
    return out;
  }
}

const area = (poly: Point[]) => Math.abs(poly.reduce((sum, [x, y], i) => { const [nx, ny] = poly[(i + 1) % poly.length]; return sum + x * ny - nx * y; }, 0)) / 2;
const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const onSegment = (p: Point, a: Point, b: Point) => Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);
function segmentsTouch(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && onSegment(a, c, d)) || (d2 === 0 && onSegment(b, c, d)) || (d3 === 0 && onSegment(c, a, b)) || (d4 === 0 && onSegment(d, a, b));
}
/** True if two edges that are not neighbours cross or touch. Repeated points are removed first. */
function selfCrossing(poly: Point[]): boolean {
  const pts = poly.filter((p, i) => { const q = poly[(i + poly.length - 1) % poly.length]; return p[0] !== q[0] || p[1] !== q[1]; });
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    if (segmentsTouch(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
  }
  return false;
}

/** Checks the fields that v1 and v2 share: rooms, furniture, materials, measurements, dimensions, cost estimate. */
function checkShared(plan: Obj, c: Collector, extent: Extent) {
  const materials = c.field(plan, 'materials', '$', 'object') ? plan.materials as Obj : null;
  if (materials) for (const [key, m] of Object.entries(materials)) {
    const at = `materials.${key}`;
    if (!isObject(m)) { c.add(at, 'type-invalid', { expected: 'object' }); continue; }
    c.field(m, 'name', at, 'string'); c.field(m, 'sw', at, 'string');
    if (c.field(m, 'price', at, 'number', true) && (m.price as number) < 0) c.add(`${at}.price`, 'value-out-of-range', { min: 0, value: m.price });
  }

  if (c.field(plan, 'rooms', '$', 'array')) {
    const rooms = plan.rooms as unknown[];
    if (rooms.length > PLAN_LIMITS.rooms) c.add('rooms', 'too-many-items', { count: rooms.length, limit: PLAN_LIMITS.rooms });
    for (const [r, , at] of c.items(rooms, 'rooms')) {
      c.field(r, 'name', at, 'string');
      if (c.field(r, 'mat', at, 'string') && materials && !Object.hasOwn(materials, r.mat as string)) c.add(`${at}.mat`, 'room-material-missing', { mat: r.mat });
      c.field(r, 'at', at, 'point', true);
      c.field(r, 'counted', at, 'boolean', true);
      if (!c.field(r, 'poly', at, 'array')) continue;
      const poly = r.poly as unknown[];
      let valid = true;
      poly.forEach((p, k) => { if (!isPoint(p)) { c.add(`${at}.poly[${k}]`, 'type-invalid', { expected: '[x, y]' }); valid = false; } });
      if (poly.length < 3) { c.add(`${at}.poly`, 'room-too-few-points', { count: poly.length }); continue; }
      if (!valid) continue;
      const pts = poly as Point[];
      for (const [x, y] of pts) extent.add(x, y);
      // Crossing first: the area formula is not the real area of a polygon that crosses itself (a bow tie gives 0).
      if (selfCrossing(pts)) { c.add(`${at}.poly`, 'room-self-crossing'); continue; }
      const a = area(pts);
      if (a < ROOM_MIN_AREA) c.add(`${at}.poly`, 'room-area-too-small', { area: a / 1e6, min: ROOM_MIN_AREA / 1e6 });
    }
  }

  if (c.field(plan, 'furniture', '$', 'array')) {
    const furniture = plan.furniture as unknown[];
    if (furniture.length > PLAN_LIMITS.furniture) c.add('furniture', 'too-many-items', { count: furniture.length, limit: PLAN_LIMITS.furniture });
    for (const [f, , at] of c.items(furniture, 'furniture')) {
      c.field(f, 'type', at, 'string'); c.field(f, 'name', at, 'string'); c.field(f, 'color', at, 'string', true);
      const ok = ['cx', 'cy', 'w', 'd', 'rot'].map(k => c.field(f, k, at, 'number')).every(Boolean);
      for (const k of ['w', 'd']) if (Number.isFinite(f[k]) && (f[k] as number) <= 0) c.add(`${at}.${k}`, 'size-not-positive', { value: f[k] });
      if (ok && (f.w as number) > 0 && (f.d as number) > 0) {
        const angle = (f.rot as number) * Math.PI / 180, cs = Math.abs(Math.cos(angle)), sn = Math.abs(Math.sin(angle));
        const hw = ((f.w as number) * cs + (f.d as number) * sn) / 2, hh = ((f.w as number) * sn + (f.d as number) * cs) / 2;
        extent.add((f.cx as number) - hw, (f.cy as number) - hh); extent.add((f.cx as number) + hw, (f.cy as number) + hh);
      }
    }
  }

  if (c.field(plan, 'measurements', '$', 'array', true)) for (const [m, , at] of c.items(plan.measurements as unknown[], 'measurements'))
    for (const k of ['a', 'b']) if (c.field(m, k, at, 'object')) { const p = m[k] as Obj; c.field(p, 'x', `${at}.${k}`, 'number'); c.field(p, 'y', `${at}.${k}`, 'number'); }

  if (c.field(plan, 'dimensions', '$', 'array', true)) for (const [d, , at] of c.items(plan.dimensions as unknown[], 'dimensions', false)) {
    c.field(d, 'horizontal', at, 'boolean'); c.field(d, 'at', at, 'number'); c.field(d, 'start', at, 'number');
    if (c.field(d, 'segments', at, 'array')) (d.segments as unknown[]).forEach((s, k) => { if (!Number.isFinite(s)) c.add(`${at}.segments[${k}]`, 'type-invalid', { expected: 'number' }); });
  }

  if (c.field(plan, 'costEstimate', '$', 'object', true)) {
    const cost = plan.costEstimate as Obj;
    for (const key of ['furniturePrices', 'materialPrices']) if (c.field(cost, key, 'costEstimate', 'object', true))
      for (const [id, price] of Object.entries(cost[key] as Obj)) {
        const at = `costEstimate.${key}.${id}`;
        if (price === null) continue;
        if (!Number.isFinite(price)) c.add(at, 'type-invalid', { expected: 'number or null' });
        else if ((price as number) < 0) c.add(at, 'value-out-of-range', { min: 0, value: price });
      }
    if (c.field(cost, 'wastePercent', 'costEstimate', 'number', true) && ((cost.wastePercent as number) < 0 || (cost.wastePercent as number) > 100))
      c.add('costEstimate.wastePercent', 'value-out-of-range', { min: 0, max: 100, value: cost.wastePercent });
  }
}

class Extent {
  x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity;
  add(x: number, y: number) { this.x0 = Math.min(this.x0, x); this.y0 = Math.min(this.y0, y); this.x1 = Math.max(this.x1, x); this.y1 = Math.max(this.y1, y); }
}

const finishPolicy = (c: Collector, source: ValidationSource) => source === 'saved'
  ? { errors: c.blocking, warnings: c.tolerable }
  : { errors: [...c.blocking, ...c.tolerable], warnings: [] as Issue[] };

/**
 * Checks the shared fields of a plan of any version (rooms, furniture, materials, measurements, dimensions, cost).
 * A v1 plan is checked with this before it is migrated; the v2 result of the migration is then checked in full.
 */
export function validateSharedFields(input: unknown, source: ValidationSource): { ok: boolean; errors: Issue[]; warnings: Issue[] } {
  const c = new Collector();
  if (!isObject(input)) c.add('$', 'type-invalid', { expected: 'object' });
  else checkShared(input, c, new Extent());
  const result = finishPolicy(c, source);
  return { ok: result.errors.length === 0, ...result };
}

/**
 * The one validator for v2 plans (roadmap B2): saved plans at load, imports, the CLI and MCP tools.
 * It collects every issue, sorts each into "blocks rendering" or "tolerable", and applies the policy for the source.
 * Valid input becomes a normalized PlanV2 with the A2 default heights filled in. The input is not changed.
 */
export function validatePlan(input: unknown, source: ValidationSource): ValidationResult {
  const c = new Collector(), extent = new Extent();
  if (!isObject(input)) {
    c.add('$', 'type-invalid', { expected: 'object' });
    return { ok: false, ...finishPolicy(c, source) };
  }
  if (input.schemaVersion !== 2) {
    c.add('schemaVersion', 'schema-version', { expected: 2, found: input.schemaVersion ?? null });
    return { ok: false, ...finishPolicy(c, source) };
  }
  c.field(input, 'id', '$', 'id'); c.field(input, 'name', '$', 'string'); c.field(input, 'locale', '$', 'string', true);
  c.oneOf(input, 'units', '$', ['mm']);
  let ceiling: number = DEFAULT_HEIGHTS.ceilingHeight;
  if (c.field(input, 'ceilingHeight', '$', 'number', true)) {
    ceiling = input.ceilingHeight as number;
    if (ceiling < CEILING_MIN || ceiling > CEILING_MAX) c.add('ceilingHeight', 'height-out-of-range', { min: CEILING_MIN, max: CEILING_MAX, value: ceiling });
  }

  // Walls. A wall that is complete and well-formed is kept for the opening checks.
  const walls = new Map<string, { a: Point; b: Point; thickness: number; type: string }>();
  if (c.field(input, 'walls', '$', 'array')) {
    const list = input.walls as unknown[];
    if (list.length > PLAN_LIMITS.walls) c.add('walls', 'too-many-items', { count: list.length, limit: PLAN_LIMITS.walls });
    for (const [w, , at] of c.items(list, 'walls')) {
      const typeOk = c.oneOf(w, 'type', at, WALL_TYPES);
      c.field(w, 'name', at, 'string', true);
      const aOk = c.field(w, 'a', at, 'point'), bOk = c.field(w, 'b', at, 'point');
      let thicknessOk = c.field(w, 'thickness', at, 'number');
      if (thicknessOk && ((w.thickness as number) < THICKNESS_MIN || (w.thickness as number) > THICKNESS_MAX)) {
        c.add(`${at}.thickness`, 'thickness-out-of-range', { min: THICKNESS_MIN, max: THICKNESS_MAX, value: w.thickness }); thicknessOk = false;
      }
      // Only partition and low walls can be demolished. A saved plan with a demolished bearing or exterior wall still
      // draws (as demolished), and the editor can restore the wall, so it is tolerable.
      if (c.field(w, 'demolished', at, 'boolean', true) && w.demolished && (w.type === 'b' || w.type === 'e'))
        c.add(`${at}.demolished`, 'wall-not-demolishable', { type: w.type });
      if (!aOk || !bOk) continue;
      const [a, b] = [w.a as Point, w.b as Point];
      if (a[0] === b[0] && a[1] === b[1]) { c.add(at, 'wall-zero-length'); continue; }
      if (a[0] !== b[0] && a[1] !== b[1]) { c.add(at, 'wall-not-axis-aligned'); continue; }
      extent.add(a[0], a[1]); extent.add(b[0], b[1]);
      if (typeOk && thicknessOk && typeof w.id === 'string' && !walls.has(w.id)) walls.set(w.id, { a, b, thickness: w.thickness as number, type: w.type as string });
    }
  }

  // Openings.
  const spans: { wallId: string; start: number; end: number; id: string; path: string }[] = [];
  if (c.field(input, 'openings', '$', 'array')) {
    const list = input.openings as unknown[];
    if (list.length > PLAN_LIMITS.openings) c.add('openings', 'too-many-items', { count: list.length, limit: PLAN_LIMITS.openings });
    for (const [o, , at] of c.items(list, 'openings')) {
      const typeOk = c.oneOf(o, 'type', at, OPENING_TYPES);
      c.field(o, 'name', at, 'string', true);
      let wall: { a: Point; b: Point; thickness: number; type: string } | undefined;
      if (c.field(o, 'wallId', at, 'string')) {
        wall = walls.get(o.wallId as string);
        // A wall with this id that has its own errors is reported there; only a missing id is reported here.
        const listed = Array.isArray(input.walls) && (input.walls as unknown[]).some(w => isObject(w) && w.id === o.wallId);
        if (!listed) c.add(`${at}.wallId`, 'wall-missing', { wallId: o.wallId });
      }
      let offsetOk = c.field(o, 'offset', at, 'number'), widthOk = c.field(o, 'width', at, 'number');
      if (offsetOk && (o.offset as number) < 0) { c.add(`${at}.offset`, 'value-out-of-range', { min: 0, value: o.offset }); offsetOk = false; }
      if (widthOk && (o.width as number) <= 0) { c.add(`${at}.width`, 'size-not-positive', { value: o.width }); widthOk = false; }
      if (wall && offsetOk && widthOk) {
        const length = wallLength(wall), end = (o.offset as number) + (o.width as number);
        if (end > length) c.add(`${at}.width`, 'opening-outside-wall', { wallLength: length, end });
        else spans.push({ wallId: o.wallId as string, start: o.offset as number, end, id: String(o.id), path: at });
      }
      if (!typeOk) continue;
      if (o.type === 'door') {
        c.oneOf(o, 'hinge', at, ['start', 'end']); c.oneOf(o, 'swing', at, ['left', 'right']); c.field(o, 'entry', at, 'boolean', true);
      }
      // Heights are optional in input. A missing height gets the A2 default, and the ranges are checked on that value,
      // so the normalized plan gives the same result as its input. `defaulted` tells the message that the value was not given.
      const height = (key: string, fallback: number): number | null => {
        const given = c.field(o, key, at, 'number', true);
        if (o[key] !== undefined && !given) return null;
        return given ? o[key] as number : fallback;
      };
      const range = (key: string, value: number, limits: { min?: number; max?: number }) =>
        c.add(`${at}.${key}`, 'height-out-of-range', { ...limits, value, ...(o[key] === undefined ? { defaulted: true } : {}) });
      if (o.type === 'window') {
        const sill = height('sill', DEFAULT_HEIGHTS.windowSill), head = height('head', DEFAULT_HEIGHTS.windowHead);
        if (sill === null || head === null) continue;
        if (sill < 0) range('sill', sill, { min: 0 });
        if (sill >= head) c.add(`${at}.sill`, 'window-sill-not-below-head', { sill, head });
        if (head > ceiling) range('head', head, { max: ceiling });
        if (wall?.type === 'low') c.add(at, 'window-in-low-wall', { wallId: o.wallId });
      } else {
        const head = height('head', DEFAULT_HEIGHTS.head);
        if (head !== null && (head < HEAD_MIN || head > ceiling)) range('head', head, { min: HEAD_MIN, max: ceiling });
      }
    }
  }
  // Overlapping openings in one wall: each opening is compared with the ones that start before it.
  const byWall = new Map<string, typeof spans>();
  for (const s of spans) byWall.set(s.wallId, [...(byWall.get(s.wallId) ?? []), s]);
  for (const list of byWall.values()) {
    list.sort((p, q) => p.start - q.start);
    let reach: (typeof spans)[number] | null = null;
    for (const s of list) {
      if (reach && s.start < reach.end) c.add(s.path, 'openings-overlap', { otherId: reach.id, otherPath: reach.path });
      if (!reach || s.end > reach.end) reach = s;
    }
  }

  checkShared(input, c, extent);
  if (extent.x0 <= extent.x1) {
    const width = extent.x1 - extent.x0, depth = extent.y1 - extent.y0;
    if (width > PLAN_LIMITS.size || depth > PLAN_LIMITS.size) c.add('$', 'plan-too-large', { width, depth, limit: PLAN_LIMITS.size });
  }

  const { errors, warnings } = finishPolicy(c, source);
  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, plan: normalize(input), errors, warnings };
}

/** A copy with every height present. Only called on input with no errors. */
function normalize(input: Obj): PlanV2 {
  const plan = JSON.parse(JSON.stringify(input)) as PlanV2 & { openings: (OpeningV2 & { sill?: number; head?: number })[] };
  plan.ceilingHeight ??= DEFAULT_HEIGHTS.ceilingHeight;
  for (const o of plan.openings) {
    if (o.type === 'window') { o.sill ??= DEFAULT_HEIGHTS.windowSill; o.head ??= DEFAULT_HEIGHTS.windowHead; }
    else o.head ??= DEFAULT_HEIGHTS.head;
  }
  return plan;
}
