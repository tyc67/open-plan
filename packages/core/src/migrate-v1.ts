import { hingePoint, lineFromRect, rightNormal, wallDirection, wallLength } from './geometry.js';
import type { DoorV2, OpeningV1, OpeningV2, PlanV1, PlanV2, Rect, WallType, WallV1, WallV2 } from './types.js';

export interface MigrationNote {
  code: string;
  message: string;
  openingId?: string;
  wallId?: string;
}
export interface MigrationResult { plan: PlanV2; report: MigrationNote[] }

/** The input cannot be migrated. `path` points at the field, for example `openings[3].type`. Nothing is changed. */
export class MigrationError extends Error {
  constructor(readonly code: string, readonly path: string, message: string) { super(`${path}: ${message}`); this.name = 'MigrationError'; }
}

// Heights that the v1 renderer used for every plan (three/models.js); v2 stores them as data.
const CEILING = 2800, DOOR_HEAD = 2100, WINDOW_HEAD = 2400, TALL_SLIDE_HEAD = 2400;
const v1WindowSill = (index: number) => index === 0 ? 1400 : index >= 6 ? 450 : 900;

// Full-height types first: when the walls at the two ends disagree, the generated piece takes the first match.
const TYPE_ORDER: WallType[] = ['b', 'e', 'n', 'low'];
const asWallType = (type: string): WallType => (TYPE_ORDER as string[]).includes(type) ? type as WallType : 'n';

/**
 * Converts a v1 plan to v2. The input is not changed. It is checked first (`checkPlanV1`), because the
 * v1 validator accepts data that the migration cannot read; such input throws a MigrationError.
 *
 * v1 walls stop at each opening, so every opening gets its own new wall piece with the opening's rect,
 * and the opening fills that piece. Nothing is merged, so every rect stays the same as in v1.
 */
export function migrateV1(input: unknown): MigrationResult {
  const v1 = checkPlanV1(input);
  const report: MigrationNote[] = [];
  const walls: WallV2[] = v1.walls.map(w => ({ id: w.id, type: asWallType(w.type), ...lineFromRect(w.rect), ...(w.demolished ? { demolished: true } : {}) }));
  for (const w of v1.walls) if (asWallType(w.type) !== w.type) report.push({ code: 'wall-type-unknown', wallId: w.id, message: `Unknown wall type "${w.type}" was changed to "n".` });

  const wallIds = new Set(v1.walls.map(w => w.id)), openingIds = new Set(v1.openings.map(o => o.id));

  const openings: OpeningV2[] = [];
  let windowIndex = 0;
  const addPiece = (openingId: string, rect: Rect) => {
    const { type, reason } = pieceType(rect, v1.walls);
    const id = uniqueId(wallIds, `${openingId}--wall`), line = lineFromRect(rect);
    walls.push({ id, type, ...line });
    report.push({ code: 'opening-wall-created', openingId, wallId: id, message: `Wall piece of type "${type}" (${reason}).` });
    if (type === 'low') report.push({ code: 'opening-wall-low', openingId, wallId: id, message: 'The piece is a low wall, so no lintel is drawn above this opening.' });
    for (const w of touchingWalls(rect, v1.walls)) if (w.demolished) report.push({ code: 'neighbour-demolished', openingId, wallId: w.id, message: `A touching wall (${w.id}) is demolished; the opening stays. Check it.` });
    return { id, line };
  };

  for (const o of v1.openings) {
    const { id: wallId, line } = addPiece(o.id, o.rect);
    const base = { id: o.id, wallId, offset: 0, width: wallLength(line) };
    if (o.type === 'window') openings.push({ ...base, type: 'window', sill: v1WindowSill(windowIndex++), head: WINDOW_HEAD });
    else if (o.type === 'sliding-door') openings.push({ ...base, type: 'sliding-door', head: o.v ? TALL_SLIDE_HEAD : DOOR_HEAD });
    else if (o.type === 'door') openings.push(migrateDoor(o, base, line, report));
  }

  for (const hole of sampleBayHoles(v1, openingIds, report)) {
    const { id: wallId, line } = addPiece(hole.id, hole.rect);
    openings.push({ id: hole.id, type: 'hole', wallId, offset: 0, width: wallLength(line), head: WINDOW_HEAD });
  }

  const { schemaVersion: _v1, walls: _w, openings: _o, ...rest } = v1;
  // Plans are JSON, so a JSON copy is exact; core has no DOM or Node types for structuredClone.
  const copied = JSON.parse(JSON.stringify(rest)) as typeof rest;
  return { plan: { ...copied, schemaVersion: 2, ceilingHeight: CEILING, walls, openings }, report };
}

function migrateDoor(o: Extract<OpeningV1, { type: 'door' }>, base: { id: string; wallId: string; offset: number; width: number }, line: ReturnType<typeof lineFromRect>, report: MigrationNote[]): DoorV2 {
  const u = wallDirection(line), n = rightNormal(u);
  const along = (o.h[0] - line.a[0]) * u[0] + (o.h[1] - line.a[1]) * u[1];
  const hinge = Math.abs(along) <= Math.abs(along - base.width) ? 'start' : 'end';
  const swing = o.o[0] * n[0] + o.o[1] * n[1] >= 0 ? 'right' : 'left';
  const door: DoorV2 = { ...base, type: 'door', hinge, swing, head: DOOR_HEAD, ...(o.name !== undefined ? { name: o.name } : {}), ...(o.entry ? { entry: true } : {}) };
  const note = (code: string, message: string) => report.push({ code, openingId: o.id, wallId: base.wallId, message });
  if (along !== 0 && along !== base.width) note('door-hinge-not-at-end', `The v1 hinge is ${along} mm from the start, not at an end of the opening; "${hinge}" was used.`);
  const [hx, hy] = hingePoint(door, line);
  if (hx !== o.h[0] || hy !== o.h[1]) note('door-hinge-moved', `The hinge moves from (${o.h.join(', ')}) to (${hx}, ${hy}).`);
  const expectedClosed = hinge === 'start' ? u : [-u[0], -u[1]];
  if (o.c[0] !== expectedClosed[0] || o.c[1] !== expectedClosed[1]) note('door-closed-direction', `The v1 closed direction (${o.c.join(', ')}) does not point from the hinge into the opening.`);
  const sideways = Math.abs(o.o[0] * n[0] + o.o[1] * n[1]);
  if (sideways !== 1) note('door-swing-not-normal', `The v1 open direction (${o.o.join(', ')}) is not at 90° to the wall; "${swing}" was used.`);
  if (o.len !== base.width) note('door-length-changed', `The v1 leaf length ${o.len} mm becomes the opening width ${base.width} mm.`);
  return door;
}

const overlapsClosed = (a: Rect, b: Rect) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const overlapsOpen = (a: Rect, b: Rect) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const touchingWalls = (rect: Rect, walls: WallV1[]) => walls.filter(w => overlapsClosed(rect, w.rect));

/** Walls that touch one end face of a piece (the face across the piece's length). */
function endWalls(rect: Rect, end: 'start' | 'end', walls: WallV1[]): WallV1[] {
  const [x0, y0, x1, y1] = rect, horizontal = x1 - x0 >= y1 - y0;
  const face: Rect = horizontal ? (end === 'start' ? [x0, y0, x0, y1] : [x1, y0, x1, y1]) : (end === 'start' ? [x0, y0, x1, y0] : [x0, y1, x1, y1]);
  // The wall must reach the face and overlap the piece across its thickness, not only at a corner.
  return walls.filter(w => overlapsClosed(face, w.rect) && (horizontal ? w.rect[1] < y1 && w.rect[3] > y0 : w.rect[0] < x1 && w.rect[2] > x0));
}

function pieceType(rect: Rect, walls: WallV1[]): { type: WallType; reason: string } {
  const ends = [...endWalls(rect, 'start', walls), ...endWalls(rect, 'end', walls)];
  const pool = ends.length ? ends : touchingWalls(rect, walls);
  if (!pool.length) return { type: 'n', reason: 'no touching wall' };
  const types = [...new Set(pool.map(w => asWallType(w.type)))];
  const type = TYPE_ORDER.find(t => types.includes(t))!;
  const source = ends.length ? 'walls at its ends' : 'nearest touching walls';
  return { type, reason: types.length === 1 ? `from the ${source}` : `the ${source} disagree (${types.join(', ')}); full-height type first` };
}

// In v1 the renderer drew two lintels at fixed coordinates for the sample's bay-window holes.
// They are not in the document, so only a plan with the sample's exact walls around both gaps gets them.
const BAY_HOLES: { id: string; rect: Rect; ends: [string, Rect][] }[] = [
  { id: 'bay-hole-1', rect: [10270, 800, 10510, 2600], ends: [['e', [10270, 300, 10510, 800]], ['e', [10270, 2600, 10510, 3090]]] },
  { id: 'bay-hole-2', rect: [10270, 4260, 10510, 5740], ends: [['b', [10270, 3090, 10510, 4260]], ['b', [10270, 5740, 10510, 6370]]] },
];

function sampleBayHoles(v1: PlanV1, openingIds: Set<string>, report: MigrationNote[]): { id: string; rect: Rect }[] {
  const sameRect = (a: Rect, b: Rect) => a.every((v, i) => v === b[i]);
  const endsPresent = BAY_HOLES.every(h => h.ends.every(([type, rect]) => v1.walls.some(w => w.type === type && sameRect(w.rect, rect))));
  if (!endsPresent) { report.push({ code: 'sample-bay-holes-not-applicable', message: 'The sample bay-window walls are not present, so no bay-window holes were added.' }); return []; }
  // Only wall and opening rects block the rule: they are what the renderer draws in the wall line.
  // Rooms, furniture, measurements and dimensions are not checked; the sample's bay-window rooms cover the gaps by design.
  // Touching a gap's edge does not block it, because the sample's end walls touch both gaps.
  const blocked = BAY_HOLES.filter(h => v1.walls.some(w => overlapsOpen(w.rect, h.rect)) || v1.openings.some(o => overlapsOpen(o.rect, h.rect)));
  if (blocked.length) {
    report.push({ code: 'sample-bay-holes-skipped', message: `A wall or opening overlaps ${blocked.map(h => h.id).join(' and ')}, so no bay-window holes were added.` });
    return [];
  }
  const holes = BAY_HOLES.map(h => ({ id: uniqueId(openingIds, h.id), rect: h.rect }));
  for (const h of holes) report.push({ code: 'sample-bay-hole-created', openingId: h.id, message: 'Sample-specific: this hole had only a hard-coded lintel in v1.' });
  return holes;
}

/** `base`, or `base-2`, `base-3` and so on: the first one not in `used`. Adds the result to `used`. */
function uniqueId(used: Set<string>, base: string): string {
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

const OPENING_TYPES = ['window', 'door', 'sliding-door'];
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown, length: number): v is number[] => Array.isArray(v) && v.length === length && v.every(Number.isFinite);

/** Checks what the migration reads. Rooms, furniture and the other copied fields are checked by the plan validator, not here. */
export function checkPlanV1(input: unknown): PlanV1 {
  const fail = (code: string, path: string, message: string): never => { throw new MigrationError(code, path, message); };
  if (!isObject(input)) fail('not-an-object', '$', 'The plan is not a JSON object.');
  const plan = input as Record<string, unknown>;
  if (plan.schemaVersion !== 1) fail('schema-version', 'schemaVersion', `Expected 1, found ${JSON.stringify(plan.schemaVersion)}.`);
  if (plan.units !== 'mm') fail('units', 'units', 'Units must be "mm".');
  if (!Array.isArray(plan.walls)) fail('missing-field', 'walls', 'walls must be a list.');
  if (!Array.isArray(plan.openings)) fail('missing-field', 'openings', 'openings must be a list.');
  const rect = (v: unknown, path: string) => {
    if (!finite(v, 4)) fail('rect-invalid', path, 'A rect must be 4 finite numbers.');
    const [x0, y0, x1, y1] = v as number[];
    if (!(x0! < x1! && y0! < y1!)) fail('rect-empty-or-reversed', path, 'A rect needs x0 < x1 and y0 < y1.');
  };
  const seen = (list: string) => { const ids = new Set<string>(); return (id: unknown, path: string) => {
    if (typeof id !== 'string' || !id) fail('id-invalid', path, 'id must be a non-empty string.');
    if (ids.has(id as string)) fail('id-duplicate', path, `The id "${id}" is used twice in ${list}.`);
    ids.add(id as string);
  }; };
  const wallId = seen('walls'), openingId = seen('openings');
  (plan.walls as unknown[]).forEach((w, i) => {
    const path = `walls[${i}]`;
    if (!isObject(w)) return fail('not-an-object', path, 'A wall must be an object.');
    wallId(w.id, `${path}.id`);
    if (typeof w.type !== 'string') fail('missing-field', `${path}.type`, 'type must be a string.');
    rect(w.rect, `${path}.rect`);
  });
  (plan.openings as unknown[]).forEach((o, i) => {
    const path = `openings[${i}]`;
    if (!isObject(o)) return fail('not-an-object', path, 'An opening must be an object.');
    openingId(o.id, `${path}.id`);
    if (!OPENING_TYPES.includes(o.type as string)) fail('opening-type-unknown', `${path}.type`, `Unknown opening type ${JSON.stringify(o.type)}; expected ${OPENING_TYPES.join(', ')}.`);
    rect(o.rect, `${path}.rect`);
    if (o.type === 'door') {
      for (const key of ['h', 'c', 'o']) if (!finite(o[key], 2)) fail('door-field-missing', `${path}.${key}`, `${key} must be 2 finite numbers.`);
      if (!Number.isFinite(o.len) || (o.len as number) <= 0) fail('door-field-missing', `${path}.len`, 'len must be a number above 0.');
    }
  });
  return plan as unknown as PlanV1;
}
