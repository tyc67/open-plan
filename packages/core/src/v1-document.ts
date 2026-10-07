import { LEGACY_NAMES } from './legacy-names.js';
import { MigrationError, migrateV1, type MigrationNote } from './migrate-v1.js';
import type { Point, PlanV2 } from './types.js';
import { validateSharedFields, type Issue } from './validate.js';

type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown, length: number) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);

/**
 * Checks a plan from before schema v2 before it is migrated: the v1 walls and openings here, and the shared fields with
 * the validator (saved policy). The migrated plan is then checked in full. Only the first wall or opening problem is
 * reported, because the migration cannot read the rest of a broken v1 list.
 */
export function checkDocumentV1(doc: unknown): { ok: boolean; errors: Issue[] } {
  const issue = (path: string, code: string, params: Obj = {}) => ({ ok: false, errors: [{ path, code, params }] });
  if (!isObject(doc) || doc.units !== 'mm') return issue('units', 'enum-invalid', { allowed: ['mm'], value: isObject(doc) ? doc.units : undefined });
  if (!Array.isArray(doc.walls)) return issue('walls', 'type-invalid', { expected: 'list' });
  if (!Array.isArray(doc.openings)) return issue('openings', 'type-invalid', { expected: 'list' });
  const badWall = doc.walls.findIndex(w => !(isObject(w) && typeof w.id === 'string' && typeof w.type === 'string' && finite(w.rect, 4)));
  if (badWall >= 0) return issue(`walls[${badWall}]`, 'v1-unreadable', { reason: 'wall' });
  const badOpening = doc.openings.findIndex(o => !(isObject(o) && typeof o.id === 'string' && typeof o.type === 'string' && finite(o.rect, 4) &&
    (o.type !== 'door' || finite(o.h, 2) && finite(o.c, 2) && finite(o.o, 2) && Number.isFinite(o.len))));
  if (badOpening >= 0) return issue(`openings[${badOpening}]`, 'v1-unreadable', { reason: 'opening' });
  const shared = validateSharedFields(doc, 'saved');
  return { ok: shared.ok, errors: shared.errors };
}

const localize = <T>(item: T): T => {
  const name = isObject(item) ? item.name : undefined;
  return typeof name === 'string' && LEGACY_NAMES.has(name) ? { ...item, name: LEGACY_NAMES.get(name) } : item;
};

/**
 * Sets the locale to zh-TW and replaces the exact labels of the old sample (furniture, rooms, openings, materials).
 * Custom names, geometry and unknown fields are kept. Works on v1 and v2 plans; the input is not changed.
 */
export function localizeLegacyNames<T extends { furniture: unknown[]; rooms: unknown[]; openings: unknown[]; materials?: Record<string, unknown> }>(doc: T): T {
  return {
    ...doc, locale: 'zh-TW',
    furniture: doc.furniture.map(localize),
    rooms: doc.rooms.map(localize),
    openings: doc.openings.map(localize),
    materials: Object.fromEntries(Object.entries(doc.materials || {}).map(([id, material]) => [id, localize(material)])),
  };
}

// Room polygons of the old sample included the bearing-wall projections inherited from the reference drawing.
export const LAUNDRY_POLYGON: Point[] = [[0, 3610], [1580, 3610], [1580, 3825], [2180, 3825], [2180, 4950], [0, 4950]];
export const CHILD_POLYGON: Point[] = [[6600, 3610], [10270, 3610], [10270, 6370], [6323, 6370], [6323, 3707], [6600, 3707]];
const ROOM_CORRECTIONS = [
  { id: 'laundry', original: [[0, 3610], [2180, 3610], [2180, 4950], [0, 4950]], poly: LAUNDRY_POLYGON, wall: [1580, 3370, 2420, 3825] },
  { id: 'child', original: [[6323, 3610], [10270, 3610], [10270, 6370], [6323, 6370]], poly: CHILD_POLYGON, wall: [6083, 3370, 6600, 3707] },
];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Corrects the two room polygons of the old sample. Guarded: a room changes only if its id and polygon are exactly the
 * old sample's and the bearing wall that the old polygon overlapped is still there. Each correction is reported.
 */
export function correctLegacyRooms<T extends { rooms: unknown[]; walls: unknown[] }>(doc: T): { doc: T; report: MigrationNote[] } {
  const report: MigrationNote[] = [];
  const rooms = doc.rooms.map(room => {
    if (!isObject(room)) return room;
    const fix = ROOM_CORRECTIONS.find(c => c.id === room.id && same(room.poly, c.original) &&
      doc.walls.some(w => isObject(w) && w.type === 'b' && same(w.rect, c.wall)));
    if (!fix) return room;
    report.push({ code: 'room-polygon-corrected', roomId: fix.id, message: 'The room outline of the old sample overlapped a bearing wall; it now follows the wall face.' });
    return { ...room, poly: fix.poly.map(p => [...p]) };
  });
  return { doc: { ...doc, rooms }, report };
}

export type V1DocumentResult = { ok: true; plan: PlanV2; report: MigrationNote[] } | { ok: false; errors: Issue[]; report: MigrationNote[] };

/**
 * The whole v1 path, the same for the browser, import and the CLI: check, localize the old labels, correct the old
 * sample rooms, and migrate with the A1 rules. The result is not validated as v2 yet; the caller does that with its policy.
 */
export function migrateV1Document(input: unknown): V1DocumentResult {
  const v1 = checkDocumentV1(input);
  if (!v1.ok) return { ok: false, errors: v1.errors, report: [] };
  const { doc, report } = correctLegacyRooms(localizeLegacyNames(input as { furniture: unknown[]; rooms: unknown[]; openings: unknown[]; walls: unknown[] }));
  try {
    const migrated = migrateV1(doc);
    return { ok: true, plan: migrated.plan, report: [...report, ...migrated.report] };
  } catch (error) {
    const path = error instanceof MigrationError ? error.path : '$';
    const reason = error instanceof MigrationError ? error.code : String((error as Error)?.message ?? error);
    return { ok: false, errors: [{ path, code: 'v1-unreadable', params: { reason } }], report };
  }
}
