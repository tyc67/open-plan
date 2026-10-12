import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSamplePlan } from 'open-plan-core';

// Old finding L6, part 2: a save is refused when another tab changed the saved plan; the editor decides with one
// reading of the other plan, which it can adopt. Each test gets a new copy of the
// module, which is one tab; a second import of the module is a second tab on the same storage.
const KEY = 'open-plan:document:v1', REPLACED = `${KEY}:replaced`, RECOVERY = `${KEY}:recovery`, SESSION = `${KEY}:session`, BEFORE_V2 = `${KEY}:before-v2`;
const store = new Map();
let fail = null;
globalThis.localStorage = {
  getItem: k => store.get(k) ?? null,
  setItem: (k, v) => { if (fail === k) throw new Error('full'); store.set(k, String(v)); },
  removeItem: k => store.delete(k),
};
const tab = async () => { vi.resetModules(); return import('../src/floorplan/storage.js'); };
const named = (plan, name) => ({ ...plan, name });
const stored = key => JSON.parse(store.get(key));

beforeEach(() => { store.clear(); fail = null; });

describe('website storage with two tabs', () => {
  it('refuses a save after another tab wrote, and writes nothing', async () => {
    const a = await tab(), plan = createSamplePlan();
    a.loadDocument(); a.saveDocument(plan);
    const b = await tab(), opened = b.loadDocument().plan;
    expect(b.changedElsewhere()).toBe(false);
    a.saveDocument(named(plan, 'From A'));
    expect(b.changedElsewhere()).toBe(true);
    const before = new Map(store);
    expect(() => b.saveDocument(named(opened, 'From B'))).toThrow(b.PlanChangedElsewhere);
    expect(new Map(store)).toEqual(before);
    // The tab that wrote last goes on.
    a.saveDocument(named(plan, 'From A again'));
    expect(stored(KEY).name).toBe('From A again');
  });

  it('refuses a save after another tab removed or replaced the saved plan with unreadable data', async () => {
    const a = await tab(), plan = createSamplePlan();
    a.loadDocument(); a.saveDocument(plan);
    store.delete(KEY);
    expect(() => a.saveDocument(named(plan, 'x'))).toThrow(a.PlanChangedElsewhere);
    store.set(KEY, '{broken');
    expect(() => a.saveDocument(named(plan, 'x'))).toThrow(a.PlanChangedElsewhere);
    expect(store.get(KEY)).toBe('{broken');
  });

  it('a new user in two tabs: the second tab to write is refused', async () => {
    const a = await tab(); a.loadDocument();
    const b = await tab(); b.loadDocument();
    a.saveDocument(named(createSamplePlan(), 'A'));
    expect(() => b.saveDocument(named(createSamplePlan(), 'B'))).toThrow(b.PlanChangedElsewhere);
  });

  it('keep this tab: the other plan goes to the replaced copy, then this plan is written', async () => {
    const a = await tab(), plan = createSamplePlan();
    a.loadDocument(); a.saveDocument(plan);
    const b = await tab(), mine = named(b.loadDocument().plan, 'Mine');
    a.saveDocument(named(plan, 'Other'));
    expect(b.keepOverElsewhere(mine)).toBe('replaced');
    expect(stored(KEY).name).toBe('Mine');
    expect(b.replacedDocument().plan.name).toBe('Other');
    expect(b.changedElsewhere()).toBe(false);
    b.saveDocument(named(mine, 'Mine 2'));
    expect(stored(KEY).name).toBe('Mine 2');
    // The first tab now has the conflict.
    expect(a.changedElsewhere()).toBe(true);
  });

  it('keep this tab: a later save of the plan that this tab opened (an undo) is written', async () => {
    const a = await tab(), plan = createSamplePlan();
    a.loadDocument(); a.saveDocument(plan);
    const b = await tab(), opened = b.loadDocument().plan;             // no edit and no write in this tab yet
    a.saveDocument(named(plan, 'Other'));
    b.keepOverElsewhere(named(opened, 'Mine'));
    b.saveDocument(opened);
    expect(stored(KEY).name).toBe(plan.name);
    expect(stored(SESSION).name).toBe('Mine');
  });

  it('keep this tab: it reads the stored plan again, so a third write is the one that is kept', async () => {
    const a = await tab(), plan = createSamplePlan();
    a.loadDocument(); a.saveDocument(plan);
    const b = await tab(), mine = named(b.loadDocument().plan, 'Mine');
    a.saveDocument(named(plan, 'Second'));
    a.saveDocument(named(plan, 'Third'));
    b.keepOverElsewhere(mine);
    expect(b.replacedDocument().plan.name).toBe('Third');
  });

  it('keep this tab: unreadable data goes to the recovery copy; a removed plan needs no copy', async () => {
    const a = await tab(), plan = createSamplePlan();
    a.loadDocument(); a.saveDocument(plan);
    store.set(KEY, '{broken');
    expect(a.keepOverElsewhere(named(plan, 'Mine'))).toBe('recovery');
    expect(store.get(RECOVERY)).toBe('{broken');
    expect(store.has(REPLACED)).toBe(false);
    store.delete(KEY);
    expect(a.keepOverElsewhere(named(plan, 'Mine again'))).toBe(null);
    expect(stored(KEY).name).toBe('Mine again');
  });

  it('keep this tab: a copy that cannot be written refuses the write, and the conflict stays', async () => {
    const a = await tab(), plan = createSamplePlan();
    a.loadDocument(); a.saveDocument(plan);
    const other = JSON.stringify(named(plan, 'Other'));
    store.set(KEY, other); fail = REPLACED;
    expect(() => a.keepOverElsewhere(named(plan, 'Mine'))).toThrow('無法先備份另一個分頁的版本');
    expect(store.get(KEY)).toBe(other);
    expect(a.changedElsewhere()).toBe(true);
  });

  it('load the other plan: the loaded plan is not written back, and a later edit is written', async () => {
    const a = await tab(), plan = createSamplePlan();
    a.loadDocument(); a.saveDocument(plan);
    const b = await tab(), opened = b.loadDocument().plan;
    b.saveDocument(named(opened, 'B first'));                          // this tab has written before
    // Other bytes than the editor would write: a save of the loaded plan must still write nothing.
    const other = JSON.stringify(named(plan, 'Other'), null, 2);
    store.set(KEY, other);
    const loaded = b.loadFromElsewhere();
    expect(loaded.plan.name).toBe('Other');
    expect(b.changedElsewhere()).toBe(false);
    b.saveDocument(loaded.plan);
    expect(store.get(KEY)).toBe(other);
    b.saveDocument(named(loaded.plan, 'B after the load'));
    expect(stored(KEY).name).toBe('B after the load');
  });

  it('load the other plan: a removed or unreadable plan is not loaded, and saves stay refused', async () => {
    const a = await tab(), plan = createSamplePlan();
    a.loadDocument(); a.saveDocument(plan);
    store.delete(KEY);
    expect(a.loadFromElsewhere()).toBe(null);
    expect(() => a.saveDocument(named(plan, 'x'))).toThrow(a.PlanChangedElsewhere);
    store.set(KEY, '{broken');
    expect(() => a.loadFromElsewhere()).toThrow(a.PlanLoadError);
    expect(() => a.saveDocument(named(plan, 'x'))).toThrow(a.PlanChangedElsewhere);
    expect(store.get(KEY)).toBe('{broken');
  });

  it('a reading of the other plan changes nothing, and saves stay refused', async () => {
    const a = await tab(), plan = createSamplePlan();
    a.loadDocument(); a.saveDocument(plan);
    store.set(KEY, JSON.stringify(named(plan, 'Other')));
    const before = new Map(store), reading = a.readElsewhere();
    expect(reading.plan.name).toBe('Other');
    expect(new Map(store)).toEqual(before);
    expect(a.changedElsewhere()).toBe(true);
    expect(() => a.saveDocument(named(plan, 'x'))).toThrow(a.PlanChangedElsewhere);
    store.delete(KEY);
    expect(a.readElsewhere()).toEqual({ raw: null });
    store.set(KEY, '{broken');
    expect(a.readElsewhere().error).toBeInstanceOf(a.PlanLoadError);
    expect(a.readElsewhere().plan).toBeUndefined();
  });

  it('an adopted reading: the equal plan is not written, in other bytes too, and an edit is written', async () => {
    const a = await tab(), plan = createSamplePlan();
    a.loadDocument(); a.saveDocument(named(plan, 'Edited'));           // this tab has written before
    const mine = a.loadDocument().plan;
    a.saveDocument(named(mine, 'Edited again'));
    const other = JSON.stringify(named(mine, 'Other'), null, 2);       // other formatting than the editor writes
    store.set(KEY, other);
    const reading = a.readElsewhere();
    expect(JSON.stringify(reading.plan)).toBe(JSON.stringify(named(mine, 'Other')));
    a.adoptElsewhere(reading);
    expect(a.changedElsewhere()).toBe(false);
    a.saveDocument(reading.plan);
    expect(store.get(KEY)).toBe(other);
    a.saveDocument(named(reading.plan, 'After'));
    expect(stored(KEY).name).toBe('After');
  });

  it('an adopted reading uses its own text: a change after the reading keeps saves refused', async () => {
    const a = await tab(), plan = createSamplePlan();
    a.loadDocument(); a.saveDocument(plan);
    store.set(KEY, JSON.stringify(named(plan, 'Second')));
    const reading = a.readElsewhere();
    store.set(KEY, JSON.stringify(named(plan, 'Third')));              // another write between the reading and the adoption
    a.adoptElsewhere(reading);
    expect(a.changedElsewhere()).toBe(true);
    expect(() => a.saveDocument(reading.plan)).toThrow(a.PlanChangedElsewhere);
    expect(stored(KEY).name).toBe('Third');
  });

  it('a v1 plan from another tab: the reading keeps no copy; the adoption keeps the v1 text first', async () => {
    const v1 = readFileSync(new URL('../../../packages/core/test/fixtures/export-v1-9e1715d.json', import.meta.url), 'utf8');
    const a = await tab();
    a.loadDocument(); a.saveDocument(createSamplePlan());
    store.set(KEY, v1);
    const reading = a.readElsewhere();
    expect(reading.v1).toBe(true);
    expect(store.has(BEFORE_V2)).toBe(false);
    fail = BEFORE_V2;
    expect(() => a.adoptElsewhere(reading)).toThrow();
    expect(a.changedElsewhere()).toBe(true);
    fail = null;
    a.adoptElsewhere(reading);
    expect(store.get(BEFORE_V2)).toBe(v1);
    a.saveDocument(reading.plan);                                      // the migration write
    expect(stored(KEY).schemaVersion).toBe(2);
  });

  it('one tab alone: the session copy and the saves work as before', async () => {
    const a = await tab(), plan = createSamplePlan();
    a.loadDocument(); a.saveDocument(plan);
    const b = await tab(), opened = b.loadDocument().plan;
    b.saveDocument(opened);                                            // no change: no write, no session copy
    expect(store.has(SESSION)).toBe(false);
    b.saveDocument(named(opened, 'Edited'));
    expect(stored(SESSION).name).toBe(plan.name);
    b.saveDocument(opened);                                            // undo back to the opened plan is a write
    expect(stored(KEY).name).toBe(plan.name);
  });
});
