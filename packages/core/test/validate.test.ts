import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import schema from '../../../docs/open-plan.schema.json' with { type: 'json' };
import sampleV1 from './fixtures/sample-v1.json' with { type: 'json' };
import { TOLERABLE_CODES, effectiveOpeningHeights, migrateV1, validatePlan, validateSharedFields } from '../src/index.js';
import type { OpeningV2 } from '../src/index.js';

const schemaCheck = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

/** A small valid input plan. Heights are left out, so the validator must fill them. */
const base = (): any => ({
  schemaVersion: 2, id: 'test', name: 'Test', units: 'mm',
  walls: [
    { id: 'w1', type: 'e', a: [0, 0], b: [4000, 0], thickness: 200 },
    { id: 'w2', type: 'low', a: [0, 3000], b: [4000, 3000], thickness: 120 },
  ],
  openings: [
    { id: 'o1', type: 'window', wallId: 'w1', offset: 500, width: 1200 },
    { id: 'o2', type: 'door', wallId: 'w1', offset: 2500, width: 900, hinge: 'start', swing: 'left' },
    { id: 'o3', type: 'hole', wallId: 'w2', offset: 1000, width: 800 },
  ],
  rooms: [{ id: 'r1', name: 'Room', mat: 'wood', poly: [[0, 0], [4000, 0], [4000, 3000], [0, 3000]] }],
  materials: { wood: { name: 'Wood', sw: '#cc9966' } },
  furniture: [{ id: 'f1', type: 'sofa', name: 'Sofa', cx: 2000, cy: 1500, w: 2000, d: 900, rot: 0 }],
  measurements: [], dimensions: [],
});
const variant = (change: (p: any) => void) => { const p = base(); change(p); return p; };

describe('validatePlan', () => {
  it('accepts the base plan and fills the A2 default heights; the input is not changed', () => {
    const input = base(), before = JSON.stringify(input), result = validatePlan(input, 'import');
    expect(result).toMatchObject({ ok: true, errors: [], warnings: [] });
    expect(result.plan!.ceilingHeight).toBe(2800);
    expect(result.plan!.openings.map(o => [o.type, (o as any).sill, (o as any).head])).toEqual([['window', 900, 2400], ['door', undefined, 2100], ['hole', undefined, 2100]]);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('keeps heights that are given', () => {
    const result = validatePlan(variant(p => { p.ceilingHeight = 3000; p.openings[0].sill = 450; p.openings[0].head = 2600; p.openings[1].head = 2200; }), 'import');
    expect(result.plan!.ceilingHeight).toBe(3000);
    expect(result.plan!.openings.slice(0, 2).map(o => [(o as any).sill, (o as any).head])).toEqual([[450, 2600], [undefined, 2200]]);
  });
  it('accepts the migrated sample with no issues, for import and in the schema', () => {
    const sample = migrateV1(sampleV1).plan;
    expect(validatePlan(sample, 'import')).toMatchObject({ ok: true, errors: [], warnings: [] });
    expect(schemaCheck(sample)).toBe(true);
  });
  it('reports every issue, not only the first', () => {
    const result = validatePlan(variant(p => { p.walls[0].thickness = 5; p.openings[1].swing = 'up'; p.furniture[0].w = 0; }), 'import');
    expect(result.errors.map(e => e.code)).toEqual(['thickness-out-of-range', 'enum-invalid', 'size-not-positive']);
    expect(result.plan).toBeUndefined();
  });
  it('gives the path and params for the message', () => {
    const result = validatePlan(variant(p => { p.openings[2].width = 3500; }), 'import');
    expect(result.errors).toEqual([{ path: 'openings[2].width', code: 'opening-outside-wall', params: { wallLength: 4000, end: 4500 } }]);
  });
  it('rejects input that is not an object, or another schema version', () => {
    expect(validatePlan(null, 'saved').errors).toEqual([{ path: '$', code: 'type-invalid', params: { expected: 'object' } }]);
    expect(validatePlan({ ...base(), schemaVersion: 1 }, 'saved').errors[0]).toMatchObject({ path: 'schemaVersion', code: 'schema-version' });
  });
});

// Structural rules: fields, types, enums and ranges of single values. The schema and the validator (import policy)
// must agree on pass or fail; for a fail, the validator gives the expected code and path.
const STRUCTURAL: [string, (p: any) => void, null | [string, string]][] = [
  ['optional fields left out', p => { delete p.measurements; delete p.dimensions; }, null],
  ['extra fields are kept', p => { p.note = 'x'; p.walls[0].label = 'north'; }, null],
  ['every optional field given', p => { p.locale = 'zh-TW'; p.ceilingHeight = 2600; p.walls[0].demolished = false; p.walls[0].name = 'North'; p.openings[1].entry = true; p.openings[1].name = 'Front'; p.rooms[0].at = [1, 1]; p.rooms[0].counted = false; p.furniture[0].color = '#fff'; p.materials.wood.price = 320; p.costEstimate = { wastePercent: 10, furniturePrices: { f1: null, f2: 3 } }; }, null],
  ['schema version 1', p => { p.schemaVersion = 1; }, ['schema-version', 'schemaVersion']],
  ['no id', p => { delete p.id; }, ['missing-field', '$.id']],
  ['empty id', p => { p.id = ''; }, ['type-invalid', '$.id']],
  ['units cm', p => { p.units = 'cm'; }, ['enum-invalid', '$.units']],
  ['walls not a list', p => { p.walls = {}; }, ['type-invalid', '$.walls']],
  ['no materials', p => { delete p.materials; }, ['missing-field', '$.materials']],
  ['ceiling 7000', p => { p.ceilingHeight = 7000; }, ['height-out-of-range', 'ceilingHeight']],
  ['ceiling as text', p => { p.ceilingHeight = '2800'; }, ['type-invalid', '$.ceilingHeight']],
  ['wall without thickness', p => { delete p.walls[0].thickness; }, ['missing-field', 'walls[0].thickness']],
  ['wall thickness 10', p => { p.walls[0].thickness = 10; }, ['thickness-out-of-range', 'walls[0].thickness']],
  ['wall thickness 1001', p => { p.walls[0].thickness = 1001; }, ['thickness-out-of-range', 'walls[0].thickness']],
  ['wall type x', p => { p.walls[0].type = 'x'; }, ['enum-invalid', 'walls[0].type']],
  ['wall point with 3 numbers', p => { p.walls[0].b = [4000, 0, 0]; }, ['type-invalid', 'walls[0].b']],
  ['wall name as a number', p => { p.walls[0].name = 5; }, ['type-invalid', 'walls[0].name']],
  ['wall demolished as text', p => { p.walls[1].demolished = 'yes'; }, ['type-invalid', 'walls[1].demolished']],
  ['opening type gate', p => { p.openings[0].type = 'gate'; }, ['enum-invalid', 'openings[0].type']],
  ['opening offset -1', p => { p.openings[0].offset = -1; }, ['value-out-of-range', 'openings[0].offset']],
  ['opening width 0', p => { p.openings[0].width = 0; }, ['size-not-positive', 'openings[0].width']],
  ['opening without wallId', p => { delete p.openings[0].wallId; }, ['missing-field', 'openings[0].wallId']],
  ['door without hinge', p => { delete p.openings[1].hinge; }, ['missing-field', 'openings[1].hinge']],
  ['door swing up', p => { p.openings[1].swing = 'up'; }, ['enum-invalid', 'openings[1].swing']],
  ['door head 1700', p => { p.openings[1].head = 1700; }, ['height-out-of-range', 'openings[1].head']],
  ['hole head 1700', p => { p.openings[2].head = 1700; }, ['height-out-of-range', 'openings[2].head']],
  ['window sill -10', p => { p.openings[0].sill = -10; }, ['height-out-of-range', 'openings[0].sill']],
  ['window head as text', p => { p.openings[0].head = 'high'; }, ['type-invalid', 'openings[0].head']],
  ['room with 2 points', p => { p.rooms[0].poly = [[0, 0], [1, 1]]; }, ['room-too-few-points', 'rooms[0].poly']],
  ['room point as text', p => { p.rooms[0].poly[1] = 'x'; }, ['type-invalid', 'rooms[0].poly[1]']],
  ['room without mat', p => { delete p.rooms[0].mat; }, ['missing-field', 'rooms[0].mat']],
  ['material price as text', p => { p.materials.wood.price = 'oops'; }, ['type-invalid', 'materials.wood.price']],
  ['negative material price', p => { p.materials.wood.price = -1; }, ['value-out-of-range', 'materials.wood.price']],
  ['material swatch as a number', p => { p.materials.wood.sw = 5; }, ['type-invalid', 'materials.wood.sw']],
  ['furniture width 0', p => { p.furniture[0].w = 0; }, ['size-not-positive', 'furniture[0].w']],
  ['furniture without rot', p => { delete p.furniture[0].rot; }, ['missing-field', 'furniture[0].rot']],
  ['measurement without b', p => { p.measurements = [{ id: 'm', a: { x: 0, y: 0 } }]; }, ['missing-field', 'measurements[0].b']],
  ['dimension segment as text', p => { p.dimensions = [{ horizontal: true, at: 0, start: 0, segments: [100, 'x'] }]; }, ['type-invalid', 'dimensions[0].segments[1]']],
  ['waste 120 %', p => { p.costEstimate = { wastePercent: 120 }; }, ['value-out-of-range', 'costEstimate.wastePercent']],
  ['negative price', p => { p.costEstimate = { materialPrices: { wood: -5 } }; }, ['value-out-of-range', 'costEstimate.materialPrices.wood']],
  ['2001 walls', p => { p.walls = Array.from({ length: 2001 }, (_, i) => ({ id: `w${i}`, type: 'n', a: [0, i * 10], b: [10, i * 10], thickness: 100 })); p.openings = []; }, ['too-many-items', 'walls']],
];

describe('structural fixtures: the schema and the validator agree', () => {
  for (const [name, change, expected] of STRUCTURAL) it(name, () => {
    const plan = variant(change), result = validatePlan(plan, 'import'), schemaOk = schemaCheck(plan);
    expect(schemaOk, JSON.stringify(schemaCheck.errors)).toBe(result.ok);
    expect(result.ok).toBe(expected === null);
    if (expected) expect(result.errors).toContainEqual(expect.objectContaining({ code: expected[0], path: expected[1] }));
  });
});

// Semantic rules need more than one value. Each fixture passes the schema and must fail the validator (import policy)
// with the expected code and path. `tolerable` says how a saved plan treats it: a warning, or an error that blocks.
const SEMANTIC: [string, (p: any) => void, string, string, boolean][] = [
  ['duplicate wall id', p => { p.walls[1].id = 'w1'; }, 'id-duplicate', 'walls[1].id', false],
  ['duplicate furniture id', p => { p.furniture.push({ ...p.furniture[0] }); }, 'id-duplicate', 'furniture[1].id', false],
  ['duplicate measurement id', p => { p.measurements = [{ id: 'm', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, { id: 'm', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }]; }, 'id-duplicate', 'measurements[1].id', false],
  ['wallId that does not exist', p => { p.openings[0].wallId = 'nope'; }, 'wall-missing', 'openings[0].wallId', false],
  ['zero-length wall', p => { p.walls[1].b = [0, 3000]; p.openings.pop(); }, 'wall-zero-length', 'walls[1]', false],
  ['diagonal wall', p => { p.walls[1].b = [4000, 3500]; }, 'wall-not-axis-aligned', 'walls[1]', false],
  ['opening past the wall end', p => { p.openings[1].offset = 3500; }, 'opening-outside-wall', 'openings[1].width', false],
  ['overlapping openings', p => { p.openings[1].offset = 1500; }, 'openings-overlap', 'openings[1]', true],
  ['window sill at its head', p => { p.openings[0].sill = 2400; p.openings[0].head = 2400; }, 'window-sill-not-below-head', 'openings[0].sill', true],
  ['window head above the ceiling', p => { p.openings[0].head = 2900; }, 'height-out-of-range', 'openings[0].head', true],
  ['door head above a set ceiling', p => { p.ceilingHeight = 2400; p.openings[1].head = 2500; }, 'height-out-of-range', 'openings[1].head', true],
  ['window in a low wall', p => { p.openings[2] = { id: 'o3', type: 'window', wallId: 'w2', offset: 1000, width: 800 }; }, 'window-in-low-wall', 'openings[2]', true],
  ['room material that does not exist', p => { p.rooms[0].mat = 'marble'; }, 'room-material-missing', 'rooms[0].mat', true],
  ['room smaller than 0.01 m²', p => { p.rooms[0].poly = [[0, 0], [90, 0], [90, 90], [0, 90]]; }, 'room-area-too-small', 'rooms[0].poly', true],
  ['room with 3 points on one line', p => { p.rooms[0].poly = [[0, 0], [1000, 0], [2000, 0]]; }, 'room-area-too-small', 'rooms[0].poly', true],
  ['room polygon that crosses itself', p => { p.rooms[0].poly = [[0, 0], [4000, 3000], [4000, 0], [0, 3000]]; }, 'room-self-crossing', 'rooms[0].poly', true],
  ['plan wider than 100 m', p => { p.furniture[0].cx = 100_000; }, 'plan-too-large', '$', true],
  ['demolished bearing wall', p => { p.walls[0].type = 'b'; p.walls[0].demolished = true; }, 'wall-not-demolishable', 'walls[0].demolished', true],
  ['demolished exterior wall', p => { p.walls[0].demolished = true; }, 'wall-not-demolishable', 'walls[0].demolished', true],
  // A missing height gets its default, which must also be in range: a 2000 mm ceiling is below every default head.
  ['door with no head under a low ceiling', p => { p.ceilingHeight = 2000; delete p.openings[0]; p.openings = p.openings.filter(Boolean); }, 'height-out-of-range', 'openings[0].head', true],
  ['hole with no head under a low ceiling', p => { p.ceilingHeight = 2000; p.openings = [p.openings[2]]; }, 'height-out-of-range', 'openings[0].head', true],
  ['sliding door with no head under a low ceiling', p => { p.ceilingHeight = 2000; p.openings = [{ id: 's', type: 'sliding-door', wallId: 'w1', offset: 0, width: 1500 }]; }, 'height-out-of-range', 'openings[0].head', true],
  ['window with no head under a low ceiling', p => { p.ceilingHeight = 2000; p.openings = [p.openings[0]]; }, 'height-out-of-range', 'openings[0].head', true],
];

describe('semantic fixtures: the schema passes, the validator fails', () => {
  for (const [name, change, code, path, tolerable] of SEMANTIC) it(name, () => {
    const plan = variant(change);
    expect(schemaCheck(plan), JSON.stringify(schemaCheck.errors)).toBe(true);
    const imported = validatePlan(plan, 'import');
    expect(imported.ok).toBe(false);
    expect(imported.errors).toContainEqual(expect.objectContaining({ code, path }));
    expect(TOLERABLE_CODES.has(code)).toBe(tolerable);
    // A saved plan: a tolerable issue is a warning and the plan opens; a blocking one is an error.
    const saved = validatePlan(plan, 'saved');
    expect(saved.ok).toBe(tolerable);
    expect(tolerable ? saved.warnings : saved.errors).toContainEqual(expect.objectContaining({ code, path }));
  });
  it('a demolished partition or low wall is not an issue', () => {
    expect(validatePlan(variant(p => { p.walls[1].demolished = true; p.walls.push({ id: 'w3', type: 'n', a: [2000, 0], b: [2000, 3000], thickness: 100, demolished: true }); }), 'import').ok).toBe(true);
  });
  it('a defaulted height says so in params', () => {
    const result = validatePlan(variant(p => { p.ceilingHeight = 2000; p.openings = [p.openings[1]]; }), 'import');
    expect(result.errors).toEqual([{ path: 'openings[0].head', code: 'height-out-of-range', params: { min: 1800, max: 2000, value: 2100, defaulted: true } }]);
  });
  it('a 100 × 100 m plan between wall centre lines is not too large', () => {
    const plan = variant(p => { p.walls = [{ id: 'w1', type: 'e', a: [0, 0], b: [100_000, 0], thickness: 200 }, { id: 'w2', type: 'e', a: [0, 0], b: [0, 100_000], thickness: 200 }]; p.openings = []; p.furniture = []; });
    expect(validatePlan(plan, 'import').ok).toBe(true);
  });
});

// Normalization fills defaults only. Validating the normalized plan must give the same issues (code and path) as its
// input, under both policies, for every fixture that a saved plan accepts.
describe('normalization does not change the validation result', () => {
  const key = (issues: { code: string; path: string }[]) => issues.map(i => `${i.code} ${i.path}`).sort();
  for (const [name, change] of [...STRUCTURAL.map(([n, c]) => [n, c] as const), ...SEMANTIC.map(([n, c]) => [n, c] as const)]) {
    const input = variant(change), saved = validatePlan(input, 'saved');
    if (!saved.ok) continue;
    it(name, () => {
      const again = validatePlan(saved.plan, 'saved'), imported = validatePlan(input, 'import'), importedAgain = validatePlan(saved.plan, 'import');
      expect(again.ok).toBe(true);
      expect(key(again.warnings)).toEqual(key(saved.warnings));
      expect(importedAgain.ok).toBe(imported.ok);
      expect(key(importedAgain.errors)).toEqual(key(imported.errors));
    });
  }
});

describe('effectiveOpeningHeights', () => {
  const window = (sill: number, head: number) => ({ id: 'o', type: 'window', wallId: 'w', offset: 0, width: 1, sill, head }) as OpeningV2;
  const door = (head: number) => ({ id: 'o', type: 'door', wallId: 'w', offset: 0, width: 1, hinge: 'start', swing: 'left', head }) as OpeningV2;
  it('keeps values in range', () => expect(effectiveOpeningHeights(window(900, 2400), 2800)).toEqual({ sill: 900, head: 2400 }));
  it('clamps a window to 0 ≤ sill ≤ head ≤ ceiling', () => {
    expect(effectiveOpeningHeights(window(-100, 3000), 2800)).toEqual({ sill: 0, head: 2800 });
    expect(effectiveOpeningHeights(window(2500, 2000), 2800)).toEqual({ sill: 2500, head: 2500 });
  });
  it('clamps a door head to 1800–ceiling', () => {
    expect(effectiveOpeningHeights(door(1000), 2800).head).toBe(1800);
    expect(effectiveOpeningHeights(door(3500), 2800).head).toBe(2800);
  });
});

describe('validateSharedFields', () => {
  it('checks the shared fields of a v1 plan with the saved policy', () => {
    const v1 = JSON.parse(JSON.stringify(sampleV1));
    expect(validateSharedFields(v1, 'saved')).toMatchObject({ ok: true, errors: [], warnings: [] });
    v1.rooms[0].mat = 'nope'; v1.furniture[0].w = -1;
    const result = validateSharedFields(v1, 'saved');
    expect(result.errors).toEqual([expect.objectContaining({ code: 'size-not-positive', path: 'furniture[0].w' })]);
    expect(result.warnings).toEqual([expect.objectContaining({ code: 'room-material-missing', path: 'rooms[0].mat' })]);
  });
});
