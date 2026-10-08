import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { CLI, folder, mcpClient, read, run, V1_SAMPLE } from './helpers.js';

// The MCP server (roadmap C5a), tested through the built CLI's `mcp` command over stdio with the SDK client, as an
// agent uses it.
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const repo = new URL('../../../', import.meta.url).pathname;
const examplePlan = JSON.parse(/```json\n([\s\S]*?)```/.exec(readFileSync(join(repo, 'docs/plan-format.md'), 'utf8'))![1]);
const READ_ONLY = ['get_guide', 'get_schema', 'read_plan', 'plan_info', 'validate_plan', 'render_preview'];
const DESTRUCTIVE = ['write_plan', 'apply_commands', 'migrate_plan'];
type Mcp = Awaited<ReturnType<typeof mcpClient>>;

/** A workspace with the sample plan, and a connected client. */
async function workspace() {
  const dir = folder();
  expect(run(dir, 'new', 'plan.json', '--sample').code).toBe(0);
  const mcp = await mcpClient(dir);
  return { dir, plan: join(dir, 'plan.json'), mcp, revision: sha(readFileSync(join(dir, 'plan.json'))) };
}
const open: Mcp[] = [];
async function connected() { const w = await workspace(); open.push(w.mcp); return w; }
afterAll(async () => { await Promise.all(open.map(m => m.close())); });
const backupsOf = (plan: string) => existsSync(`${plan}.backups`) ? readdirSync(`${plan}.backups`) : [];

describe('MCP: connection, tools, guide', () => {
  let mcp: Mcp;
  beforeAll(async () => { mcp = (await connected()).mcp; });
  it('gives the server name, the short instructions, and the ten tools with their annotations and closed input schemas', async () => {
    expect(mcp.client.getServerVersion()).toMatchObject({ name: 'open-plan', version: '0.1.0' });
    const instructions = mcp.client.getInstructions()!;
    expect(instructions).toContain('## Work loop');
    expect(instructions).toContain(readFileSync(join(repo, 'docs/agent-guide/image-to-plan.md'), 'utf8').trim());
    expect(instructions).toContain('`get_guide`');
    expect(instructions).not.toContain('#### `scale_plan`');
    const { tools } = await mcp.client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual([...READ_ONLY, 'create_plan', ...DESTRUCTIVE].sort());
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(READ_ONLY.includes(t.name));
      if (!READ_ONLY.includes(t.name)) expect(t.annotations?.destructiveHint, t.name).toBe(DESTRUCTIVE.includes(t.name));
      expect(t.inputSchema.additionalProperties, t.name).toBe(false);
      expect(t.description!.length, t.name).toBeGreaterThan(60);
    }
  });
  it('get_guide, the guide resource and the prompt give the same full guide as `guide --form mcp`', async () => {
    const text = run(repo, 'guide', '--form', 'mcp').json.text;
    expect(text).toContain('#### `scale_plan`');
    expect((await mcp.call('get_guide')).result.text).toBe(text);
    expect((await mcp.client.readResource({ uri: 'open-plan://guide' })).contents[0]).toMatchObject({ mimeType: 'text/markdown', text });
    const prompt = await mcp.client.getPrompt({ name: 'convert_floor_plan_image', arguments: { path: 'flat.json' } });
    const message = (prompt.messages[0].content as { text: string }).text;
    expect(message).toContain('flat.json');
    expect(message.endsWith(text)).toBe(true);
  });
  it('get_schema gives the same schema and description as the CLI', async () => {
    const { result } = await mcp.call('get_schema');
    expect(result).toEqual(run(repo, 'schema').json);
  });
  it('bad arguments are USAGE errors; an unknown tool is a protocol error', async () => {
    expect((await mcp.call('read_plan', {})).result).toMatchObject({ ok: false, code: 'USAGE' });
    expect((await mcp.call('read_plan', { path: 'plan.json', extra: 1 })).result).toMatchObject({ ok: false, code: 'USAGE' });
    expect((await mcp.call('validate_plan', {})).result).toMatchObject({ ok: false, code: 'USAGE' });
    expect((await mcp.call('validate_plan', { path: 'plan.json', plan: {} })).result).toMatchObject({ ok: false, code: 'USAGE' });
    expect((await mcp.call('render_preview', { path: 'plan.json', crop: [1, 2, 3] })).isError).toBe(true);
    // Inherited property names, as they arrive from JSON: own keys "constructor", "__proto__", "toString".
    for (const json of ['{"constructor":1}', '{"__proto__":1}', '{"toString":1}', '{"path":"plan.json","hasOwnProperty":1}']) {
      for (const tool of ['get_schema', 'read_plan']) {
        const args = JSON.parse(json);
        if (tool === 'read_plan' && !('path' in args && Object.hasOwn(args, 'path'))) args.path = 'plan.json';
        expect((await mcp.call(tool, args)).result, `${tool} ${json}`).toMatchObject({ ok: false, code: 'USAGE' });
      }
    }
    await expect(mcp.client.callTool({ name: 'no_tool', arguments: {} })).rejects.toThrow(/Unknown tool/);
  });
});

/** The fields that the CLI and MCP share (roadmap C5); a backup name is compared without its time. */
function shared(result: any) {
  const keys = ['ok', 'code', 'errors', 'warnings', 'revision', 'previousRevision', 'currentRevision', 'notes', 'migrationReport'];
  const out: Record<string, unknown> = Object.fromEntries(keys.filter(k => k in result).map(k => [k, result[k]]));
  if ('backup' in result) out.backup = result.backup && result.backup.replace(/^\d{8}T\d{9}Z-/, '');
  return out;
}

describe('MCP: the shared fields equal the CLI --json result for the same operation', () => {
  it('validate, info, render, apply, migrate, and a refusal of each kind', async () => {
    const cliDir = folder(), { dir, mcp } = await connected();
    const files: Record<string, string> = {
      'plan.json': read(join(dir, 'plan.json')),
      'bad.json': JSON.stringify({ ...examplePlan, openings: [{ ...examplePlan.openings[0], offset: 7900 }, ...examplePlan.openings.slice(1)] }),
      'tolerable.json': JSON.stringify({ ...examplePlan, rooms: [{ ...examplePlan.rooms[0], poly: examplePlan.rooms[0].poly.map(([x, y]: number[]) => [x + 7, y]) }] }),
      'v1.json': read(V1_SAMPLE),
      'text.json': 'not json',
    };
    for (const d of [cliDir, dir]) for (const [name, text] of Object.entries(files)) writeFileSync(join(d, name), text);
    const revision = sha(files['plan.json']);
    const pairs: [string, any, string, Record<string, unknown>][] = [];
    for (const f of Object.keys(files)) {
      pairs.push([`validate ${f}`, run(cliDir, 'validate', f).json, 'validate_plan', { path: f }]);
      pairs.push([`info ${f}`, run(cliDir, 'info', f).json, 'plan_info', { path: f }]);
      pairs.push([`render ${f}`, run(cliDir, 'render', f, 'out.png', '--width', '300', '--no-text').json, 'render_preview', { path: f, width: 300, text: false }]);
    }
    const batch = (name: string, commands: unknown[], rev = revision) => { writeFileSync(join(cliDir, name), JSON.stringify({ expectedRevision: rev, commands })); return name; };
    pairs.push(['apply refused', run(cliDir, 'apply', 'plan.json', batch('c1.json', [{ op: 'delete_wall', wallId: 'none' }])).json, 'apply_commands', { path: 'plan.json', expectedRevision: revision, commands: [{ op: 'delete_wall', wallId: 'none' }] }]);
    pairs.push(['apply stale', run(cliDir, 'apply', 'plan.json', batch('c2.json', [], '0'.repeat(64))).json, 'apply_commands', { path: 'plan.json', expectedRevision: '0'.repeat(64), commands: [] }]);
    pairs.push(['apply unchanged', run(cliDir, 'apply', 'plan.json', batch('c3.json', [{ op: 'set_plan_name', name: JSON.parse(files['plan.json']).name }])).json, 'apply_commands', { path: 'plan.json', expectedRevision: revision, commands: [{ op: 'set_plan_name', name: JSON.parse(files['plan.json']).name }] }]);
    pairs.push(['migrate', run(cliDir, 'migrate', 'v1.json', 'v2.json').json, 'migrate_plan', { source: 'v1.json', destination: 'v2.json' }]);
    pairs.push(['migrate not v1', run(cliDir, 'migrate', 'plan.json', 'v3.json').json, 'migrate_plan', { source: 'plan.json', destination: 'v3.json' }]);
    pairs.push(['apply written', run(cliDir, 'apply', 'plan.json', batch('c4.json', [{ op: 'add_wall', type: 'n', a: [0, 0], b: [500, 0], thickness: 100 }])).json, 'apply_commands', { path: 'plan.json', expectedRevision: revision, commands: [{ op: 'add_wall', type: 'n', a: [0, 0], b: [500, 0], thickness: 100 }] }]);
    for (const [name, cli, tool, args] of pairs) {
      const { result, isError } = await mcp.call(tool, args);
      expect(shared(result), name).toEqual(shared(cli));
      expect(isError, name).toBe(!cli.ok);
    }
    expect(read(join(dir, 'plan.json'))).toBe(read(join(cliDir, 'plan.json')));
    expect(read(join(dir, 'v2.json'))).toBe(read(join(cliDir, 'v2.json')));
  });
  it('render_preview gives a PNG of the given size, the same pixels as the CLI, and accepts a negative crop', async () => {
    const { dir, mcp } = await connected();
    const r = await mcp.call('render_preview', { path: 'plan.json', crop: [-500, -500, 4000, 2000], width: 450, text: false, grid: true });
    expect(r.result).toMatchObject({ ok: true, width: 450, height: 250 });
    const image = r.content.find(c => c.type === 'image');
    expect(image.mimeType).toBe('image/png');
    expect(run(dir, 'render', 'plan.json', 'cli.png', '--crop=-500,-500,4000,2000', '--width', '450', '--no-text', '--grid').code).toBe(0);
    expect(Buffer.from(image.data, 'base64').equals(readFileSync(join(dir, 'cli.png')))).toBe(true);
    expect(PNG.sync.read(Buffer.from(image.data, 'base64')).height).toBe(250);
  });
  it('render_preview limits: width 1 to 2000, at most 2000 px high and 4 million px', async () => {
    const { mcp } = await connected();
    expect((await mcp.call('render_preview', { path: 'plan.json', width: 2001 })).result).toMatchObject({ ok: false, code: 'USAGE' });
    expect((await mcp.call('render_preview', { path: 'plan.json', width: 2000, crop: [0, 0, 1000, 1001], text: false })).result).toMatchObject({ ok: false, code: 'USAGE', width: 2000, height: 2002 });
    expect((await mcp.call('render_preview', { path: 'plan.json', width: 2000, crop: [0, 0, 1000, 1000], text: false })).result).toMatchObject({ ok: true, width: 2000, height: 2000 });
  });
});

describe('MCP: read_plan and validate_plan', () => {
  it('read_plan gives the JSON as it is in the file and the revision of the same bytes', async () => {
    const { dir, mcp } = await connected();
    const text = '{"schemaVersion":2,  "name":"Raw"}';
    writeFileSync(join(dir, 'raw.json'), text);
    expect((await mcp.call('read_plan', { path: 'raw.json' })).result).toEqual({ ok: true, revision: sha(text), schemaVersion: 2, plan: { schemaVersion: 2, name: 'Raw' }, notices: [] });
    writeFileSync(join(dir, 'bad.json'), 'not json');
    expect((await mcp.call('read_plan', { path: 'bad.json' })).result).toMatchObject({ ok: false, code: 'JSON_INVALID', revision: sha('not json') });
    expect((await mcp.call('read_plan', { path: 'none.json' })).result).toMatchObject({ ok: false, code: 'FILE_NOT_FOUND' });
  });
  it('validate_plan with an inline plan: the strict rules, no revision', async () => {
    const { mcp } = await connected();
    expect((await mcp.call('validate_plan', { plan: examplePlan })).result).toEqual({ ok: true, schemaVersion: 2, warnings: [], migrationReport: [], notices: [] });
    const bad = await mcp.call('validate_plan', { plan: { ...examplePlan, walls: [] } });
    expect(bad.isError).toBe(true);
    expect(bad.result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(bad.result).not.toHaveProperty('revision');
  });
});

describe('MCP: create_plan and write_plan', () => {
  it('create_plan never replaces a file; a new file has no backup', async () => {
    const { dir, plan, mcp } = await connected();
    const before = read(plan);
    const refused = await mcp.call('create_plan', { path: 'plan.json' });
    expect(refused.result).toMatchObject({ ok: false, code: 'DESTINATION_EXISTS' });
    expect(refused.result.message).toContain('write_plan');
    expect(read(plan)).toBe(before);
    expect((await mcp.call('create_plan', { path: 'empty.json' })).result).toMatchObject({ ok: true, backup: null, revision: sha(readFileSync(join(dir, 'empty.json'))) });
  });
  it('a new file: written without expectedRevision; with one, REVISION_CONFLICT and nothing is created', async () => {
    const { dir, mcp } = await connected();
    const r = await mcp.call('write_plan', { path: 'new.json', plan: examplePlan });
    expect(r.result).toMatchObject({ ok: true, backup: null, previousRevision: null, revision: sha(readFileSync(join(dir, 'new.json'))) });
    // Written in the normal format: 2-space JSON with a final newline.
    expect(read(join(dir, 'new.json'))).toBe(`${JSON.stringify(JSON.parse(read(join(dir, 'new.json'))), null, 2)}\n`);
    expect(run(dir, 'validate', 'new.json').code).toBe(0);
    expect((await mcp.call('write_plan', { path: 'gone.json', plan: examplePlan, expectedRevision: '1'.repeat(64) })).result).toMatchObject({ ok: false, code: 'REVISION_CONFLICT', currentRevision: null });
    expect(existsSync(join(dir, 'gone.json'))).toBe(false);
  });
  it('an existing file: no revision is DESTINATION_EXISTS, a stale one (an external edit) REVISION_CONFLICT; the right one replaces it after a backup', async () => {
    const { dir, plan, mcp, revision } = await connected();
    const next = { ...examplePlan, name: 'Replaced' };
    expect((await mcp.call('write_plan', { path: 'plan.json', plan: next })).result).toMatchObject({ ok: false, code: 'DESTINATION_EXISTS' });
    // An external edit after the caller read the revision.
    const edited = read(plan).replace('"name": "', '"name": "Edited ');
    writeFileSync(plan, edited);
    expect((await mcp.call('write_plan', { path: 'plan.json', plan: next, expectedRevision: revision })).result).toMatchObject({ ok: false, code: 'REVISION_CONFLICT', currentRevision: sha(edited) });
    expect([read(plan), backupsOf(plan)]).toEqual([edited, []]);
    const written = await mcp.call('write_plan', { path: 'plan.json', plan: next, expectedRevision: sha(edited) });
    expect(written.result).toMatchObject({ ok: true, previousRevision: sha(edited), revision: sha(readFileSync(plan)) });
    expect(JSON.parse(read(plan)).name).toBe('Replaced');
    expect(read(join(`${plan}.backups`, written.result.backup))).toBe(edited);
  });
  it('a plan equal to the current plan is not written: the bytes, the revision and no backup stay', async () => {
    const { dir, mcp } = await connected();
    const minified = JSON.stringify(examplePlan);
    writeFileSync(join(dir, 'min.json'), minified);
    const r = await mcp.call('write_plan', { path: 'min.json', plan: examplePlan, expectedRevision: sha(minified) });
    expect(r.result).toMatchObject({ ok: true, revision: sha(minified), previousRevision: sha(minified), backup: null });
    expect([read(join(dir, 'min.json')), backupsOf(join(dir, 'min.json'))]).toEqual([minified, []]);
  });
  it('an invalid plan, a v1 plan and a failed backup write nothing', async () => {
    const { plan, mcp, revision } = await connected();
    const before = read(plan);
    expect((await mcp.call('write_plan', { path: 'plan.json', plan: { ...examplePlan, walls: [] }, expectedRevision: revision })).result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect((await mcp.call('write_plan', { path: 'plan.json', plan: JSON.parse(read(V1_SAMPLE)), expectedRevision: revision })).result).toMatchObject({ ok: false, code: 'NOT_VERSION_2' });
    writeFileSync(`${plan}.backups`, 'not a folder');
    expect((await mcp.call('write_plan', { path: 'plan.json', plan: examplePlan, expectedRevision: revision })).result).toMatchObject({ ok: false, code: 'BACKUP_FAILED' });
    expect(read(plan)).toBe(before);
  });
  it('two creators at the same time: one writes, the other gets DESTINATION_EXISTS', async () => {
    const dir = folder();
    const clients = await Promise.all([mcpClient(dir), mcpClient(dir)]);
    open.push(...clients);
    for (let round = 0; round < 5; round++) {
      const name = `race${round}.json`;
      const results = await Promise.all(clients.map((c, i) => c.call('write_plan', { path: name, plan: { ...examplePlan, name: `Creator ${i}` } })));
      expect(results.map(r => r.result.ok ? 'ok' : r.result.code).sort(), name).toEqual(['DESTINATION_EXISTS', 'ok']);
      const winner = results.findIndex(r => r.result.ok);
      expect(JSON.parse(read(join(dir, name))).name).toBe(`Creator ${winner}`);
      expect(backupsOf(join(dir, name))).toEqual([]);
    }
  });
});

describe('MCP: apply_commands and migrate_plan', () => {
  it('apply_commands: a backup with the previous bytes, and a stale revision changes nothing', async () => {
    const { plan, mcp, revision } = await connected();
    const before = read(plan);
    const r = await mcp.call('apply_commands', { path: 'plan.json', expectedRevision: revision, commands: [{ op: 'set_plan_name', name: 'MCP' }] });
    expect(r.result).toMatchObject({ ok: true, previousRevision: revision });
    expect(read(join(`${plan}.backups`, r.result.backup))).toBe(before);
    expect((await mcp.call('apply_commands', { path: 'plan.json', expectedRevision: revision, commands: [] })).result).toMatchObject({ ok: false, code: 'REVISION_CONFLICT', currentRevision: r.result.revision });
  });
  it('migrate_plan: a new destination; an existing one needs its revision; in place with the revision', async () => {
    const { dir, mcp } = await connected();
    copyFileSync(V1_SAMPLE, join(dir, 'v1.json'));
    expect((await mcp.call('migrate_plan', { source: 'v1.json', destination: 'plan.json' })).result).toMatchObject({ ok: false, code: 'DESTINATION_EXISTS' });
    const revision = sha(readFileSync(join(dir, 'plan.json')));
    const replaced = await mcp.call('migrate_plan', { source: 'v1.json', destination: 'plan.json', expectedRevision: revision });
    expect(replaced.result).toMatchObject({ ok: true });
    expect(replaced.result.backup).toContain(revision);
    const v1 = sha(readFileSync(join(dir, 'v1.json')));
    expect((await mcp.call('migrate_plan', { source: 'v1.json', destination: 'v1.json' })).result).toMatchObject({ ok: false, code: 'DESTINATION_EXISTS' });
    const inPlace = await mcp.call('migrate_plan', { source: 'v1.json', destination: 'v1.json', expectedRevision: v1 });
    expect(inPlace.result).toMatchObject({ ok: true });
    expect(JSON.parse(read(join(dir, 'v1.json'))).schemaVersion).toBe(2);
  });
  it('migrate_plan: a destination deleted after the caller read it is REVISION_CONFLICT, and nothing is created', async () => {
    const { dir, mcp } = await connected();
    copyFileSync(V1_SAMPLE, join(dir, 'v1.json'));
    const seen = (await mcp.call('read_plan', { path: 'plan.json' })).result.revision;
    // Another program deletes the destination between the read and the locked operation.
    rmSync(join(dir, 'plan.json'));
    expect((await mcp.call('migrate_plan', { source: 'v1.json', destination: 'plan.json', expectedRevision: seen })).result).toMatchObject({ ok: false, code: 'REVISION_CONFLICT', currentRevision: null });
    expect(existsSync(join(dir, 'plan.json'))).toBe(false);
  });
});

describe('MCP: input limits', () => {
  it('a plan file larger than 5,242,880 bytes is refused after a bounded read, also a 10 GB sparse file', async () => {
    const { dir, mcp } = await connected();
    writeFileSync(join(dir, 'big.json'), `{"name":"${'x'.repeat(5_242_880)}"}`);
    writeFileSync(join(dir, 'huge.json'), ''); truncateSync(join(dir, 'huge.json'), 10 * 2 ** 30);
    for (const [tool, args] of [['read_plan', {}], ['plan_info', {}], ['validate_plan', {}], ['render_preview', {}], ['apply_commands', { expectedRevision: '0'.repeat(64), commands: [] }]] as const) {
      for (const path of ['big.json', 'huge.json']) {
        const started = Date.now();
        expect((await mcp.call(tool, { path, ...args })).result, `${tool} ${path}`).toMatchObject({ ok: false, code: 'INPUT_TOO_LARGE', limit: 5_242_880 });
        expect(Date.now() - started, `${tool} ${path}: bounded`).toBeLessThan(3000);
      }
    }
    expect((await mcp.call('read_plan', { path: 'plan.json' })).result.ok).toBe(true);
  });
  it('an inline plan, a batch of more than 1000 commands, and commands of more than 1,048,576 bytes are refused before the lock', async () => {
    const { plan, mcp, revision } = await connected();
    const before = read(plan);
    const big = { ...examplePlan, name: 'x'.repeat(5_242_880) };
    expect((await mcp.call('validate_plan', { plan: big })).result).toMatchObject({ ok: false, code: 'INPUT_TOO_LARGE', limit: 5_242_880 });
    expect((await mcp.call('write_plan', { path: 'plan.json', plan: big, expectedRevision: revision })).result).toMatchObject({ ok: false, code: 'INPUT_TOO_LARGE' });
    const many = Array.from({ length: 1001 }, () => ({ op: 'set_plan_name', name: 'n' }));
    expect((await mcp.call('apply_commands', { path: 'plan.json', expectedRevision: revision, commands: many })).result).toMatchObject({ ok: false, code: 'INPUT_TOO_LARGE', limit: 1000 });
    const long = [{ op: 'set_plan_name', name: 'x'.repeat(1_048_576) }];
    expect((await mcp.call('apply_commands', { path: 'plan.json', expectedRevision: revision, commands: long })).result).toMatchObject({ ok: false, code: 'INPUT_TOO_LARGE', limit: 1_048_576 });
    expect([read(plan), backupsOf(plan), existsSync(`${plan}.lock`)]).toEqual([before, [], false]);
  });
});

describe('MCP: the workspace boundary', () => {
  it('refuses ../, an absolute path outside, and links that point out; a missing file outside is not reported as missing', async () => {
    const { dir, mcp, revision } = await connected();
    const outside = folder();
    writeFileSync(join(outside, 'secret.json'), JSON.stringify(examplePlan));
    mkdirSync(join(dir, 'sub'));
    symlinkSync(join(outside, 'secret.json'), join(dir, 'link.json'));
    symlinkSync(outside, join(dir, 'out'));
    const refused = [
      ['read_plan', { path: '../x.json' }], ['read_plan', { path: join(outside, 'secret.json') }], ['read_plan', { path: 'link.json' }],
      ['read_plan', { path: 'out/secret.json' }], ['read_plan', { path: 'sub/../../x.json' }], ['read_plan', { path: join(outside, 'none', 'x.json') }],
      ['validate_plan', { path: 'link.json' }], ['plan_info', { path: 'out/secret.json' }], ['render_preview', { path: 'link.json' }],
      ['create_plan', { path: 'out/new.json' }], ['write_plan', { path: 'out/new.json', plan: examplePlan }],
      ['write_plan', { path: 'link.json', plan: examplePlan, expectedRevision: sha(JSON.stringify(examplePlan)) }],
      ['apply_commands', { path: 'link.json', expectedRevision: sha(JSON.stringify(examplePlan)), commands: [{ op: 'set_plan_name', name: 'X' }] }],
      ['migrate_plan', { source: 'plan.json', destination: '../v2.json' }], ['migrate_plan', { source: 'out/secret.json', destination: 'v2.json' }],
      ['read_plan', { path: '.' }],
    ] as const;
    for (const [tool, args] of refused) expect((await mcp.call(tool, args)).result, `${tool} ${JSON.stringify(args).slice(0, 80)}`).toMatchObject({ ok: false, code: 'PATH_OUTSIDE_WORKSPACE' });
    expect(readdirSync(outside).sort()).toEqual(['secret.json']);
    expect(read(join(outside, 'secret.json'))).toBe(JSON.stringify(examplePlan));
    // A link that stays inside is used through its target; an absolute path inside is accepted.
    symlinkSync(join(dir, 'plan.json'), join(dir, 'inside.json'));
    expect((await mcp.call('read_plan', { path: 'inside.json' })).result).toMatchObject({ ok: true, revision });
    expect((await mcp.call('read_plan', { path: join(dir, 'plan.json') })).result).toMatchObject({ ok: true, revision });
  });
  it('a hard-linked plan and a symlinked backup folder are refused, and nothing is written', async () => {
    const { dir, plan, mcp, revision } = await connected();
    const outside = folder();
    linkSync(plan, join(dir, 'hard.json'));
    expect((await mcp.call('apply_commands', { path: 'plan.json', expectedRevision: revision, commands: [{ op: 'set_plan_name', name: 'X' }] })).result).toMatchObject({ ok: false, code: 'PLAN_HARD_LINKED' });
    const other = join(dir, 'other.json');
    expect(run(dir, 'new', 'other.json', '--sample').code).toBe(0);
    symlinkSync(outside, `${other}.backups`);
    const before = read(other);
    expect((await mcp.call('apply_commands', { path: 'other.json', expectedRevision: sha(before), commands: [{ op: 'set_plan_name', name: 'X' }] })).result).toMatchObject({ ok: false, code: 'PATH_OUTSIDE_WORKSPACE' });
    expect((await mcp.call('write_plan', { path: 'other.json', plan: examplePlan, expectedRevision: sha(before) })).result).toMatchObject({ ok: false, code: 'PATH_OUTSIDE_WORKSPACE' });
    expect([read(other), readdirSync(outside)]).toEqual([before, []]);
  });
  it('a relative path is resolved against the root, not against the folder where the server runs', async () => {
    const root = folder(), elsewhere = folder();
    expect(run(root, 'new', 'plan.json').code).toBe(0);
    const mcp = await mcpClient(root, elsewhere);
    open.push(mcp);
    expect((await mcp.call('read_plan', { path: 'plan.json' })).result.ok).toBe(true);
    expect((await mcp.call('create_plan', { path: 'made.json' })).result.ok).toBe(true);
    expect([existsSync(join(root, 'made.json')), existsSync(join(elsewhere, 'made.json'))]).toEqual([true, false]);
  });
});

describe('MCP: the process', () => {
  it('stdout has only MCP messages, also for refusals and errors; --json and a missing root are refused on stderr', async () => {
    const dir = folder();
    const child = spawn(process.execPath, [CLI, 'mcp', '--root', dir], { cwd: dir });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'create_plan', arguments: { path: 'plan.json', sample: true } } });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_plan', arguments: { path: '../x' } } });
    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'render_preview', arguments: { path: 'plan.json', width: 200, text: false } } });
    send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nothing', arguments: {} } });
    await new Promise<void>(done => { const t = setInterval(() => { if (out.split('\n').filter(Boolean).length >= 5) { clearInterval(t); done(); } }, 20); });
    child.stdin.end();
    const code = await new Promise(done => child.on('close', done));
    const lines = out.split('\n').filter(Boolean).map(l => JSON.parse(l));
    expect(lines.every(l => l.jsonrpc === '2.0')).toBe(true);
    expect(lines.map(l => l.id).sort()).toEqual([1, 2, 3, 4, 5]);   // requests run at the same time
    expect(code).toBe(0);
    expect(err).toBe('');
    const json = spawn(process.execPath, [CLI, 'mcp', '--json'], { cwd: dir });
    let jsonOut = '';
    json.stdout.on('data', d => { jsonOut += d; });
    expect([await new Promise(done => json.on('close', done)), jsonOut]).toEqual([2, '']);
    const missing = spawn(process.execPath, [CLI, 'mcp', '--root', join(dir, 'none')]);
    let missingOut = '', missingErr = '';
    missing.stdout.on('data', d => { missingOut += d; }); missing.stderr.on('data', d => { missingErr += d; });
    expect([await new Promise(done => missing.on('close', done)), missingOut]).toEqual([1, '']);
    expect(missingErr).toContain('FILE_NOT_FOUND');
  });
  it('malformed calls with large arguments are refused and leave nothing behind; own "__proto__" arguments are USAGE; then a valid call works', async () => {
    const dir = folder();
    expect(run(dir, 'new', 'plan.json', '--sample').code).toBe(0);
    const child = spawn(process.execPath, [CLI, 'mcp', '--root', dir], { cwd: dir });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    const send = (text: string) => child.stdin.write(`${text}\n`);
    const answers = () => out.split('\n').filter(Boolean).map(l => JSON.parse(l));
    const until = (n: number) => new Promise<void>(done => { const t = setInterval(() => { if (answers().length >= n) { clearInterval(t); done(); } }, 20); });
    send(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '0' } } }));
    send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    const big = 'x'.repeat(1_000_000);
    // Rejected by the SDK's request check before any tool runs: a name that is not a string, arguments that are a list.
    for (let i = 1; i <= 20; i++) send(JSON.stringify({ jsonrpc: '2.0', id: i, method: 'tools/call', params: i % 2 ? { name: 7, arguments: { plan: big } } : { name: 'validate_plan', arguments: [big] } }));
    // Own "__proto__" keys, written as JSON text: answered with the tool's argument check.
    send(`{"jsonrpc":"2.0","id":21,"method":"tools/call","params":{"name":"get_schema","arguments":{"__proto__":{"plan":"${big}"}}}}`);
    send('{"jsonrpc":"2.0","id":22,"method":"tools/call","params":{"name":"read_plan","arguments":{"path":"plan.json","__proto__":1}}}');
    send('{"jsonrpc":"2.0","id":23,"method":"tools/call","params":{"name":"no_tool","arguments":{"__proto__":1}}}');
    send(JSON.stringify({ jsonrpc: '2.0', id: 24, method: 'tools/call', params: { name: 'read_plan', arguments: { path: 'plan.json' } } }));
    await until(25);
    child.stdin.end();
    await new Promise(done => child.on('close', done));
    const byId = new Map(answers().map(a => [a.id, a]));
    for (let i = 1; i <= 20; i++) expect([typeof byId.get(i)?.error?.code, byId.get(i)?.result], `malformed ${i}`).toEqual(['number', undefined]);
    for (const id of [21, 22]) expect(byId.get(id)?.result?.structuredContent, `__proto__ ${id}`).toMatchObject({ ok: false, code: 'USAGE' });
    expect(byId.get(21).result.structuredContent.message).toContain('"__proto__"');
    expect(byId.get(23)?.error?.message).toMatch(/Unknown tool/);
    expect(byId.get(24)?.result?.structuredContent).toMatchObject({ ok: true, revision: sha(readFileSync(join(dir, 'plan.json'))) });
  });
});
