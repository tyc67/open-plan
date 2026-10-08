import { describe, expect, it } from 'vitest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import schema from '../../../docs/open-plan.schema.json' with { type: 'json' };
import sampleV1 from './fixtures/sample-v1.json' with { type: 'json' };
import { TOLERABLE_CODES, effectiveOpeningHeights, migrateV1, validatePlan, validateSharedFields } from '../src/index.js';
import type { OpeningV2 } from '../src/index.js';
import { base, SEMANTIC, STRUCTURAL, variant } from './validation-fixtures.js';

const schemaCheck = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

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

describe('structural fixtures: the schema and the validator agree', () => {
  for (const [name, change, expected] of STRUCTURAL) it(name, () => {
    const plan = variant(change), result = validatePlan(plan, 'import'), schemaOk = schemaCheck(plan);
    expect(schemaOk, JSON.stringify(schemaCheck.errors)).toBe(result.ok);
    expect(result.ok).toBe(expected === null);
    if (expected) expect(result.errors).toContainEqual(expect.objectContaining({ code: expected[0], path: expected[1] }));
  });
});

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

describe('length tolerance along a wall', () => {
  // 1000.1 + 1000.2 is 2000.3000000000002 in binary floating point.
  const plan = (openings: object[], length = 2000.3) => ({ ...base(), walls: [{ id: 'w', type: 'n', a: [0, 0], b: [length, 0], thickness: 100 }], openings, rooms: [] });
  it('an opening that ends at the wall end in decimal is inside the wall', () => {
    expect(validatePlan(plan([{ id: 'o', type: 'hole', wallId: 'w', offset: 1000.1, width: 1000.2 }]), 'import').errors).toEqual([]);
  });
  it('two openings that touch in decimal do not overlap', () => {
    expect(1000.1 + 1000.2 > 2000.3).toBe(true);
    expect(validatePlan(plan([{ id: 'o1', type: 'hole', wallId: 'w', offset: 1000.1, width: 1000.2 }, { id: 'o2', type: 'hole', wallId: 'w', offset: 2000.3, width: 500 }], 3000), 'import').errors).toEqual([]);
  });
  it('0.1 mm outside the wall or over the next opening is still an issue', () => {
    expect(validatePlan(plan([{ id: 'o', type: 'hole', wallId: 'w', offset: 1000.1, width: 1000.3 }]), 'import').errors.map(e => e.code)).toEqual(['opening-outside-wall']);
    expect(validatePlan(plan([{ id: 'o1', type: 'hole', wallId: 'w', offset: 0, width: 1000.3 }, { id: 'o2', type: 'hole', wallId: 'w', offset: 1000.2, width: 500 }]), 'import').errors.map(e => e.code)).toEqual(['openings-overlap']);
  });
});
