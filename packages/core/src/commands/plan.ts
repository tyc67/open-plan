import { annotationReport } from '../bounds.js';
import { CEILING_MAX, CEILING_MIN } from '../heights.js';
import type { DimensionChain, Material, PlanV2 } from '../types.js';
import { PLAN_LIMITS } from '../validate.js';
import type { PlanCommand } from './types.js';
import { readFields, refuse, type Step } from './support.js';

function setPlanName(plan: PlanV2, c: Extract<PlanCommand, { op: 'set_plan_name' }>): Step {
  readFields(c, { required: { name: 'string' } });
  return { plan: { ...plan, name: c.name } };
}

/** Creates or replaces one material by its key. Rooms refer to it by the key, so they keep using it. */
function setMaterial(plan: PlanV2, c: Extract<PlanCommand, { op: 'set_material' }>): Step {
  readFields(c, { required: { key: 'id', name: 'string', sw: 'string' }, optional: { price: 'number' } });
  if (c.price !== undefined && c.price < 0) refuse('price', 'value-out-of-range', { min: 0, value: c.price });
  const material: Material = { name: c.name, sw: c.sw, ...(c.price !== undefined ? { price: c.price } : {}) };
  const replaced = Object.hasOwn(plan.materials, c.key);
  return { plan: { ...plan, materials: { ...plan.materials, [c.key]: material } }, notes: [{ code: replaced ? 'material-replaced' : 'material-created', params: { key: c.key } }] };
}

/**
 * The ceiling of the whole plan. No opening head may end up further above it than before (the Step C follow-up rule
 * for existing issues, as in `checkHeights`): a head that is already above the ceiling does not block a ceiling that
 * comes closer to it, but a lower ceiling under it, or under a head that was below it, is refused.
 */
function setCeilingHeight(plan: PlanV2, c: Extract<PlanCommand, { op: 'set_ceiling_height' }>): Step {
  readFields(c, { required: { ceilingHeight: 'number' } });
  if (c.ceilingHeight < CEILING_MIN || c.ceilingHeight > CEILING_MAX) refuse('ceilingHeight', 'height-out-of-range', { min: CEILING_MIN, max: CEILING_MAX, value: c.ceilingHeight });
  const above = plan.openings.find(o => o.head > c.ceilingHeight && o.head - c.ceilingHeight > Math.max(0, o.head - plan.ceilingHeight));
  if (above) refuse('ceilingHeight', 'opening-head-above-ceiling', { openingId: above.id, head: above.head, use: ['update_opening'] });
  return { plan: { ...plan, ceilingHeight: c.ceilingHeight } };
}

const CHAIN_FIELDS = ['horizontal', 'at', 'start', 'segments'];
/** A chain stays within this distance of the origin, in mm: 10 times the largest plan. Far values break the drawing. */
export const DIMENSION_REACH = PLAN_LIMITS.size * 10;

/**
 * Replaces all dimension chains. A chain has no id, so the whole list is the unit: an agent reads the chains, changes
 * the list and sends it. The validator accepts any numbers in a chain; a command is strict, because a chain with no
 * segment or with a length of 0 or less draws nothing useful, and a chain that is very far away breaks the view.
 * The lists are read by index and the fields as own properties: a list with a hole or an inherited field is refused.
 */
function setDimensions(plan: PlanV2, c: Extract<PlanCommand, { op: 'set_dimensions' }>): Step {
  const input = c as { dimensions?: unknown };
  for (const key of Object.keys(input)) if (key !== 'op' && key !== 'dimensions') refuse(key, 'command-field-unknown', { field: key, allowed: ['dimensions'] });
  if (!Object.hasOwn(input, 'dimensions') || input.dimensions === undefined) refuse('dimensions', 'missing-field', { expected: 'list of chains' });
  if (!Array.isArray(input.dimensions)) refuse('dimensions', 'type-invalid', { expected: 'list of chains' });
  const list = input.dimensions as unknown[], dimensions: DimensionChain[] = [];
  const inReach = (value: number, path: string) => { if (Math.abs(value) > DIMENSION_REACH) refuse(path, 'value-out-of-range', { min: -DIMENSION_REACH, max: DIMENSION_REACH, value }); };
  for (let index = 0; index < list.length; index++) {
    const at = `dimensions[${index}]`, chain = list[index];
    if (!chain || typeof chain !== 'object' || Array.isArray(chain)) refuse(at, 'type-invalid', { expected: 'object' });
    const d = chain as Record<string, unknown>;
    for (const key of Object.keys(d)) if (!CHAIN_FIELDS.includes(key)) refuse(`${at}.${key}`, 'command-field-unknown', { field: key, allowed: CHAIN_FIELDS });
    for (const key of CHAIN_FIELDS) if (!Object.hasOwn(d, key) || d[key] === undefined) refuse(`${at}.${key}`, 'missing-field', { expected: key === 'horizontal' ? 'boolean' : key === 'segments' ? 'list of numbers' : 'number' });
    if (typeof d.horizontal !== 'boolean') refuse(`${at}.horizontal`, 'type-invalid', { expected: 'boolean' });
    for (const key of ['at', 'start']) { if (!Number.isFinite(d[key])) refuse(`${at}.${key}`, 'type-invalid', { expected: 'number' }); inReach(d[key] as number, `${at}.${key}`); }
    if (!Array.isArray(d.segments)) refuse(`${at}.segments`, 'type-invalid', { expected: 'list of numbers' });
    const given = d.segments as unknown[], segments: number[] = [];
    if (!given.length) refuse(`${at}.segments`, 'dimension-no-segments');
    let end = d.start as number;
    for (let k = 0; k < given.length; k++) {
      const s = given[k];
      if (!Number.isFinite(s)) refuse(`${at}.segments[${k}]`, 'type-invalid', { expected: 'number' });
      if (!((s as number) > 0)) refuse(`${at}.segments[${k}]`, 'size-not-positive', { value: s });
      end += s as number;
      inReach(end, `${at}.segments[${k}]`);                       // the end of this segment
      segments.push(s as number);
    }
    dimensions.push({ horizontal: d.horizontal as boolean, at: d.at as number, start: d.start as number, segments });
  }
  // A new chain must not be at the far level of the validator (a strict check would refuse the file). Measurements
  // are left out here, so an old measurement of the plan cannot make the new chains wrong.
  const far = annotationReport({ ...plan, measurements: [], dimensions }).find(r => r.level === 'far');
  if (far) refuse(far.index === null ? 'dimensions' : `dimensions[${far.index}]`, 'annotation-out-of-range', { distance: far.distance, limit: far.limit, finite: far.drawable, all: far.index === null });
  return { plan: { ...plan, dimensions }, notes: [{ code: 'dimensions-set', params: { before: plan.dimensions?.length ?? 0, after: dimensions.length } }] };
}

export const PLAN_COMMANDS = { set_plan_name: setPlanName, set_material: setMaterial, set_ceiling_height: setCeilingHeight, set_dimensions: setDimensions } as const;
