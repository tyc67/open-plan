import { CEILING_MAX, CEILING_MIN } from '../heights.js';
import type { Material, PlanV2 } from '../types.js';
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

export const PLAN_COMMANDS = { set_plan_name: setPlanName, set_material: setMaterial, set_ceiling_height: setCeilingHeight } as const;
