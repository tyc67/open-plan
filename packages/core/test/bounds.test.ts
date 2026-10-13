import { describe, expect, it } from 'vitest';
import { EMPTY_PLAN_AREA, annotationReport, contentBounds, drawableAnnotations, fitBounds, migrateV1, physicalBounds, renderPlanSvg, summarizePlan, validatePlan } from '../src/index.js';
import type { PlanV1, PlanV2 } from '../src/index.js';
import sampleJson from './fixtures/sample-v1.json' with { type: 'json' };

const sample = (): PlanV2 => migrateV1(JSON.parse(JSON.stringify(sampleJson)) as PlanV1).plan;
const empty = (): PlanV2 => ({ ...sample(), walls: [], openings: [], rooms: [], furniture: [], measurements: [], dimensions: [] });

/** Moves every coordinate of a plan by (dx, dy). */
function translate(plan: PlanV2, dx: number, dy: number): PlanV2 {
  const p: any = JSON.parse(JSON.stringify(plan));
  for (const w of p.walls) { w.a = [w.a[0] + dx, w.a[1] + dy]; w.b = [w.b[0] + dx, w.b[1] + dy]; }
  for (const r of p.rooms) { r.poly = r.poly.map(([x, y]: number[]) => [x + dx, y + dy]); if (r.at) r.at = [r.at[0] + dx, r.at[1] + dy]; }
  for (const f of p.furniture) { f.cx += dx; f.cy += dy; }
  for (const m of p.measurements ?? []) { m.a = { x: m.a.x + dx, y: m.a.y + dy }; m.b = { x: m.b.x + dx, y: m.b.y + dy }; }
  for (const c of p.dimensions ?? []) { c.at += c.horizontal ? dy : dx; c.start += c.horizontal ? dx : dy; }
  return p;
}

describe('bounds of the sample', () => {
  it('uses walls, rooms and furniture for physical bounds', () => expect(physicalBounds(sample())).toEqual([-240, -240, 12090, 10800]));
  it('adds dimension chains for content bounds', () => expect(contentBounds(sample())).toEqual([-1300, -1250, 13250, 11850]));
  it('adds 10% of each axis on each side for the 2D fit', () => {
    const [x0, y0, x1, y1] = fitBounds(sample());
    expect([x0, y0, x1 - x0, y1 - y0]).toEqual([-2755, -2560, 17460, 15720]);
  });
});

describe('bounds rules', () => {
  it('uses 500 mm when 10% is smaller', () => {
    const p = { ...empty(), walls: [{ id: 'w', type: 'e' as const, a: [0, 100] as [number, number], b: [3000, 100] as [number, number], thickness: 200 }] };
    expect(fitBounds(p)).toEqual([-500, -500, 3500, 700]);
  });
  it('gives the 10 × 8 m default for an empty plan', () => {
    expect(physicalBounds(empty())).toBeNull();
    expect(contentBounds(empty())).toBeNull();
    expect(fitBounds(empty())).toEqual(EMPTY_PLAN_AREA);
  });
  it('uses the furniture of a furniture-only plan, with rotation', () => {
    const p = { ...empty(), furniture: [{ id: 'f', type: 'sofa', name: 's', cx: 1000, cy: 2000, w: 2000, d: 800, rot: 90 }] };
    const [x0, y0, x1, y1] = physicalBounds(p)!;
    expect([x0, y0, x1, y1].map(v => Math.round(v))).toEqual([600, 1000, 1400, 3000]);
  });
  it('moves exactly with the plan', () => {
    const moved = translate(sample(), 20000, 20000);
    const shift = (r: number[] | null) => r!.map(v => v + 20000);
    expect(physicalBounds(moved)).toEqual(shift(physicalBounds(sample())));
    expect(contentBounds(moved)).toEqual(shift(contentBounds(sample())));
    expect(fitBounds(moved)).toEqual(shift(fitBounds(sample())));
  });
});

export { translate };

describe('summarizePlan', () => {
  it('counts the items and gives the content size in metres', () => {
    const plan = sample();
    expect(summarizePlan(plan)).toEqual({ walls: plan.walls.length, openings: plan.openings.length, rooms: 13, furniture: 46, width: 14.55, depth: 13.1 });
  });
  it('gives a size of 0 for an empty plan', () => {
    expect(summarizePlan(empty())).toMatchObject({ walls: 0, furniture: 0, width: 0, depth: 0 });
  });
});

describe('annotations far from the plan', () => {
  // The sample is about 12 × 11 m: physical box [-240, -240, 12090, 10800], so the near limit is 20 m.
  const m = (ax: number, bx: number) => ({ id: 'm', a: { x: ax, y: 0 }, b: { x: bx, y: 0 } });
  const chain = (segments: number[], start = 0) => ({ horizontal: true, at: -600, start, segments });
  const levels = (plan: PlanV2) => annotationReport(plan).map(r => [r.list, r.index, r.level, r.drawable]);

  it('reports nothing for the sample and for an annotation within 20 m of the physical content', () => {
    expect(annotationReport(sample())).toEqual([]);
    expect(annotationReport({ ...sample(), measurements: [m(0, 12090 + 20_000)] })).toEqual([]);
  });
  it('reports the near level above 20 m and the far level above 100 m, with the distance', () => {
    expect(annotationReport({ ...sample(), measurements: [m(0, 12090 + 20_001)] })).toEqual([{ list: 'measurements', index: 0, level: 'near', drawable: true, distance: 20_001, limit: 20_000 }]);
    expect(levels({ ...sample(), measurements: [m(0, 12090 + 100_000)] })).toEqual([['measurements', 0, 'near', true]]);
    expect(annotationReport({ ...sample(), measurements: [m(0, 12090 + 100_001)] })).toEqual([{ list: 'measurements', index: 0, level: 'far', drawable: true, distance: 100_001, limit: 100_000 }]);
    expect(levels({ ...sample(), dimensions: [chain([3000]), chain([110_000])] })).toEqual([['dimensions', 1, 'near', true]]);
  });
  it('uses the longer side of the physical box as the near limit when it is more than 20 m', () => {
    const wide: PlanV2 = { ...empty(), walls: [{ id: 'w', type: 'e', a: [0, 0], b: [60_000, 0], thickness: 200 }] };
    expect(levels({ ...wide, measurements: [m(0, 60_000 + 50_000)] })).toEqual([]);
    expect(annotationReport({ ...wide, measurements: [m(0, 60_000 + 70_000)] })).toMatchObject([{ level: 'near', limit: 60_000 }]);
  });
  it('checks the end of each segment of a chain, not only the last end', () => {
    const back: PlanV2 = { ...sample(), dimensions: [chain([900_000, -900_000])] };
    expect(levels(back)).toEqual([['dimensions', 0, 'far', true]]);
    expect(contentBounds(back)).toEqual(physicalBounds(sample()));
  });
  it('an annotation with a value or a length that is not finite is at the far level and cannot be drawn', () => {
    const plan: PlanV2 = { ...sample(), measurements: [m(-1e308, 1e308), m(0, 1000)], dimensions: [chain([1e308, 1e308]), chain([3000])] };
    expect(levels(plan)).toEqual([['measurements', 0, 'far', false], ['dimensions', 0, 'far', false]]);
    expect(drawableAnnotations(plan)).toEqual({ measurements: [m(0, 1000)], dimensions: [chain([3000])] });
    expect(fitBounds(plan).every(Number.isFinite)).toBe(true);
    expect(renderPlanSvg(plan, { dimensions: true })).not.toMatch(/NaN|Infinity/);
  });
  it('the fit leaves out a reported annotation of both levels and keeps the others', () => {
    const near: PlanV2 = { ...sample(), measurements: [m(0, 12090 + 30_000)] }, far: PlanV2 = { ...sample(), dimensions: [...sample().dimensions!, chain([1e7])] };
    expect(contentBounds({ ...sample(), measurements: [m(0, 12090 + 5000)] })![2]).toBe(17090);
    expect(contentBounds(near)).toEqual(contentBounds(sample()));
    expect(fitBounds(far)).toEqual(fitBounds(sample()));
  });
  it('with no physical content: the box around all annotations is the rule, and the fit keeps what can be drawn', () => {
    expect(annotationReport({ ...empty(), measurements: [m(0, 100_000)], dimensions: [chain([5000])] })).toEqual([]);
    const large: PlanV2 = { ...empty(), measurements: [m(0, 100_001)], dimensions: [chain([5000])] };
    expect(annotationReport(large)).toEqual([
      { list: 'measurements', index: null, level: 'far', drawable: true, distance: 1, limit: 100_000 },
      { list: 'dimensions', index: null, level: 'far', drawable: true, distance: 1, limit: 100_000 },
    ]);
    // The report is about all annotations, so no annotation sets the view: the default area of an empty plan.
    expect([contentBounds(large), fitBounds(large)]).toEqual([null, EMPTY_PLAN_AREA]);
    expect(fitBounds({ ...empty(), measurements: [m(0, 200_000)] })).toEqual(EMPTY_PLAN_AREA);
    expect(contentBounds({ ...empty(), measurements: [m(0, 100_000)] })).toEqual([0, 0, 100_000, 0]);
    expect(levels({ ...empty(), dimensions: [chain([1e308, 1e308])] })).toEqual([['dimensions', 0, 'far', false]]);
    expect(fitBounds({ ...empty(), dimensions: [chain([1e308, 1e308])] })).toEqual(EMPTY_PLAN_AREA);
  });
  it('a value above the drawable limit cannot be drawn: the arithmetic of a drawing must stay finite (found in a review)', () => {
    // The start is finite and the length is 0, but a drawing multiplies its values.
    const plan: PlanV2 = { ...sample(), dimensions: [{ horizontal: true, at: -600, start: 1e308, segments: [0] }], measurements: [m(2e15, 2e15 + 1000)] };
    expect(levels(plan)).toEqual([['measurements', 0, 'far', false], ['dimensions', 0, 'far', false]]);
    expect(drawableAnnotations(plan)).toEqual({ measurements: [], dimensions: [] });
    expect(renderPlanSvg(plan, { dimensions: true })).not.toMatch(/NaN|Infinity/);
    // Two measurements very far from each other in a plan with no physical content: no view follows them.
    const apart: PlanV2 = { ...empty(), measurements: [m(-1e308, -1e308 + 1000), m(1e308 - 1000, 1e308)] };
    expect(fitBounds(apart)).toEqual(EMPTY_PLAN_AREA);
    const wide: PlanV2 = { ...empty(), measurements: [m(-1e15, -1e15 + 1000), m(1e15 - 1000, 1e15)] };
    expect([annotationReport(wide).map(r => r.index), fitBounds(wide)]).toEqual([[null], EMPTY_PLAN_AREA]);
  });
  it('physical content that is not finite gives the default area, not a view with no size', () => {
    const f = sample().furniture[0], plan: PlanV2 = { ...empty(), furniture: [{ ...f, cx: -1e308 }, { ...f, id: 'f2', cx: 1e308 }] };
    expect(contentBounds(plan)).toBe(null);
    expect(fitBounds(plan)).toEqual(EMPTY_PLAN_AREA);
  });
  it('a chain with very many segments does not stop the report (found in a review)', () => {
    const long: PlanV2 = { ...sample(), dimensions: [chain(Array(200_000).fill(0.05))] };
    expect(annotationReport(long)).toEqual([]);
    expect(validatePlan(long, 'import').ok).toBe(true);
    expect(fitBounds(long).every(Number.isFinite)).toBe(true);
    expect(levels({ ...sample(), dimensions: [chain(Array(200_000).fill(1))] })).toEqual([['dimensions', 0, 'far', true]]);
  });
  it('a plan moved as a whole gets the same report', () => {
    const plan: PlanV2 = { ...sample(), measurements: [m(0, 12090 + 30_000)] };
    expect(annotationReport(translate(plan, 5e6, -3e6)).map(r => [r.level, r.distance])).toEqual(annotationReport(plan).map(r => [r.level, r.distance]));
  });
});
