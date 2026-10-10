import { describe, expect, it } from 'vitest';
import { applyCommands, createSamplePlan } from 'open-plan-core';
import { changeLabel, labelChange, parseDistance, scalePreview, SCALE_LABEL } from '../src/floorplan/planScale.js';

// Plan scaling in the editor (roadmap D3): the editor sends the two ends of a measurement and the typed distance to
// the core command `scale_plan`, and shows what it would do before the plan changes.
const plan = () => ({ ...createSamplePlan(), measurements: [{ id: 'm1', a: { x: 0, y: 0 }, b: { x: 3000, y: 4000 } }, { id: 'zero', a: { x: 5, y: 5 }, b: { x: 5, y: 5 } }, { id: 'short', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }] });
const fixed = f => ({ w: f.w, d: f.d, rot: f.rot });

describe('plan scaling in the editor', () => {
  it('the typed distance: a positive number in the display unit, with decimals; anything else is no distance', () => {
    expect([parseDistance('5500', 'mm'), parseDistance('550', 'cm'), parseDistance('550.25', 'cm'), parseDistance(' 12.5 ', 'mm'), parseDistance('.5', 'mm')]).toEqual([5500, 5500, 5502.5, 12.5, 0.5]);
    for (const text of ['', '  ', '0', '-5', 'abc', '1e3', '5,5', 'Infinity', '1.2.3', null, undefined]) expect(parseDistance(text, 'mm'), String(text)).toBeNull();
  });
  it('the preview is exactly the result of the core command for the two ends and the distance, and it does not change the plan', () => {
    const p = plan(), text = JSON.stringify(p);
    const preview = scalePreview(p, 'm1', 5500);                                 // the measurement is 5000 long
    const direct = applyCommands(p, [{ op: 'scale_plan', a: [0, 0], b: [3000, 4000], distance: 5500 }]);
    expect([preview.status, preview.factor, preview.measured, JSON.stringify(p)]).toEqual(['ok', 1.1, 5000, text]);
    expect(direct.ok && preview.plan).toEqual(direct.ok && direct.plan);
    expect(preview.plan.furniture.map(fixed)).toEqual(p.furniture.map(fixed));    // furniture keeps its size
    expect(preview.plan.walls[0].thickness).toBeCloseTo(p.walls[0].thickness * 1.1, 1);
    const m = preview.plan.measurements[0];                                       // the measurement now shows the typed distance (0.1 mm rounding)
    expect(Math.abs(Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y) - 5500)).toBeLessThanOrEqual(0.15);
    expect([preview.after.width / preview.before.width, preview.after.depth / preview.before.depth].every(r => Math.abs(r - 1.1) < 0.001)).toBe(true);
  });
  it('no distance yet, the same distance, a missing or zero-length measurement, and a short one', () => {
    const p = plan();
    expect(scalePreview(p, 'm1', null)).toMatchObject({ status: 'input', measured: 5000, notes: [] });
    expect(scalePreview(p, 'm1', 5000).status).toBe('same');
    // Less than 0.05 mm from the measured length is the measured length, also when the plan has values finer than 0.1 mm
    // (the command would round them, which is not a scaling).
    const fine = { ...p, measurements: p.measurements.map(m => m.id === 'm1' ? { ...m, b: { x: m.b.x + 0.04, y: m.b.y } } : m) };
    expect([scalePreview(fine, 'm1', 5000).status, scalePreview(p, 'm1', 5000.04).status, scalePreview(p, 'm1', 5000.4).status]).toEqual(['same', 'same', 'ok']);
    expect(scalePreview(p, 'gone', 5000).status).toBe('missing');
    expect(scalePreview(p, 'zero', 5000).status).toBe('zero');
    expect(scalePreview(p, 'short', 11).notes).toEqual(['short-measurement']);
  });
  it('a factor far from 1 gets a note, not a refusal; a result with errors is refused with its issues and gives no plan', () => {
    const p = plan();
    expect(scalePreview(p, 'm1', 10500)).toMatchObject({ status: 'ok', factor: 2.1, notes: ['unusual-factor'] });
    expect(scalePreview(p, 'm1', 2000).notes).toEqual(['unusual-factor']);
    const huge = scalePreview(p, 'm1', 5000 * 100);                               // far more than 100 × 100 m, and walls thicker than 1000
    expect([huge.status, huge.plan, huge.errors[0].code, huge.errors[0].params.issues.length > 0]).toEqual(['refused', undefined, 'scale-result-invalid', true]);
  });
  it('a history label belongs to one plan object', () => {
    // The label is for the step from `before` to the scaled plan; a restore of that plan from another plan has none.
    const before = { name: 'before' }, scaled = labelChange({ name: 'x' }, SCALE_LABEL, before);
    expect([changeLabel(before, scaled), changeLabel({ name: 'later' }, scaled), changeLabel(before, { name: 'x' })]).toEqual([SCALE_LABEL, null, null]);
  });
});
