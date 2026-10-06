import { describe, expect, it } from 'vitest';
import { PlanFormatError, checkPlanV2, migrateV1, planGeometry } from '../src/index.js';
import type { DoorV2, PlanV1, PlanV2 } from '../src/index.js';
import sampleJson from './fixtures/sample-v1.json' with { type: 'json' };

const sampleV1 = (): PlanV1 => JSON.parse(JSON.stringify(sampleJson));
const sampleV2 = (): PlanV2 => migrateV1(sampleV1()).plan;

describe('planGeometry on the migrated sample', () => {
  const v1 = sampleV1(), geometry = planGeometry(sampleV2());

  it('gives the v1 wall rects, in the v1 order, and no solid part for generated pieces', () => {
    expect(geometry.solids.map(s => [s.wallId, s.rect, s.type, s.demolished])).toEqual(v1.walls.map(w => [w.id, w.rect, w.type, !!w.demolished]));
  });

  it('gives every v1 opening with its v1 rect and door and sliding-door data, in the v1 order', () => {
    const shapes = geometry.openings.filter(o => o.type !== 'hole');
    expect(shapes.map(o => o.id)).toEqual(v1.openings.map(o => o.id));
    for (const [i, o] of v1.openings.entries()) {
      const shape = shapes[i]!;
      expect(shape.rect).toEqual(o.rect);
      if (o.type === 'door') expect([shape.h, shape.c, shape.o, shape.len, (shape as DoorV2).entry]).toEqual([o.h, o.c, o.o, o.len, o.entry]);
      if (o.type === 'sliding-door') expect(shape.v).toBe(o.v);
    }
  });

  it('has no negative zero in door directions', () => {
    for (const o of geometry.openings) for (const v of [...(o.c ?? []), ...(o.o ?? [])]) expect(Object.is(v, -0)).toBe(false);
  });

  it('adds the two bay-window holes after the v1 openings', () => {
    expect(geometry.openings.slice(-2).map(o => [o.type, o.rect])).toEqual([['hole', [10270, 800, 10510, 2600]], ['hole', [10270, 4260, 10510, 5740]]]);
  });

  it('reuses the result while walls and openings are the same arrays', () => {
    const plan = sampleV2();
    expect(planGeometry({ ...plan, furniture: [] })).toBe(planGeometry(plan));
    expect(planGeometry({ ...plan, openings: [...plan.openings] })).not.toBe(planGeometry(plan));
  });
});

describe('planGeometry on continuous walls', () => {
  const plan = (): PlanV2 => ({
    ...sampleV2(), rooms: [], furniture: [],
    walls: [{ id: 'w1', type: 'e', a: [0, 100], b: [8000, 100], thickness: 200 }],
    openings: [
      { id: 'win1', type: 'window', wallId: 'w1', offset: 500, width: 1200, sill: 900, head: 2400 },
      { id: 'd1', type: 'door', wallId: 'w1', offset: 2200, width: 900, hinge: 'start', swing: 'right', head: 2100 },
      { id: 's1', type: 'sliding-door', wallId: 'w1', offset: 3600, width: 1600, head: 2100 },
      { id: 'h1', type: 'hole', wallId: 'w1', offset: 5800, width: 1200, head: 2400 },
    ],
  });

  it('cuts the wall at each opening', () => {
    expect(planGeometry(plan()).solids.map(s => s.rect)).toEqual([[0, 0, 500, 200], [1700, 0, 2200, 200], [3100, 0, 3600, 200], [5200, 0, 5800, 200], [7000, 0, 8000, 200]]);
  });

  it('puts the door hinge on the swing-side face', () => {
    const door = planGeometry(plan()).openings.find(o => o.id === 'd1')!;
    expect([door.h, door.c, door.o]).toEqual([[2200, 200], [1, 0], [0, 1]]);
  });

  it('gives each opening the type of its wall', () => {
    const p = plan();
    expect(planGeometry(p).openings.map(o => o.wallType)).toEqual(['e', 'e', 'e', 'e']);
    p.walls[0]!.type = 'low';
    expect(planGeometry({ ...p, walls: [...p.walls] }).openings.map(o => o.wallType)).toEqual(['low', 'low', 'low', 'low']);
  });

  it('draws a demolished wall whole and hides its openings', () => {
    const p = plan();
    p.walls[0]!.demolished = true;
    const geometry = planGeometry(p);
    expect(geometry.solids).toEqual([{ wallId: 'w1', type: 'e', rect: [0, 0, 8000, 200], demolished: true }]);
    expect(geometry.openings).toEqual([]);
  });
});

describe('checkPlanV2', () => {
  it('accepts the migrated sample', () => expect(() => checkPlanV2(sampleV2())).not.toThrow());

  const expectError = (change: (plan: any) => void, code: string, path: string) => {
    const plan = sampleV2();
    change(plan);
    let error: unknown;
    try { checkPlanV2(plan); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(PlanFormatError);
    expect(error).toMatchObject({ code, path });
  };
  it('rejects a missing wall reference', () => expectError(p => { p.openings[0].wallId = 'nope'; }, 'wall-missing', 'openings[0].wallId'));
  it('rejects an opening past the wall end', () => expectError(p => { p.openings[0].width += 1; }, 'opening-outside-wall', 'openings[0].width'));
  it('rejects a diagonal wall', () => expectError(p => { p.walls[0].b = [p.walls[0].b[0] + 1, p.walls[0].b[1] + 1]; }, 'wall-not-axis-aligned', 'walls[0]'));
  it('rejects a thickness out of range', () => expectError(p => { p.walls[0].thickness = 5; }, 'thickness-out-of-range', 'walls[0].thickness'));
  it('rejects a window without a sill', () => expectError(p => { delete p.openings[0].sill; }, 'height-invalid', 'openings[0].sill'));
  it('rejects an unknown door swing', () => expectError(p => { p.openings[12].swing = 'up'; }, 'door-swing-invalid', 'openings[12].swing'));
  it('rejects duplicate opening ids', () => expectError(p => { p.openings[1].id = p.openings[0].id; }, 'id-duplicate', 'openings[1].id'));
});
