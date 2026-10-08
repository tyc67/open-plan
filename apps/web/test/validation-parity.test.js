import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validatePlan } from 'open-plan-core';
import { base, SEMANTIC, STRUCTURAL, variant } from '../../../packages/core/test/validation-fixtures.ts';
import { folder, runAsync } from '../../../packages/cli/test/helpers.ts';
import { readImportFile } from '../src/floorplan/planFile.js';

// Step C "done when" (Core): the website and the CLI give the same validation result on all B2 fixtures. Each file goes
// through the website's import (readImportFile, the code in the browser bundle) and saved-plan load (loadDocument),
// and through the built CLI: `validate` (import policy) and `info` (saved policy). The issues must be equal: code,
// path, params and order.
const fixture = name => readFileSync(new URL(`../../../packages/core/test/fixtures/${name}`, import.meta.url), 'utf8');
const pretty = plan => JSON.stringify(plan, null, 2);
const v1Sample = JSON.parse(fixture('sample-v1.json'));
const CASES = [
  ['base plan', pretty(base())],
  ...STRUCTURAL.map(([name, change]) => [`structural: ${name}`, pretty(variant(change))]),
  ...SEMANTIC.map(([name, change]) => [`semantic: ${name}`, pretty(variant(change))]),
  ['v1: the sample', pretty(v1Sample)],
  ['v1: a real export with edits', fixture('export-v1-9e1715d.json')],
  ['v1: a wall that v2 rejects after the migration (1200 mm thick)', pretty({ ...v1Sample, walls: [...v1Sample.walls, { id: 'thick', type: 'n', rect: [10300, 1000, 12500, 2200] }] })],
  ['v1: a broken opening', pretty({ ...v1Sample, openings: [{ ...v1Sample.openings[0], rect: 'x' }, ...v1Sample.openings.slice(1)] })],
  ['not JSON', '{"schemaVersion": 2,'],
  ['not an object', 'null'],
];

// The website's saved-plan load reads localStorage; a fake one holds only the plan.
const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const { loadDocument } = await import('../src/floorplan/storage.js');
function websiteSaved(text) {
  store.clear(); store.set('open-plan:document:v1', text);
  try { const loaded = loadDocument(); return { ok: true, issues: loaded.warnings }; }
  catch (error) { if (!error.issues) throw error; return { ok: false, issues: error.issues }; }
}

const cli = {};
beforeAll(async () => {
  const dir = folder();
  const queue = CASES.map(([name, text], i) => { writeFileSync(join(dir, `p${i}.json`), text); return [name, `p${i}.json`]; });
  // At most 16 CLI processes at a time.
  await Promise.all(Array.from({ length: 16 }, async () => {
    for (let job; (job = queue.shift());) {
      const [name, file] = job;
      const [validate, info] = await Promise.all([runAsync(dir, 'validate', file), runAsync(dir, 'info', file)]);
      cli[name] = { validate, info };
    }
  }));
}, 120_000);

describe('validation parity: website and CLI on the B2 fixtures', () => {
  it('covers every B2 fixture', () => {
    expect(CASES.length).toBe(1 + STRUCTURAL.length + SEMANTIC.length + 6);
  });
  for (const [name, text] of CASES) it(name, () => {
    const { validate, info } = cli[name];
    // Import policy: the website import and `validate`.
    const imported = readImportFile(text);
    expect(validate.json, validate.err).not.toBeNull();
    expect(validate.json.ok).toBe(imported.ok);
    expect(validate.json.ok ? validate.json.warnings : validate.json.errors).toEqual(imported.ok ? [] : imported.errors);
    expect(validate.code).toBe(imported.ok ? 0 : 1);
    // For a v2 file, both equal the core result directly.
    let input = null;
    try { input = JSON.parse(text); } catch { /* not JSON */ }
    if (input?.schemaVersion === 2) expect(imported.ok ? [] : imported.errors).toEqual(validatePlan(input, 'import').errors);
    // Saved policy: the website's saved-plan load and `info`.
    const saved = websiteSaved(text);
    expect(info.json, info.err).not.toBeNull();
    expect(info.json.ok).toBe(saved.ok);
    expect(info.json.ok ? info.json.warnings : info.json.errors).toEqual(saved.issues);
  });
});
