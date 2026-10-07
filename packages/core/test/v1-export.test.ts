import { describe, expect, it } from 'vitest';
import { migrateV1Document, validatePlan } from '../src/index.js';
import exported from './fixtures/export-v1-9e1715d.json' with { type: 'json' };

// A real export from the original v1 editor (see fixtures/README.md): the Step B "v1 compatibility" check.
describe('a real v1 export (commit 9e1715d)', () => {
  const migrated = migrateV1Document(JSON.parse(JSON.stringify(exported)));
  if (!migrated.ok) throw new Error(`migration failed: ${JSON.stringify(migrated.errors)}`);
  const result = validatePlan(migrated.plan, 'import');

  it('migrates and passes the strict import validation with no error or warning', () => {
    expect([result.ok, result.errors, result.warnings]).toEqual([true, [], []]);
    expect(result.plan!.schemaVersion).toBe(2);
  });
  it('keeps the edits made in the v1 editor: name, added furniture, demolition and cost estimate', () => {
    const plan = result.plan!, added = exported.furniture.find(f => f.id === '5ead59d8-0880-4e4a-9270-8874ffe79303')!;
    expect(plan.name).toBe('v1 匯出測試');
    expect(plan.furniture.find(f => f.id === added.id)).toEqual(added);
    expect(plan.furniture).toHaveLength(exported.furniture.length);
    expect(plan.walls.filter(w => w.demolished).map(w => w.id)).toEqual(['wall-26']);
    expect(plan.costEstimate).toEqual({ currency: 'TWD', wastePercent: 12.5, furniturePrices: {}, materialPrices: {} });
    // The migration adds the two bay-window holes of the sample (roadmap A1) and changes nothing else in the counts.
    expect([plan.id, plan.rooms.length, plan.openings.length]).toEqual([exported.id, exported.rooms.length, exported.openings.length + 2]);
  });
});
