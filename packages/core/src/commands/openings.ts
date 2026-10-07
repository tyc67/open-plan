import type { OpeningV2, PlanV2 } from '../types.js';
import { DEFAULT_HEIGHTS, OPENING_TYPES } from '../validate.js';
import type { OpeningCommand } from './types.js';
import { checkHeights, checkOpening, cleanLength, findOpening, findWall, newId, readFields, refuse, replaceOpening, type FieldSpec, type Spec, type Step } from './support.js';

const openingType = { enum: OPENING_TYPES };
const hinge = { enum: ['start', 'end'] as const }, swing = { enum: ['left', 'right'] as const };
/** The fields that only some opening types have. */
const TYPE_FIELDS: Record<OpeningV2['type'], Record<string, FieldSpec>> = {
  window: { sill: 'number', head: 'number' },
  door: { hinge, swing, head: 'number', entry: 'boolean' },
  'sliding-door': { head: 'number' },
  hole: { head: 'number' },
};
const TYPE_ONLY = ['sill', 'hinge', 'swing', 'entry'];

/** Refuses a field that the opening type does not have, with a code that says so (not "unknown field"). */
function checkTypeFields(input: object, type: OpeningV2['type']) {
  const command = input as Record<string, unknown>;
  for (const key of TYPE_ONLY) if (command[key] !== undefined && !Object.hasOwn(TYPE_FIELDS[type], key)) refuse(key, 'field-not-for-type', { field: key, type });
}
function readType(command: object): OpeningV2['type'] {
  const type = (command as { type?: unknown }).type;
  if (type === undefined) refuse('type', 'missing-field', { expected: OPENING_TYPES.join(' | ') });
  if (!OPENING_TYPES.includes(type as OpeningV2['type'])) refuse('type', 'enum-invalid', { allowed: [...OPENING_TYPES], value: type });
  return type as OpeningV2['type'];
}

function addOpening(plan: PlanV2, c: Extract<OpeningCommand, { op: 'add_opening' }>): Step {
  const type = readType(c);
  checkTypeFields(c, type);
  const spec: Spec = { required: { type: openingType, wallId: 'id', offset: 'number', width: 'number' }, optional: { id: 'id', name: 'string', ...TYPE_FIELDS[type] } };
  if (type === 'door') spec.required = { ...spec.required, hinge, swing };
  readFields(c, spec);
  const wall = findWall(plan, c.wallId);
  const { id, notes } = newId(plan.openings, c.id, type, 'openings');
  const base = { id, wallId: wall.id, offset: c.offset, width: c.width, ...(c.name !== undefined ? { name: c.name } : {}) };
  // Heights that are left out get the A2 defaults, the same as the validator gives an imported plan.
  const opening: OpeningV2 = c.type === 'window' ? { ...base, type: 'window', sill: c.sill ?? DEFAULT_HEIGHTS.windowSill, head: c.head ?? DEFAULT_HEIGHTS.windowHead }
    : c.type === 'door' ? { ...base, type: 'door', hinge: c.hinge, swing: c.swing, head: c.head ?? DEFAULT_HEIGHTS.head, ...(c.entry !== undefined ? { entry: c.entry } : {}) }
    : { ...base, type: c.type, head: c.head ?? DEFAULT_HEIGHTS.head };
  checkOpening(plan, opening, wall, 'offset');
  return { plan: { ...plan, openings: [...plan.openings, opening] }, notes };
}

function updateOpening(plan: PlanV2, c: Extract<OpeningCommand, { op: 'update_opening' }>): Step {
  readFields(c, {
    required: { openingId: 'id' }, optional: { name: 'string', entry: 'boolean', sill: 'number', head: 'number', hinge, swing },
    use: { wallId: ['move_opening'], offset: ['move_opening'], width: ['resize_opening'], type: ['change_opening_type'], id: [] },
  });
  const opening = findOpening(plan, c.openingId);
  checkTypeFields(c, opening.type);
  const { op: _op, openingId: _id, ...changes } = c;
  const next = { ...opening, ...changes } as OpeningV2;
  checkHeights(next, plan.ceilingHeight);
  return { plan: replaceOpening(plan, next) };
}

function deleteOpening(plan: PlanV2, c: Extract<OpeningCommand, { op: 'delete_opening' }>): Step {
  readFields(c, { required: { openingId: 'id' } });
  const opening = findOpening(plan, c.openingId);
  return { plan: { ...plan, openings: plan.openings.filter(o => o.id !== opening.id) } };
}

function moveOpening(plan: PlanV2, c: Extract<OpeningCommand, { op: 'move_opening' }>): Step {
  readFields(c, { required: { openingId: 'id', offset: 'number' }, optional: { wallId: 'id' } });
  const opening = findOpening(plan, c.openingId), wall = findWall(plan, c.wallId ?? opening.wallId);
  const next = { ...opening, wallId: wall.id, offset: c.offset };
  checkOpening(plan, next, wall, 'offset');
  return { plan: replaceOpening(plan, next) };
}

function resizeOpening(plan: PlanV2, c: Extract<OpeningCommand, { op: 'resize_opening' }>): Step {
  readFields(c, { required: { openingId: 'id', width: 'number' }, optional: { keep: { enum: ['start', 'end'] } } });
  const opening = findOpening(plan, c.openingId), wall = findWall(plan, opening.wallId);
  // `keep: 'end'` keeps the end edge in place, so the start moves by the change in width.
  const offset = c.keep === 'end' ? cleanLength(opening.offset + opening.width - c.width) : opening.offset;
  const next = { ...opening, offset, width: c.width };
  checkOpening(plan, next, wall, 'width');
  return { plan: replaceOpening(plan, next) };
}

function changeOpeningType(plan: PlanV2, c: Extract<OpeningCommand, { op: 'change_opening_type' }>): Step {
  const type = readType(c);
  checkTypeFields(c, type);
  const fields = TYPE_FIELDS[type], required = Object.fromEntries(Object.entries(fields).filter(([key]) => key !== 'entry'));
  readFields(c, { required: { openingId: 'id', type: openingType, ...required }, optional: type === 'door' ? { entry: 'boolean' } : {} });
  const opening = findOpening(plan, c.openingId), wall = findWall(plan, opening.wallId);
  if (opening.type === type) refuse('type', 'opening-type-unchanged', { type });
  // Only the fields of the new type are kept: the old type's sill, hinge, swing and entry are removed.
  const { op: _op, openingId: _id, ...given } = c;
  const next = { id: opening.id, wallId: opening.wallId, offset: opening.offset, width: opening.width, ...(opening.name !== undefined ? { name: opening.name } : {}), ...given } as OpeningV2;
  checkOpening(plan, next, wall, 'type');
  return { plan: replaceOpening(plan, next) };
}

export const OPENING_COMMANDS = {
  add_opening: addOpening, update_opening: updateOpening, delete_opening: deleteOpening,
  move_opening: moveOpening, resize_opening: resizeOpening, change_opening_type: changeOpeningType,
} as const;
