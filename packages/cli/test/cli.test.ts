import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createSamplePlan } from 'open-plan-core';
import { acquireLock, lockPath, releaseLock } from '../src/lock.js';
import * as op from '../src/operations.js';
import { CliError } from '../src/files.js';
import { folder, read, run, runAsync, V1_SAMPLE } from './helpers.js';

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
/** A folder with a sample plan; returns the folder, the plan path and its revision. */
function samplePlan() {
  const dir = folder(), plan = join(dir, 'plan.json');
  expect(run(dir, 'new', 'plan.json', '--sample').code).toBe(0);
  return { dir, plan, revision: sha(readFileSync(plan)) };
}
function commands(dir: string, expectedRevision: string | undefined, list: object[], name = 'c.json') {
  writeFileSync(join(dir, name), JSON.stringify({ ...(expectedRevision ? { expectedRevision } : {}), commands: list }));
  return name;
}
const backupsOf = (plan: string) => existsSync(`${plan}.backups`) ? readdirSync(`${plan}.backups`).sort() : [];

describe('schema, validate, info', () => {
  it('schema gives the JSON Schema and the field description from the package, not from the repository', () => {
    const r = run(folder(), 'schema');
    expect([r.code, r.json.schema.title, r.json.description.startsWith('# Open Plan format')]).toEqual([0, 'Open Plan floor plan, schema version 2', true]);
  });
  it('validate: a valid plan gives exit 0 and the revision, the full SHA-256 of the file bytes', () => {
    const { dir, revision } = samplePlan();
    const r = run(dir, 'validate', 'plan.json');
    expect([r.code, r.json.ok, r.json.revision]).toEqual([0, true, revision]);
    expect(revision).toMatch(/^[0-9a-f]{64}$/);
  });
  it('validate is strict: a tolerable issue is an error (exit 1), with path and code', () => {
    const { dir, plan } = samplePlan();
    const p = JSON.parse(read(plan)); p.rooms[0].mat = 'granite'; writeFileSync(plan, JSON.stringify(p));
    const r = run(dir, 'validate', 'plan.json');
    expect([r.code, r.json.code, r.json.errors]).toEqual([1, 'VALIDATION_FAILED', [{ path: 'rooms[0].mat', code: 'room-material-missing', params: { mat: 'granite' } }]]);
  });
  it('validate: not JSON is a validation error; a missing file is FILE_NOT_FOUND', () => {
    const dir = folder(); writeFileSync(join(dir, 'bad.json'), '{"schemaVersion":');
    expect(run(dir, 'validate', 'bad.json').json.errors).toEqual([{ path: '$', code: 'json-invalid', params: {} }]);
    expect(run(dir, 'validate', 'none.json')).toMatchObject({ code: 1, json: { code: 'FILE_NOT_FOUND' } });
  });
  it('validate: a v1 file is checked through the migration, with its report and a hint to migrate', () => {
    const r = run(folder(), 'validate', V1_SAMPLE);
    expect([r.code, r.json.schemaVersion, r.json.migrationReport.length, r.json.notices[0]]).toEqual([0, 1, 24, 'The file is schema version 1; `migrate` converts it.']);
  });
  it('info: counts, size, rooms with areas and the revision; a tolerable issue is a warning there', () => {
    const { dir, plan, revision } = samplePlan();
    const r = run(dir, 'info', 'plan.json');
    expect([r.code, r.json.revision, r.json.summary.rooms, r.json.summary.width, r.json.rooms[0]]).toEqual([0, revision, 13, 14.55, { id: 'master', name: '主臥室', area: 12.37, counted: true }]);
    const p = JSON.parse(read(plan)); p.rooms[0].mat = 'granite'; writeFileSync(plan, JSON.stringify(p));
    expect(run(dir, 'info', 'plan.json').json.warnings.map((w: any) => w.code)).toEqual(['room-material-missing']);
  });
});

describe('new and migrate', () => {
  it('new writes an empty plan or the sample; the file is the plan as 2-space JSON with a final newline', () => {
    const dir = folder();
    expect(run(dir, 'new', 'empty.json').code).toBe(0);
    expect(JSON.parse(read(join(dir, 'empty.json'))).walls).toEqual([]);
    run(dir, 'new', 'sample.json', '--sample');
    const text = read(join(dir, 'sample.json')), plan = JSON.parse(text);
    expect(text).toBe(`${JSON.stringify(plan, null, 2)}\n`);
    expect({ ...plan, id: '' }).toEqual({ ...createSamplePlan(), id: '' });
  });
  it('new refuses an existing file; --replace backs it up first', () => {
    const { dir, plan } = samplePlan(), before = read(plan);
    expect(run(dir, 'new', 'plan.json')).toMatchObject({ code: 1, json: { code: 'DESTINATION_EXISTS' } });
    expect([read(plan), backupsOf(plan)]).toEqual([before, []]);
    const r = run(dir, 'new', 'plan.json', '--replace');
    expect([r.code, JSON.parse(read(plan)).walls.length]).toEqual([0, 0]);
    expect(read(join(`${plan}.backups`, r.json.backup))).toBe(before);
  });
  it('migrate converts v1 to v2 with the report; the source must be v1; the destination rules are those of new', () => {
    const dir = folder();
    const r = run(dir, 'migrate', V1_SAMPLE, 'plan.json');
    expect([r.code, r.json.migrationReport.length, JSON.parse(read(join(dir, 'plan.json'))).schemaVersion]).toEqual([0, 24, 2]);
    expect(run(dir, 'migrate', 'plan.json', 'other.json')).toMatchObject({ code: 1, json: { code: 'NOT_VERSION_1' } });
    expect(run(dir, 'migrate', V1_SAMPLE, 'plan.json')).toMatchObject({ code: 1, json: { code: 'DESTINATION_EXISTS' } });
    const replaced = run(dir, 'migrate', V1_SAMPLE, 'plan.json', '--replace');
    expect([replaced.code, typeof replaced.json.backup]).toEqual([0, 'string']);
  });
  it('migrate is strict: a v1 file with a tolerable issue writes nothing', () => {
    const dir = folder(), v1 = JSON.parse(read(V1_SAMPLE)); v1.rooms[0].mat = 'granite';
    writeFileSync(join(dir, 'old.json'), JSON.stringify(v1));
    const r = run(dir, 'migrate', 'old.json', 'plan.json');
    expect([r.code, r.json.errors[0].code, existsSync(join(dir, 'plan.json'))]).toEqual([1, 'room-material-missing', false]);
  });
  it('in-place migration reads the source under the plan lock, also through a symlink: a change made while it waits is kept', async () => {
    for (const source of ['old.json', 'alias.json']) {
      const dir = folder(), old = join(dir, 'old.json');
      writeFileSync(old, read(V1_SAMPLE)); symlinkSync(old, join(dir, 'alias.json'));
      const held = await acquireLock(old);
      const migrating = op.migrate(join(dir, source), old, { replace: true });
      await new Promise(done => setTimeout(done, 200));
      const changed = { ...JSON.parse(read(V1_SAMPLE)), name: 'Changed while waiting' };
      writeFileSync(old, JSON.stringify(changed));
      await releaseLock(held);
      const r = await migrating;
      expect([source, r.ok, JSON.parse(read(old))]).toMatchObject([source, true, { schemaVersion: 2, name: 'Changed while waiting' }]);
      expect(JSON.parse(read(join(`${old}.backups`, (r as { backup: string }).backup)))).toEqual(changed);
    }
  });
  it('in-place migration without --replace writes nothing', () => {
    const dir = folder(), old = join(dir, 'old.json'); writeFileSync(old, read(V1_SAMPLE));
    expect(run(dir, 'migrate', 'old.json', 'old.json')).toMatchObject({ code: 1, json: { code: 'DESTINATION_EXISTS' } });
    expect([read(old), backupsOf(old)]).toEqual([read(V1_SAMPLE), []]);
  });
});

describe('apply', () => {
  it('applies a batch: new revision, a backup with the exact previous bytes, notes and warnings', () => {
    const { dir, plan, revision } = samplePlan(), before = readFileSync(plan);
    const r = run(dir, 'apply', 'plan.json', commands(dir, revision, [{ op: 'set_plan_name', name: 'Home' }, { op: 'add_wall', type: 'n', a: [0, 20000], b: [1000, 20000], thickness: 100 }]));
    expect([r.code, r.json.previousRevision, r.json.revision]).toEqual([0, revision, sha(readFileSync(plan))]);
    expect(JSON.parse(read(plan)).name).toBe('Home');
    expect(readFileSync(join(`${plan}.backups`, r.json.backup)).equals(before)).toBe(true);
    expect(r.json.notes).toEqual([{ commandIndex: 1, code: 'id-generated', params: { list: 'walls', id: 'wall' } }]);
  });
  it('a stale revision is REVISION_CONFLICT (exit 3) with the current revision, and nothing changes', () => {
    const { dir, plan, revision } = samplePlan();
    run(dir, 'apply', 'plan.json', commands(dir, revision, [{ op: 'set_plan_name', name: 'A' }]));
    const after = read(plan), backups = backupsOf(plan);
    const r = run(dir, 'apply', 'plan.json', commands(dir, revision, [{ op: 'set_plan_name', name: 'B' }]));
    expect([r.code, r.json.code, r.json.currentRevision]).toEqual([3, 'REVISION_CONFLICT', sha(after)]);
    expect([read(plan), backupsOf(plan)]).toEqual([after, backups]);
  });
  it('a missing revision and a refused command change nothing and make no backup', () => {
    const { dir, plan, revision } = samplePlan(), before = read(plan);
    expect(run(dir, 'apply', 'plan.json', commands(dir, undefined, [{ op: 'set_plan_name', name: 'A' }]))).toMatchObject({ code: 1, json: { code: 'REVISION_REQUIRED' } });
    const r = run(dir, 'apply', 'plan.json', commands(dir, revision, [{ op: 'set_plan_name', name: 'A' }, { op: 'delete_wall', wallId: 'nope' }]));
    expect([r.code, r.json.code, r.json.errors[0]]).toEqual([1, 'COMMANDS_REFUSED', { commandIndex: 1, path: 'commands[1].wallId', code: 'wall-missing', params: { op: 'delete_wall', wallId: 'nope' } }]);
    expect([read(plan), backupsOf(plan)]).toEqual([before, []]);
  });
  it('a v1 plan file must be migrated first', () => {
    const dir = folder(); writeFileSync(join(dir, 'old.json'), read(V1_SAMPLE));
    expect(run(dir, 'apply', 'old.json', commands(dir, sha(readFileSync(join(dir, 'old.json'))), []))).toMatchObject({ code: 1, json: { code: 'NOT_VERSION_2' } });
  });
  it('a batch that does not change the plan keeps the bytes and the revision of a minified or web-export file, with no backup', () => {
    for (const format of [(p: unknown) => JSON.stringify(p), (p: unknown) => JSON.stringify(p, null, 2)]) {
      const dir = folder(), plan = join(dir, 'plan.json'), text = format(createSamplePlan());
      writeFileSync(plan, text);
      for (const list of [[], [{ op: 'set_plan_name', name: createSamplePlan().name }]]) {
        const r = run(dir, 'apply', 'plan.json', commands(dir, sha(text), list));
        expect([r.code, r.json.revision, r.json.backup, read(plan), backupsOf(plan)]).toEqual([0, sha(text), null, text, []]);
      }
      const changed = run(dir, 'apply', 'plan.json', commands(dir, sha(text), [{ op: 'set_plan_name', name: 'Other' }]));
      expect([changed.code, typeof changed.json.backup, read(plan)]).toEqual([0, 'string', `${JSON.stringify({ ...JSON.parse(text), name: 'Other' }, null, 2)}\n`]);
    }
  });
  it('keeps the last 20 backups', () => {
    const { dir, plan } = samplePlan();
    for (let i = 0; i < 22; i++) expect(run(dir, 'apply', 'plan.json', commands(dir, sha(readFileSync(plan)), [{ op: 'set_plan_name', name: `n${i}` }])).code).toBe(0);
    expect(backupsOf(plan)).toHaveLength(20);
  });
  it('a failed backup refuses the write (exit 5) and changes nothing', () => {
    const { dir, plan, revision } = samplePlan(), before = read(plan);
    writeFileSync(`${plan}.backups`, 'not a folder');
    const r = run(dir, 'apply', 'plan.json', commands(dir, revision, [{ op: 'set_plan_name', name: 'A' }]));
    expect([r.code, r.json.code, read(plan)]).toEqual([5, 'BACKUP_FAILED', before]);
  });
  it('a pruning failure after the write reports success with a cleanup notice', () => {
    const { dir, plan } = samplePlan();
    mkdirSync(`${plan}.backups`);
    // The oldest "backup" is a folder, so it cannot be deleted like a file.
    mkdirSync(join(`${plan}.backups`, `20000101T000000000Z-${'0'.repeat(64)}.json`));
    for (let i = 0; i < 20; i++) run(dir, 'apply', 'plan.json', commands(dir, sha(readFileSync(plan)), [{ op: 'set_plan_name', name: `n${i}` }]));
    const r = run(dir, 'apply', 'plan.json', commands(dir, sha(readFileSync(plan)), [{ op: 'set_plan_name', name: 'last' }]));
    expect([r.code, r.json.ok, JSON.parse(read(plan)).name]).toEqual([0, true, 'last']);
    expect(r.json.notices[0]).toContain('The plan was written, but old backups could not be removed');
  });
  it('leaves no temporary or lock file', () => {
    const { dir, plan, revision } = samplePlan();
    run(dir, 'apply', 'plan.json', commands(dir, revision, [{ op: 'set_plan_name', name: 'A' }]));
    expect(readdirSync(dir).sort()).toEqual(['c.json', 'plan.json', 'plan.json.backups']);
  });
});

describe('paths', () => {
  it('a symlink and the real file use one lock: a writer through the link waits for a writer through the real path', async () => {
    const { dir, plan, revision } = samplePlan();
    symlinkSync(plan, join(dir, 'alias.json'));
    const held = await acquireLock(plan);
    try {
      await expect(op.apply(join(dir, 'alias.json'), join(dir, commands(dir, revision, [{ op: 'set_plan_name', name: 'A' }])), { timeoutMs: 300 })).rejects.toMatchObject({ code: 'LOCK_TIMEOUT' });
    } finally { await releaseLock(held); }
    const r = run(dir, 'apply', 'alias.json', 'c.json');
    expect([r.code, JSON.parse(read(plan)).name, existsSync(`${join(dir, 'alias.json')}.backups`), backupsOf(plan).length]).toEqual([0, 'A', false, 1]);
  });
  it('a plan file with two hard links is refused, and nothing changes', () => {
    const { dir, plan, revision } = samplePlan(), before = read(plan);
    linkSync(plan, join(dir, 'second.json'));
    const r = run(dir, 'apply', 'plan.json', commands(dir, revision, [{ op: 'set_plan_name', name: 'A' }]));
    expect([r.code, r.json.code, read(plan), backupsOf(plan)]).toEqual([1, 'PLAN_HARD_LINKED', before, []]);
  });
  it('a lock left by a stopped process stops the command with LOCK_STALE (exit 4), and the lock stays', () => {
    const { dir, plan, revision } = samplePlan();
    const stale = JSON.stringify({ token: 't', hostname: hostname(), pid: 999_999, createdAt: '2026-01-01T00:00:00Z' });
    writeFileSync(lockPath(plan), stale);
    const r = run(dir, 'apply', 'plan.json', commands(dir, revision, [{ op: 'set_plan_name', name: 'A' }]));
    expect([r.code, r.json.code, read(lockPath(plan))]).toEqual([4, 'LOCK_STALE', stale]);
  });
});

describe('backups and restore', () => {
  it('lists backups and restores one: the exact bytes come back, and the current file is backed up first', () => {
    const { dir, plan, revision } = samplePlan(), original = read(plan);
    run(dir, 'apply', 'plan.json', commands(dir, revision, [{ op: 'set_plan_name', name: 'Changed' }]));
    const changed = read(plan), [first] = run(dir, 'backups', 'plan.json').json.backups;
    expect(first.revision).toBe(revision);
    const r = run(dir, 'restore', 'plan.json', first.name);
    expect([r.code, r.json.revision, read(plan)]).toEqual([0, revision, original]);
    expect(read(join(`${plan}.backups`, r.json.backup))).toBe(changed);
  });
  it('refuses a name that is not a listed backup, a path, and a backup that is not a readable plan', () => {
    const { dir, plan } = samplePlan(), before = read(plan);
    expect(run(dir, 'restore', 'plan.json', '../plan.json').json.code).toBe('BACKUP_NOT_FOUND');
    expect(run(dir, 'restore', 'plan.json', `20260101T000000000Z-${'a'.repeat(64)}.json`).json.code).toBe('BACKUP_NOT_FOUND');
    mkdirSync(`${plan}.backups`);
    const bad = `20260101T000000000Z-${'b'.repeat(64)}.json`;
    writeFileSync(join(`${plan}.backups`, bad), '{"schemaVersion":2}');
    expect(run(dir, 'restore', 'plan.json', bad)).toMatchObject({ code: 1, json: { code: 'BACKUP_INVALID' } });
    expect(read(plan)).toBe(before);
  });
  it('a v1 backup must pass the complete migration: one that only passes the preliminary check is refused', () => {
    const { dir, plan } = samplePlan(), before = read(plan);
    mkdirSync(`${plan}.backups`);
    // Both pass checkDocumentV1 but the migration cannot read them (an unknown wall type is only a report note).
    const breaks = [(v: any) => { v.openings[0].type = 'portal'; }, (v: any) => { v.walls[0].rect = [10, 0, 0, 10]; }];
    const names = breaks.map((change, i) => {
      const v1 = JSON.parse(read(V1_SAMPLE)), name = `2026010${i + 1}T000000000Z-${'c'.repeat(64)}.json`;
      change(v1); writeFileSync(join(`${plan}.backups`, name), JSON.stringify(v1));
      expect(run(dir, 'validate', join(`${plan}.backups`, name)).json.errors[0].code).toBe('v1-unreadable');
      return name;
    });
    for (const name of names) expect(run(dir, 'restore', 'plan.json', name)).toMatchObject({ code: 1, json: { code: 'BACKUP_INVALID' } });
    expect([read(plan), backupsOf(plan)]).toEqual([before, names]);
    const good = `20260109T000000000Z-${'d'.repeat(64)}.json`;
    writeFileSync(join(`${plan}.backups`, good), read(V1_SAMPLE));
    expect([run(dir, 'restore', 'plan.json', good).code, read(plan)]).toEqual([0, read(V1_SAMPLE)]);
  });
});

describe('usage', () => {
  it('unknown commands, wrong argument counts and unknown options are usage errors (exit 2)', () => {
    const dir = folder();
    expect(run(dir, 'paint').code).toBe(2);
    expect(run(dir, 'validate').code).toBe(2);
    expect(run(dir, 'validate', 'a.json', '--colour').code).toBe(2);
    expect(run(dir, 'validate', 'a.json', '--sample').code).toBe(2);
  });
});

describe('100 parallel apply calls with the same starting revision', () => {
  it('exactly one succeeds; the others get REVISION_CONFLICT; the file is valid, and there is exactly one backup', async () => {
    const { dir, plan, revision } = samplePlan(), before = readFileSync(plan);
    for (let i = 0; i < 100; i++) commands(dir, revision, [{ op: 'set_plan_name', name: `caller-${i}` }], `c${i}.json`);
    const results = await Promise.all(Array.from({ length: 100 }, (_, i) => runAsync(dir, 'apply', 'plan.json', `c${i}.json`)));
    const winners = results.filter(r => r.code === 0), losers = results.filter(r => r.code !== 0);
    const outcome = (r: { code: number; json: any; err: string }) => `${r.code} ${r.json?.code ?? r.err.slice(0, 120)}`;
    const counts = Object.entries(Object.groupBy(results.map(outcome), x => x)).map(([k, v]) => `${k} ×${v!.length}`).sort();
    expect(counts).toEqual(['0  ×1', '3 REVISION_CONFLICT ×99']);
    expect(winners).toHaveLength(1);
    expect(losers.every(r => r.code === 3 && r.json.code === 'REVISION_CONFLICT' && r.json.currentRevision === winners[0].json.revision)).toBe(true);
    const text = read(plan), name = JSON.parse(text).name;
    expect([sha(text), results.findIndex(r => r.code === 0)]).toEqual([winners[0].json.revision, Number(name.slice(7))]);
    expect(backupsOf(plan)).toHaveLength(1);
    expect(readFileSync(join(`${plan}.backups`, backupsOf(plan)[0])).equals(before)).toBe(true);
    expect(readdirSync(dir).filter(f => f.endsWith('.tmp') || f.endsWith('.lock'))).toEqual([]);
  }, 60_000);
});
