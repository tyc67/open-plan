import { describe, expect, it } from 'vitest';
import { EMPTY_PLAN_AREA, contentBounds, fitBounds, migrateV1, physicalBounds, summarizePlan } from '../src/index.js';
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
