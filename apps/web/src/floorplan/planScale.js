import { applyCommands, summarizePlan, unitFactor } from 'open-plan-core';

// Plan scaling in the editor (roadmap D3): the two points are the ends of a measurement, and the user types the real
// distance between them. The plan changes only through the core command `scale_plan`, so the editor, the CLI and MCP
// follow the same rules (which fields scale, rounding, and a result with errors is refused).

/** A factor outside this range is probably a wrong unit; it gets a warning, not a refusal. */
export const UNUSUAL_FACTOR = { min: 0.5, max: 2 };
/** A measurement shorter than this gives a scale that is not reliable (the measure tool does not make one this short). */
export const SHORT_MEASUREMENT = 20;
const SAME_LENGTH = 0.05;

/**
 * Labels of history steps that a plan cannot show by itself (a scaled plan looks like many moves). A label is for the
 * step from `before` to `plan`, not for the plan: a later restore of that plan from the history is a different step.
 */
const changeLabels = new WeakMap();
export const changeLabel = (before, plan) => { const entry = changeLabels.get(plan); return entry && entry.before === before ? entry.label : null; };
export const labelChange = (plan, label, before) => { changeLabels.set(plan, { before, label }); return plan; };
export const SCALE_LABEL = '調整平面圖比例';

/** The typed distance in mm, or null: a finite number above 0 in the display unit; decimals are kept. */
export function parseDistance(text, unit) {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '' || !/^\d*\.?\d+$|^\d+\.?$/.test(trimmed)) return null;
  const value = Number(trimmed) * unitFactor(unit);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const length = m => Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);

/**
 * What a scaling would do, with no change to the plan. `status`: 'missing' (the measurement is not in the plan),
 * 'zero' (its two points are the same), 'input' (no valid distance yet), 'same' (the distance is the measured one),
 * 'refused' (the result has errors: `errors`), or 'ok' (`plan`, `warnings`). With a distance: `factor`, and the plan
 * size before and after in metres (`width`, `depth`). A refusal has the issues of the result in `errors[0].params.issues`.
 */
export function scalePreview(plan, measurementId, distance) {
  const measurement = (plan.measurements || []).find(m => m.id === measurementId);
  if (!measurement) return { status: 'missing' };
  const measured = length(measurement);
  if (!(measured > 0)) return { status: 'zero', measured };
  const notes = measured < SHORT_MEASUREMENT ? ['short-measurement'] : [];
  if (distance === null || distance === undefined) return { status: 'input', measured, notes };
  const factor = distance / measured, size = p => { const s = summarizePlan(p); return { width: s.width, depth: s.depth }; };
  if (factor < UNUSUAL_FACTOR.min || factor > UNUSUAL_FACTOR.max) notes.push('unusual-factor');
  const before = size(plan);
  // A distance less than 0.05 mm from the measured length is the measured length: plan values are rounded to 0.1 mm,
  // so the command would only round the plan, which is not a scaling.
  if (Math.abs(distance - measured) < SAME_LENGTH) return { status: 'same', measured, factor, before, notes };
  const result = applyCommands(plan, [{ op: 'scale_plan', a: [measurement.a.x, measurement.a.y], b: [measurement.b.x, measurement.b.y], distance }]);
  if (!result.ok) return { status: 'refused', measured, factor, before, notes, errors: result.errors };
  if (JSON.stringify(result.plan) === JSON.stringify(plan)) return { status: 'same', measured, factor, before, notes };
  return { status: 'ok', measured, factor, before, after: size(result.plan), notes, plan: result.plan, warnings: result.warnings.filter(w => w.commandIndex !== undefined) };
}
