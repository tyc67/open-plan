import { wallLength } from '../geometry.js';
import { HEAD_MIN } from '../heights.js';
import { uniqueId } from '../ids.js';
import type { OpeningV2, PlanV2, Point, WallV2 } from '../types.js';
import { LENGTH_TOLERANCE, THICKNESS_MAX, THICKNESS_MIN } from '../validate.js';

/** A command refuses its change. `field` is the command field the problem is about (null: the whole command). */
export class Refusal {
  constructor(readonly field: string | null, readonly code: string, readonly params: Record<string, unknown> = {}) {}
}
export const refuse = (field: string | null, code: string, params: Record<string, unknown> = {}): never => { throw new Refusal(field, code, params); };

/** What one command returns: the new plan (the input plan is not changed), notes and warnings. */
export interface Step { plan: PlanV2; notes?: { code: string; params: Record<string, unknown> }[]; warnings?: { path: string; code: string; params: Record<string, unknown> }[] }

// ---- Reading command fields. Commands come from JSON (agents), so every field is checked at run time. ----

type Kind = 'string' | 'id' | 'number' | 'boolean' | 'point' | 'polygon';
export type FieldSpec = Kind | { enum: readonly string[] };
export interface Spec { required?: Record<string, FieldSpec>; optional?: Record<string, FieldSpec>; use?: Record<string, string[]> }

const EXPECTED: Record<Kind, string> = { string: 'string', id: 'non-empty string', number: 'number', boolean: 'boolean', point: '[x, y]', polygon: 'list of [x, y]' };
const TEST: Record<Kind, (v: unknown) => boolean> = {
  string: v => typeof v === 'string',
  id: v => typeof v === 'string' && v.length > 0,
  number: v => Number.isFinite(v),
  boolean: v => typeof v === 'boolean',
  point: v => isPoint(v),
  polygon: v => Array.isArray(v) && v.every(isPoint),
};
const isPoint = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);

/**
 * Checks the fields of a command against its spec. Unknown fields are refused, so a misspelled field is not ignored;
 * a field in `use` is refused with the commands that change it.
 */
export function readFields(input: object, spec: Spec): void {
  const command = input as Record<string, unknown>;
  const all = { ...spec.required, ...spec.optional };
  for (const key of Object.keys(command)) {
    // Own properties only: `constructor`, `toString` or `__proto__` must not pass as known fields.
    if (key === 'op' || Object.hasOwn(all, key)) continue;
    if (spec.use && Object.hasOwn(spec.use, key)) refuse(key, 'field-not-updatable', { field: key, use: spec.use[key] });
    refuse(key, 'command-field-unknown', { field: key, allowed: Object.keys(all) });
  }
  for (const [key, kind] of Object.entries(all)) {
    const value = command[key];
    if (value === undefined) { if (spec.required && Object.hasOwn(spec.required, key)) refuse(key, 'missing-field', { expected: expected(kind) }); continue; }
    if (typeof kind === 'string') { if (!TEST[kind](value)) refuse(key, 'type-invalid', { expected: EXPECTED[kind] }); }
    else if (!kind.enum.includes(value as string)) refuse(key, 'enum-invalid', { allowed: [...kind.enum], value });
  }
}
const expected = (kind: FieldSpec) => typeof kind === 'string' ? EXPECTED[kind] : kind.enum.join(' | ');

// ---- Plan helpers. Commands never change the plan they get: they copy the lists and items they change. ----

export function findWall(plan: PlanV2, wallId: string, field = 'wallId'): WallV2 {
  return plan.walls.find(w => w.id === wallId) ?? refuse(field, 'wall-missing', { wallId });
}
export function findOpening(plan: PlanV2, openingId: string, field = 'openingId'): OpeningV2 {
  return plan.openings.find(o => o.id === openingId) ?? refuse(field, 'opening-missing', { openingId });
}
export const openingsIn = (plan: PlanV2, wallId: string) => plan.openings.filter(o => o.wallId === wallId);
export const replaceWall = (plan: PlanV2, wall: WallV2): PlanV2 => ({ ...plan, walls: plan.walls.map(w => w.id === wall.id ? wall : w) });
export const replaceOpening = (plan: PlanV2, opening: OpeningV2): PlanV2 => ({ ...plan, openings: plan.openings.map(o => o.id === opening.id ? opening : o) });
export const replaceOpenings = (plan: PlanV2, changed: OpeningV2[]): PlanV2 => {
  const byId = new Map(changed.map(o => [o.id, o]));
  return { ...plan, openings: plan.openings.map(o => byId.get(o.id) ?? o) };
};

/** The given id (refused if used), or a generated one, with an `id-generated` note. */
export function newId(list: { id: string }[], given: unknown, base: string, listName: string, field = 'id'): { id: string; notes: Step['notes'] } {
  const used = new Set(list.map(item => item.id));
  if (given !== undefined) { if (used.has(given as string)) refuse(field, 'id-duplicate', { id: given }); return { id: given as string, notes: [] }; }
  const id = uniqueId(used, base);
  return { id, notes: [{ code: 'id-generated', params: { list: listName, id } }] };
}

// ---- Shared checks of the wall and opening rules ----

export function checkWallLine(a: Point, b: Point, field: string) {
  if (a[0] === b[0] && a[1] === b[1]) refuse(field, 'wall-zero-length');
  if (a[0] !== b[0] && a[1] !== b[1]) refuse(field, 'wall-not-axis-aligned');
}
export function checkThickness(value: number, field = 'thickness') {
  if (value < THICKNESS_MIN || value > THICKNESS_MAX) refuse(field, 'thickness-out-of-range', { min: THICKNESS_MIN, max: THICKNESS_MAX, value });
}
export function checkDemolishable(type: string, demolished: boolean | undefined, field: string) {
  if (demolished && (type === 'b' || type === 'e')) refuse(field, 'wall-not-demolishable', { type });
}

/**
 * The rules for one opening in its wall, as a command must keep them (roadmap C1): inside the wall, no overlap with
 * the other openings of that wall, not in a demolished wall, no window in a low wall, heights in range. `field` is the
 * command field to name. Openings listed in `ignore` (the opening itself, or openings that move in the same step) are skipped.
 */
export function checkOpening(plan: PlanV2, opening: OpeningV2, wall: WallV2, field: string, ignore: ReadonlySet<string> = new Set([opening.id])) {
  if (wall.demolished) refuse(field, 'wall-demolished', { wallId: wall.id });
  if (opening.offset < 0) refuse(field, 'value-out-of-range', { min: 0, value: opening.offset });
  if (!(opening.width > 0)) refuse(field, 'size-not-positive', { value: opening.width });
  const length = wallLength(wall), end = opening.offset + opening.width;
  if (end > length + LENGTH_TOLERANCE) refuse(field, 'opening-outside-wall', { openingId: opening.id, wallLength: length, end });
  for (const other of openingsIn(plan, wall.id)) {
    if (ignore.has(other.id)) continue;
    if (opening.offset < other.offset + other.width - LENGTH_TOLERANCE && other.offset < end - LENGTH_TOLERANCE) refuse(field, 'openings-overlap', { openingId: opening.id, otherId: other.id });
  }
  if (opening.type === 'window' && wall.type === 'low') refuse(field, 'window-in-low-wall', { wallId: wall.id });
  checkHeights(opening, plan.ceilingHeight);
}

export function checkHeights(opening: OpeningV2, ceiling: number) {
  if (opening.type === 'window') {
    if (opening.sill < 0) refuse('sill', 'height-out-of-range', { min: 0, value: opening.sill });
    if (opening.sill >= opening.head) refuse('sill', 'window-sill-not-below-head', { sill: opening.sill, head: opening.head });
    if (opening.head > ceiling) refuse('head', 'height-out-of-range', { max: ceiling, value: opening.head });
  } else if (opening.head < HEAD_MIN || opening.head > ceiling) refuse('head', 'height-out-of-range', { min: HEAD_MIN, max: ceiling, value: opening.head });
}

/**
 * A length that a command computes (an offset after a wall change), rounded to the tolerance grid. Float noise such as
 * 2000.3 − 1000.1 − 1000.2 = −1.1e−13 becomes 0, and reversing a wall twice gives back input values that are on the grid
 * (for example 0.1 mm values); a value with more precision comes back rounded to the grid. Values
 * that a command receives are not cleaned, so a really negative offset is still refused.
 */
const GRID = Math.round(1 / LENGTH_TOLERANCE);   // 1e6: division by an exact integer gives the nearest double to the decimal
export const cleanLength = (v: number): number => Math.round(v * GRID) / GRID + 0;

/** The same door seen from the other end of its wall: the hinge end and the swing side change. */
export const flipDoor = <T extends OpeningV2>(o: T): T => o.type === 'door'
  ? { ...o, hinge: o.hinge === 'start' ? 'end' : 'start', swing: o.swing === 'left' ? 'right' : 'left' }
  : o;
