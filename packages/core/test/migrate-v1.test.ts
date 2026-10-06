import { describe, expect, it } from 'vitest';
import { MigrationError, hingePoint, migrateV1, openingRect, wallRect } from '../src/index.js';
import type { DoorV2, OpeningV1, PlanV1, PlanV2, Rect } from '../src/index.js';
import sampleJson from './fixtures/sample-v1.json' with { type: 'json' };

// The sample apartment as the current editor creates it (schema v1), with fixed ids.
// A fresh copy for each use, so a test can change it.
const sample = (): PlanV1 => JSON.parse(JSON.stringify(sampleJson));
const wallById = (plan: PlanV2, id: string) => plan.walls.find(w => w.id === id)!;
const codes = (report: { code: string }[]) => report.map(r => r.code);

describe('migrateV1 on the sample', () => {
  const v1 = sample();
  const { plan, report } = migrateV1(v1);

  it('makes a v2 plan and does not change the input', () => {
    expect(plan.schemaVersion).toBe(2);
    expect(plan.ceilingHeight).toBe(2800);
    expect(v1).toEqual(sample());
  });

  it('keeps every v1 wall rect, id, type and demolition state', () => {
    for (const w of v1.walls) {
      const v2 = wallById(plan, w.id);
      expect(wallRect(v2)).toEqual(w.rect);
      expect(v2.type).toBe(w.type);
      expect(!!v2.demolished).toBe(!!w.demolished);
    }
  });

  it('keeps every v1 opening rect, each in its own new wall piece that it fills', () => {
    const v1Ids = new Set(v1.walls.map(w => w.id));
    for (const o of v1.openings) {
      const v2 = plan.openings.find(x => x.id === o.id)!;
      const piece = wallById(plan, v2.wallId);
      expect(v1Ids.has(piece.id)).toBe(false);
      expect(v2.offset).toBe(0);
      expect(wallRect(piece)).toEqual(o.rect);
      expect(openingRect(v2, piece)).toEqual(o.rect);
      expect(piece.demolished).toBeUndefined();
    }
  });

  it('gives back the v1 hinge point and swing for all 6 doors', () => {
    const doors = v1.openings.filter((o): o is Extract<OpeningV1, { type: 'door' }> => o.type === 'door');
    expect(doors).toHaveLength(6);
    for (const d of doors) {
      const v2 = plan.openings.find(x => x.id === d.id) as DoorV2;
      const piece = wallById(plan, v2.wallId);
      expect(hingePoint(v2, piece)).toEqual(d.h);
      expect(v2.width).toBe(d.len);
      expect(v2.name).toBe(d.name);
    }
    expect((plan.openings.find(o => o.id === 'door-5') as DoorV2).entry).toBe(true);
    expect(report.some(r => r.code.startsWith('door-'))).toBe(false);
  });

  it('gives generated pieces the type from the rule', () => {
    const typeOf = (openingId: string) => wallById(plan, plan.openings.find(o => o.id === openingId)!.wallId).type;
    expect(typeOf('window-0')).toBe('e');
    expect(typeOf('door-0')).toBe('n');
    expect(typeOf('door-5')).toBe('e');
    expect(typeOf('slide-0')).toBe('b');
    expect(typeOf('slide-1')).toBe('n'); // low and n disagree: full-height type first
    expect(typeOf('door-4')).toBe('b'); // b and n disagree
    expect(typeOf('window-7')).toBe('n'); // bay-window glass side: no touching wall
    expect(report.filter(r => r.code === 'opening-wall-created')).toHaveLength(22);
  });

  it('stores the heights that the v1 renderer used', () => {
    const heights = Object.fromEntries(plan.openings.map(o => [o.id, o.type === 'window' ? [o.sill, o.head] : [o.head]]));
    expect(heights['window-0']).toEqual([1400, 2400]);
    for (const i of [1, 2, 3, 4, 5]) expect(heights[`window-${i}`]).toEqual([900, 2400]);
    for (const i of [6, 7, 8, 9, 10, 11]) expect(heights[`window-${i}`]).toEqual([450, 2400]);
    for (const i of [0, 1, 2, 3, 4, 5]) expect(heights[`door-${i}`]).toEqual([2100]);
    expect(heights['slide-0']).toEqual([2400]); // vertical
    expect(heights['slide-1']).toEqual([2100]); // horizontal
  });

  it('creates the two sample bay-window holes', () => {
    const holes = plan.openings.filter(o => o.type === 'hole');
    expect(holes.map(h => openingRect(h, wallById(plan, h.wallId)))).toEqual([[10270, 800, 10510, 2600], [10270, 4260, 10510, 5740]]);
    expect(holes.map(h => h.type === 'hole' && h.head)).toEqual([2400, 2400]);
    expect(holes.map(h => wallById(plan, h.wallId).type)).toEqual(['e', 'b']);
    expect(codes(report).filter(c => c === 'sample-bay-hole-created')).toHaveLength(2);
  });

  it('copies rooms, materials, furniture, measurements and dimensions unchanged', () => {
    for (const key of ['id', 'name', 'units', 'locale', 'rooms', 'materials', 'furniture', 'measurements', 'dimensions'] as const) expect(plan[key]).toEqual(v1[key]);
  });
});

describe('migrateV1 guards and reports', () => {
  it('adds no bay-window holes when a wall overlaps a gap', () => {
    const v1 = sample();
    v1.walls.push({ id: 'extra', type: 'n', rect: [10300, 1000, 10400, 1100] });
    const { plan, report } = migrateV1(v1);
    expect(plan.openings.some(o => o.type === 'hole')).toBe(false);
    expect(codes(report)).toContain('sample-bay-holes-skipped');
  });

  it('adds no bay-window holes when an opening overlaps a gap', () => {
    const v1 = sample();
    v1.openings.push({ id: 'extra-window', type: 'window', rect: [10270, 2000, 10510, 2100] });
    expect(migrateV1(v1).plan.openings.some(o => o.type === 'hole')).toBe(false);
  });

  it('adds no bay-window holes to a plan without the sample walls', () => {
    const v1 = sample();
    v1.walls = v1.walls.filter(w => !(w.rect[0] === 10270 && w.rect[1] === 300));
    const { plan, report } = migrateV1(v1);
    expect(plan.openings.some(o => o.type === 'hole')).toBe(false);
    expect(codes(report)).toContain('sample-bay-holes-not-applicable');
  });

  it('reports a demolished wall next to an opening and keeps the piece standing', () => {
    const v1 = sample();
    const neighbour = v1.walls.find(w => w.rect.join() === [4580, 0, 4820, 2400].join())!;
    neighbour.demolished = true;
    const { plan, report } = migrateV1(v1);
    expect(report).toContainEqual(expect.objectContaining({ code: 'neighbour-demolished', openingId: 'door-0', wallId: neighbour.id }));
    expect(wallById(plan, plan.openings.find(o => o.id === 'door-0')!.wallId).demolished).toBeUndefined();
  });

  it('reports a door whose closed direction does not match its hinge', () => {
    const v1 = sample();
    const door = v1.openings.find(o => o.id === 'door-0') as Extract<OpeningV1, { type: 'door' }>;
    door.c = [0, 1];
    expect(codes(migrateV1(v1).report)).toContain('door-closed-direction');
  });

  it('gives a piece between two low walls the low type and reports it', () => {
    const v1: PlanV1 = { ...sample(), walls: [{ id: 'l1', type: 'low', rect: [0, 0, 1000, 200] }, { id: 'l2', type: 'low', rect: [2000, 0, 3000, 200] }], openings: [{ id: 's', type: 'sliding-door', rect: [1000, 0, 2000, 200] as Rect }] };
    const { plan, report } = migrateV1(v1);
    expect(wallById(plan, plan.openings[0]!.wallId).type).toBe('low');
    expect(codes(report)).toContain('opening-wall-low');
  });

  it('keeps generated wall ids unique', () => {
    const v1 = sample();
    v1.walls.push({ id: 'door-0--wall', type: 'n', rect: [-5000, -5000, -4000, -4800] });
    const ids = migrateV1(v1).plan.walls.map(w => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('migrateV1 ids', () => {
  it('keeps generated opening ids unique when the plan already uses the hole ids', () => {
    const v1 = sample();
    v1.openings.push({ id: 'bay-hole-1', type: 'window', rect: [-9000, 0, -8000, 200] }, { id: 'bay-hole-1-2', type: 'window', rect: [-7000, 0, -6000, 200] });
    const ids = migrateV1(v1).plan.openings.map(o => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('bay-hole-1-3');
  });
});

describe('checkPlanV1', () => {
  const expectError = (change: (plan: any) => void, code: string, path: string) => {
    const plan = sample();
    change(plan);
    let error: unknown;
    try { migrateV1(plan); } catch (e) { error = e; }
    expect(error).toBeInstanceOf(MigrationError);
    expect(error).toMatchObject({ code, path });
  };

  it('rejects an opening type that the migration cannot read', () => expectError(p => { p.openings[0].type = 'archway'; }, 'opening-type-unknown', 'openings[0].type'));
  it('rejects a door without its hinge data', () => expectError(p => { delete p.openings.find((o: any) => o.type === 'door').h; }, 'door-field-missing', 'openings[12].h'));
  it('rejects a door with a zero leaf length', () => expectError(p => { p.openings[12].len = 0; }, 'door-field-missing', 'openings[12].len'));
  it('rejects a reversed rect', () => expectError(p => { p.walls[0].rect = [100, 0, 0, 200]; }, 'rect-empty-or-reversed', 'walls[0].rect'));
  it('rejects duplicate wall ids', () => expectError(p => { p.walls[1].id = p.walls[0].id; }, 'id-duplicate', 'walls[1].id'));
  it('rejects duplicate opening ids', () => expectError(p => { p.openings[1].id = p.openings[0].id; }, 'id-duplicate', 'openings[1].id'));
  it('rejects a plan that is not v1', () => expectError(p => { p.schemaVersion = 2; }, 'schema-version', 'schemaVersion'));
  it('rejects input that is not an object', () => {
    expect(() => migrateV1(null)).toThrow(MigrationError);
    expect(() => migrateV1([])).toThrow(MigrationError);
  });
});
