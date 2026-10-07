import { describe, expect, it } from 'vitest';
import {
  checkDocumentV1, containsPoint, correctLegacyRooms, createEmptyPlan, createId, createSamplePlan, createSamplePlanV1,
  LAUNDRY_POLYGON, localizeLegacyNames, migrateV1, migrateV1Document, roomArea, roomPerimeter, uniqueId, validatePlan,
} from '../src/index.js';
import sampleJson from './fixtures/sample-v1.json' with { type: 'json' };

const fixture = JSON.parse(JSON.stringify(sampleJson));
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('sample and empty plan (moved from the web app)', () => {
  it('the v1 sample is the stored fixture, except the fixed sample furniture ids', () => {
    const sample = createSamplePlanV1(fixture.id);
    const expected = copy(fixture);
    expected.furniture.forEach((f: { id: string }, i: number) => { f.id = `sample-f${i + 1}`; });
    expect(sample).toEqual(expected);
  });
  it('the v2 sample is the migrated v1 sample, and it is valid with no warning in either policy', () => {
    const plan = createSamplePlan('s');
    expect(plan).toEqual(migrateV1(createSamplePlanV1('s')).plan);
    for (const source of ['saved', 'import'] as const) {
      const result = validatePlan(plan, source);
      expect([result.ok, result.errors, result.warnings]).toEqual([true, [], []]);
    }
  });
  it('two samples differ only in the plan id; a given id is used', () => {
    const [a, b] = [createSamplePlan(), createSamplePlan()];
    expect(a.id).not.toBe(b.id);
    expect({ ...a, id: '' }).toEqual({ ...b, id: '' });
    expect(createSamplePlan('mine').id).toBe('mine');
  });
  it('a new sample is a new object: changing one does not change the next', () => {
    const a = createSamplePlan('a');
    a.rooms[0].poly[0][0] = -1; a.materials.wood.name = 'x'; a.dimensions![0].segments[0] = 0;
    const b = createSamplePlan('a');
    expect([b.rooms[0].poly[0][0], b.materials.wood.name, b.dimensions![0].segments[0]]).toEqual([6600, '橡木地板', 1580]);
  });
  it('the empty plan is valid, has no content, and has the sample materials', () => {
    const plan = createEmptyPlan('e');
    expect(validatePlan(plan, 'import').ok).toBe(true);
    expect([plan.walls, plan.openings, plan.rooms, plan.furniture]).toEqual([[], [], [], []]);
    expect(Object.keys(plan.materials)).toEqual(Object.keys(createSamplePlan().materials));
  });
});

describe('v1 path (moved from the web app)', () => {
  it('the fixture migrates with no room correction (its rooms are already corrected)', () => {
    const result = migrateV1Document(fixture);
    expect(result.ok).toBe(true);
    expect(result.report.filter(n => n.code === 'room-polygon-corrected')).toEqual([]);
  });
  it('the old laundry polygon is corrected while the bearing wall is there, and the correction is reported', () => {
    const old = copy(fixture);
    old.rooms.find((r: { id: string }) => r.id === 'laundry').poly = [[0, 3610], [2180, 3610], [2180, 4950], [0, 4950]];
    const result = migrateV1Document(old);
    if (!result.ok) throw new Error('not ok');
    expect(result.plan.rooms.find(r => r.id === 'laundry')!.poly).toEqual(LAUNDRY_POLYGON);
    expect(result.report[0]).toMatchObject({ code: 'room-polygon-corrected', roomId: 'laundry' });
  });
  it('the correction is guarded: with the bearing wall changed, the polygon stays and nothing is reported', () => {
    const old = copy(fixture);
    const original = [[0, 3610], [2180, 3610], [2180, 4950], [0, 4950]];
    old.rooms.find((r: { id: string }) => r.id === 'laundry').poly = original;
    old.walls.find((w: { rect: number[] }) => JSON.stringify(w.rect) === '[1580,3370,2420,3825]').type = 'n';
    const { doc, report } = correctLegacyRooms(old);
    expect(doc.rooms.find((r: any) => r.id === 'laundry')).toMatchObject({ poly: original });
    expect(report).toEqual([]);
  });
  it('old labels change to zh-TW; custom names and the input stay unchanged', () => {
    const doc = { furniture: [{ name: '双人床' }, { name: 'My bed' }], rooms: [], openings: [], materials: {} };
    const result = localizeLegacyNames(doc);
    expect(result.furniture.map(f => f.name)).toEqual(['雙人床', 'My bed']);
    expect(doc.furniture[0].name).toBe('双人床');
    expect((result as { locale?: string }).locale).toBe('zh-TW');
  });
  it('a broken v1 opening is reported with its path, and nothing is migrated', () => {
    const bad = copy(fixture); delete bad.openings[3].rect;
    expect(checkDocumentV1(bad).errors).toEqual([{ path: 'openings[3]', code: 'v1-unreadable', params: { reason: 'opening' } }]);
    expect(migrateV1Document(bad)).toEqual({ ok: false, errors: checkDocumentV1(bad).errors, report: [] });
  });
  it('v1 input that the check accepts but the migration cannot read becomes v1-unreadable with the migration path', () => {
    const bad = copy(fixture); bad.walls[0].rect = [0, 0, 0, 0];
    const result = migrateV1Document(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatchObject({ code: 'v1-unreadable' });
  });
});

describe('room geometry and ids (moved from the web app)', () => {
  const square = [[0, 0], [2000, 0], [2000, 3000], [0, 3000]] as [number, number][];
  it('area in m², perimeter in m, and points inside or on the edge', () => {
    expect([roomArea(square), roomPerimeter(square)]).toEqual([6, 10]);
    expect([containsPoint(square, 1000, 1000), containsPoint(square, 2000, 1500), containsPoint(square, 2001, 1500)]).toEqual([true, true, false]);
  });
  it('uniqueId is deterministic and avoids used ids; createId gives a UUID', () => {
    expect(uniqueId(new Set(['wall', 'wall-2']), 'wall')).toBe('wall-3');
    expect(uniqueId(new Set(), 'wall')).toBe('wall');
    expect(createId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
