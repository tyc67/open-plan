import { wallLength } from './geometry.js';
import type { PlanV2 } from './types.js';

/** The plan cannot be drawn safely. `path` points at the field, for example `openings[3].wallId`. */
export class PlanFormatError extends Error {
  constructor(readonly code: string, readonly path: string, message: string) { super(`${path}: ${message}`); this.name = 'PlanFormatError'; }
}

const WALL_TYPES = ['e', 'b', 'n', 'low'], OPENING_TYPES = ['window', 'door', 'sliding-door', 'hole'];
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const point = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);

/**
 * Checks the v2 wall and opening fields that would break drawing (roadmap B2, errors that block rendering).
 * It does not check rooms, furniture or the other shared fields, and it does not fill default heights:
 * a normalized PlanV2 must already have every height. The full validator is roadmap Step B.
 */
export function checkPlanV2(input: unknown): PlanV2 {
  const fail = (code: string, path: string, message: string): never => { throw new PlanFormatError(code, path, message); };
  if (!isObject(input)) fail('not-an-object', '$', 'The plan is not a JSON object.');
  const plan = input as Record<string, unknown>;
  if (plan.schemaVersion !== 2) fail('schema-version', 'schemaVersion', `Expected 2, found ${JSON.stringify(plan.schemaVersion)}.`);
  if (plan.units !== 'mm') fail('units', 'units', 'Units must be "mm".');
  if (!Number.isFinite(plan.ceilingHeight)) fail('height-invalid', 'ceilingHeight', 'ceilingHeight must be a number.');
  if (!Array.isArray(plan.walls)) fail('missing-field', 'walls', 'walls must be a list.');
  if (!Array.isArray(plan.openings)) fail('missing-field', 'openings', 'openings must be a list.');

  const lengths = new Map<string, number>();
  (plan.walls as unknown[]).forEach((w, i) => {
    const path = `walls[${i}]`;
    if (!isObject(w)) return fail('not-an-object', path, 'A wall must be an object.');
    if (typeof w.id !== 'string' || !w.id) fail('id-invalid', `${path}.id`, 'id must be a non-empty string.');
    if (lengths.has(w.id as string)) fail('id-duplicate', `${path}.id`, `The id "${w.id}" is used twice in walls.`);
    if (!WALL_TYPES.includes(w.type as string)) fail('wall-type-unknown', `${path}.type`, `Expected one of ${WALL_TYPES.join(', ')}.`);
    if (!point(w.a)) fail('point-invalid', `${path}.a`, 'a must be 2 finite numbers.');
    if (!point(w.b)) fail('point-invalid', `${path}.b`, 'b must be 2 finite numbers.');
    const [a, b] = [w.a as number[], w.b as number[]];
    if (a[0] === b[0] && a[1] === b[1]) fail('wall-zero-length', path, 'a and b are the same point.');
    if (a[0] !== b[0] && a[1] !== b[1]) fail('wall-not-axis-aligned', path, 'Walls must be horizontal or vertical in this version.');
    if (!Number.isFinite(w.thickness) || (w.thickness as number) < 20 || (w.thickness as number) > 1000) fail('thickness-out-of-range', `${path}.thickness`, 'thickness must be 20–1000 mm.');
    if (w.demolished !== undefined && typeof w.demolished !== 'boolean') fail('field-invalid', `${path}.demolished`, 'demolished must be true or false.');
    lengths.set(w.id as string, wallLength({ a: a as [number, number], b: b as [number, number], thickness: w.thickness as number }));
  });

  const ids = new Set<string>();
  (plan.openings as unknown[]).forEach((o, i) => {
    const path = `openings[${i}]`;
    if (!isObject(o)) return fail('not-an-object', path, 'An opening must be an object.');
    if (typeof o.id !== 'string' || !o.id) fail('id-invalid', `${path}.id`, 'id must be a non-empty string.');
    if (ids.has(o.id as string)) fail('id-duplicate', `${path}.id`, `The id "${o.id}" is used twice in openings.`);
    ids.add(o.id as string);
    if (!OPENING_TYPES.includes(o.type as string)) fail('opening-type-unknown', `${path}.type`, `Expected one of ${OPENING_TYPES.join(', ')}.`);
    const length = lengths.get(o.wallId as string);
    if (length === undefined) fail('wall-missing', `${path}.wallId`, `No wall has the id ${JSON.stringify(o.wallId)}.`);
    if (!Number.isFinite(o.offset) || (o.offset as number) < 0) fail('offset-invalid', `${path}.offset`, 'offset must be 0 or more.');
    if (!Number.isFinite(o.width) || (o.width as number) <= 0) fail('width-invalid', `${path}.width`, 'width must be above 0.');
    if ((o.offset as number) + (o.width as number) > length!) fail('opening-outside-wall', `${path}.width`, `The opening ends after the wall (length ${length} mm).`);
    for (const key of o.type === 'window' ? ['sill', 'head'] : ['head']) if (!Number.isFinite(o[key])) fail('height-invalid', `${path}.${key}`, `${key} must be a number.`);
    if (o.type === 'door') {
      if (o.hinge !== 'start' && o.hinge !== 'end') fail('door-hinge-invalid', `${path}.hinge`, 'hinge must be "start" or "end".');
      if (o.swing !== 'left' && o.swing !== 'right') fail('door-swing-invalid', `${path}.swing`, 'swing must be "left" or "right".');
    }
  });
  return plan as unknown as PlanV2;
}
