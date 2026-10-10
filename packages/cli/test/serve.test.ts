import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer, request } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { acquireLock, lockPath, releaseLock } from '../src/lock.js';
import { isWildcardAddress, startServer, type RunningServer } from '../src/serve.js';
import { CLI, folder, read, run, V1_SAMPLE } from './helpers.js';

const EDITOR = new URL('../dist/editor/', import.meta.url).pathname;
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const running: RunningServer[] = [];
afterEach(async () => { await Promise.all(running.splice(0).map(s => s.close())); });

/** A folder with the sample plan and a server on a free port. */
async function served(options: Partial<Parameters<typeof startServer>[0]> = {}) {
  const dir = folder(), plan = join(dir, 'plan.json');
  expect(run(dir, 'new', 'plan.json', '--sample').code).toBe(0);
  const server = await startServer({ file: plan, port: 0, editorDir: EDITOR, ...options });
  running.push(server);
  return { dir, plan, server };
}
interface Reply { status: number; json: any; headers: Record<string, string | string[] | undefined>; text: string }
/**
 * A raw HTTP request, so the test can set Host and Origin itself. After a response that closes the connection (a body
 * that is too large), writing the rest of the body can fail; the response is kept.
 */
function raw(port: number, { path = '/', method = 'GET', headers = {}, body, chunked = false }: { path?: string; method?: string; headers?: Record<string, string>; body?: string | Buffer; chunked?: boolean }): Promise<Reply> {
  return new Promise((done, fail) => {
    let replied: Reply | null = null;
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
        replied = { status: res.statusCode!, json, headers: res.headers, text }; done(replied);
      });
    });
    req.on('error', error => (replied ? done(replied) : fail(error)));
    // Two writes make Node send the body in chunks, with no Content-Length.
    if (chunked && body !== undefined) { const half = Math.floor(body.length / 2); req.write(body.slice(0, half)); req.end(body.slice(half)); } else req.end(body);
  });
}
/** An API request with the token, as the editor sends it. */
const api = (server: RunningServer, path: string, { method = 'GET', body, token = server.token, headers = {} }: { method?: string; body?: unknown; token?: string | null; headers?: Record<string, string> } = {}) =>
  raw(server.port, { path, method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...(token ? { 'x-open-plan-token': token } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers } });
const state = async (server: RunningServer) => (await api(server, '/api/plan')).json.state;
let ids = 0;
const id = (prefix: string) => `${prefix}-${String(++ids).padStart(6, '0')}`;
/** Writes a browser plan as the editor's autosave does. */
const put = (server: RunningServer, expectedRevision: string, plan: unknown, sessionId = 'session-aaaaaaaa', requestId = id('request'), mode?: string) =>
  api(server, '/api/plan', { method: 'PUT', body: { expectedRevision, plan, sessionId, requestId, ...(mode ? { mode } : {}) } });
const renamed = (plan: any, name: string) => ({ ...plan, name });
const backupsOf = (plan: string) => existsSync(`${plan}.backups`) ? readdirSync(`${plan}.backups`).sort() : [];

/** The event stream of one browser tab: `next` waits for the next event that matches. */
async function events(server: RunningServer) {
  const response = await fetch(`http://127.0.0.1:${server.port}/api/events`, { headers: { 'x-open-plan-token': server.token } });
  const reader = response.body!.getReader(), decoder = new TextDecoder(), queue: { type: string; data: any }[] = [];
  let buffer = '';
  const wake: { waiting: (() => void) | null } = { waiting: null };
  (async () => {
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const type = /^event: (.*)$/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
        if (type && data) { queue.push({ type, data: JSON.parse(data) }); wake.waiting?.(); }
      }
    }
  })();
  return {
    async next(match: (e: { type: string; data: any }) => boolean = () => true, timeoutMs = 3000) {
      const started = Date.now();
      for (;;) {
        const index = queue.findIndex(match);
        if (index >= 0) return queue.splice(index, 1)[0];
        if (Date.now() - started > timeoutMs) throw new Error('no matching event');
        await new Promise<void>(done => { wake.waiting = done; setTimeout(done, 50); });
      }
    },
    pending: () => queue.length,
    close: () => reader.cancel(),
  };
}

describe('serve start-up (roadmap C3a)', () => {
  it('refuses a missing file, a v1 file and a file with errors that block rendering (exit 1), and a wildcard --host (exit 2)', () => {
    const dir = folder();
    expect(run(dir, 'serve', 'none.json', '--no-open')).toMatchObject({ code: 1, json: { code: 'FILE_NOT_FOUND' } });
    writeFileSync(join(dir, 'old.json'), read(V1_SAMPLE));
    expect(run(dir, 'serve', 'old.json', '--no-open')).toMatchObject({ code: 1, json: { code: 'NOT_VERSION_2' } });
    run(dir, 'new', 'plan.json');
    const p = JSON.parse(read(join(dir, 'plan.json'))); p.walls = [{ id: 'w', type: 'e', a: [0, 0], b: [0, 0], thickness: 100 }];
    writeFileSync(join(dir, 'bad.json'), JSON.stringify(p));
    const bad = run(dir, 'serve', 'bad.json', '--no-open');
    expect([bad.code, bad.json.code, bad.json.errors[0].code]).toEqual([1, 'VALIDATION_FAILED', 'wall-zero-length']);
    expect(run(dir, 'serve', 'plan.json', '--no-open', '--host', '0.0.0.0')).toMatchObject({ code: 2, json: { code: 'USAGE' } });
    // Node binds each of these to every address (0.0.0.0 or ::).
    for (const host of ['0', '::0', '0:0:0:0:0:0:0:0']) expect(run(dir, 'serve', 'plan.json', '--no-open', '--host', host), host).toMatchObject({ code: 2, json: { code: 'USAGE' } });
    expect(run(dir, 'validate', 'plan.json', '--port', '1')).toMatchObject({ code: 2 });
  });
  it('a wildcard --host is found in every spelling; one address, also with an IPv6 zone or as a name, is not a wildcard', () => {
    for (const host of ['', '*', '0', '0x0', '0.0', '000.000.000.000', '0.0.0.0', '::', '[::]', '::0', '0:0:0:0:0:0:0:0', '::0.0.0.0', '::ffff:0.0.0.0', '::ffff:0:0', '[::ffff:0:0]', '::%en0']) expect(isWildcardAddress(host), host).toBe(true);
    for (const host of ['192.168.1.5', '10.0.0.1', '::1', '[::1]', 'fe80::1%en0', 'localhost', 'my-mac.local', '127.0.0.1']) expect(isWildcardAddress(host), host).toBe(false);
  });
  it('an explicit --port that is in use fails (exit 5); without --port, the next free port is used', async () => {
    const blocker = createServer(); await new Promise<void>(done => blocker.listen(0, '127.0.0.1', done));
    const taken = (blocker.address() as { port: number }).port, dir = folder();
    run(dir, 'new', 'plan.json');
    expect(run(dir, 'serve', 'plan.json', '--no-open', '--port', String(taken))).toMatchObject({ code: 5, json: { code: 'PORT_IN_USE', port: taken } });
    blocker.close();
    const a = await startServer({ file: join(dir, 'plan.json'), editorDir: EDITOR }); running.push(a);
    const b = await startServer({ file: join(dir, 'plan.json'), editorDir: EDITOR }); running.push(b);
    expect(b.port).toBeGreaterThan(a.port);
    expect((await state(b)).revision).toBe(sha(readFileSync(join(dir, 'plan.json'))));
  });
  it('a tolerable issue opens, with its warning in the state', async () => {
    const dir = folder(), plan = join(dir, 'plan.json');
    run(dir, 'new', 'plan.json', '--sample');
    const p = JSON.parse(read(plan)); p.rooms[0].mat = 'granite'; writeFileSync(plan, JSON.stringify(p));
    const server = await startServer({ file: plan, port: 0, editorDir: EDITOR }); running.push(server);
    const s = await state(server);
    expect([s.valid, s.warnings.map((w: any) => w.code)]).toEqual([true, ['room-material-missing']]);
  });
});

describe('browser writes', () => {
  it('the first write of a session backs up the file; later writes of that session do not; another session backs up again', async () => {
    const { plan, server } = await served(), before = readFileSync(plan);
    let s = await state(server);
    const first = await put(server, s.revision, renamed(s.plan, 'A'), 'session-one-0001');
    expect([first.status, first.json.changed, first.json.revision]).toEqual([200, true, sha(readFileSync(plan))]);
    expect(readFileSync(join(`${plan}.backups`, first.json.backup)).equals(before)).toBe(true);
    expect(read(plan)).toBe(`${JSON.stringify(renamed(s.plan, 'A'), null, 2)}\n`);
    const second = await put(server, first.json.revision, renamed(s.plan, 'B'), 'session-one-0001');
    expect([second.status, second.json.backup, backupsOf(plan).length]).toEqual([200, null, 1]);
    const other = await put(server, second.json.revision, renamed(s.plan, 'C'), 'session-two-0002');
    expect([other.status, typeof other.json.backup, backupsOf(plan).length]).toEqual([200, 'string', 2]);
  });
  it('a plan that is the same as the file is not written: a minified file keeps its bytes and revision', async () => {
    const { plan, server } = await served();
    const minified = JSON.stringify(JSON.parse(read(plan))); writeFileSync(plan, minified);
    const s = await state(server);
    const r = await put(server, s.revision, s.plan);
    expect([r.status, r.json.changed, r.json.revision, read(plan), backupsOf(plan)]).toEqual([200, false, sha(minified), minified, []]);
  });
  it('a stale revision is REVISION_CONFLICT (409) with the current state; a plan with blocking errors is 422; nothing changes', async () => {
    const { plan, server } = await served();
    const s = await state(server), before = read(plan);
    const stale = await put(server, 'f'.repeat(64), renamed(s.plan, 'X'));
    expect([stale.status, stale.json.code, stale.json.currentRevision, stale.json.state.revision]).toEqual([409, 'REVISION_CONFLICT', s.revision, s.revision]);
    const invalid = await put(server, s.revision, { ...s.plan, walls: [{ ...s.plan.walls[0], thickness: 0 }] });
    expect([invalid.status, invalid.json.code, invalid.json.errors[0].code]).toEqual([422, 'VALIDATION_FAILED', 'thickness-out-of-range']);
    expect([read(plan), backupsOf(plan)]).toEqual([before, []]);
  });
  it('a session whose first write is refused (409) still backs up the file on its next write', async () => {
    const { plan, server } = await served(), s = await state(server);
    expect((await put(server, 'e'.repeat(64), renamed(s.plan, 'A'), 'session-late-001')).status).toBe(409);
    const next = await put(server, s.revision, renamed(s.plan, 'A'), 'session-late-001');
    expect([next.status, typeof next.json.backup, backupsOf(plan).length]).toEqual([200, 'string', 1]);
  });
  it('保留我的版本 (mode keep-mine) always backs up the current file first, also after the session has written', async () => {
    const { plan, server } = await served(), s = await state(server);
    const first = await put(server, s.revision, renamed(s.plan, 'Autosaved'), 'session-keep-001');
    expect(first.json.backup).toEqual(expect.any(String));
    const external = JSON.stringify(renamed(s.plan, 'External edit'));
    writeFileSync(plan, external);
    const kept = await put(server, sha(external), renamed(s.plan, 'Mine'), 'session-keep-001', id('request'), 'keep-mine');
    expect([kept.status, typeof kept.json.backup]).toEqual([200, 'string']);
    expect(read(join(`${plan}.backups`, kept.json.backup))).toBe(external);
    expect((await put(server, kept.json.revision, s.plan, 'session-keep-001', id('request'), 'other')).status).toBe(400);
  });
  it('mode checkpoint (plan scaling, D3): the revision check of an autosave, and a backup of the current file first, also after the session has written', async () => {
    const { plan, server } = await served(), s = await state(server);
    const first = await put(server, s.revision, renamed(s.plan, 'Autosaved'), 'session-scale-001');
    const second = await put(server, first.json.revision, renamed(s.plan, 'Autosaved again'), 'session-scale-001');
    expect([typeof first.json.backup, second.json.backup]).toEqual(['string', null]);       // a later autosave makes no backup
    const beforeScale = read(plan);
    const scaled = await put(server, second.json.revision, renamed(s.plan, 'Scaled'), 'session-scale-001', id('request'), 'checkpoint');
    expect([scaled.status, typeof scaled.json.backup, read(join(`${plan}.backups`, scaled.json.backup))]).toEqual([200, 'string', beforeScale]);
    // A stale revision is refused with no backup and no change.
    const count = backupsOf(plan).length, current = read(plan);
    const stale = await put(server, second.json.revision, renamed(s.plan, 'Stale'), 'session-scale-001', id('request'), 'checkpoint');
    expect([stale.status, stale.json.code, backupsOf(plan).length, read(plan)]).toEqual([409, 'REVISION_CONFLICT', count, current]);
    // A backup that cannot be written refuses the write.
    renameSync(`${plan}.backups`, `${plan}.backups-moved`); writeFileSync(`${plan}.backups`, 'not a folder');
    const failed = await put(server, scaled.json.revision, renamed(s.plan, 'No backup'), 'session-scale-001', id('request'), 'checkpoint');
    expect([failed.status, failed.json.code, read(plan)]).toEqual([507, 'BACKUP_FAILED', current]);
  });
  it('two tabs write with the same revision at once: one succeeds, the other gets 409', async () => {
    const { plan, server } = await served(), s = await state(server);
    const results = await Promise.all([put(server, s.revision, renamed(s.plan, 'tab 1'), 'session-tab1-001'), put(server, s.revision, renamed(s.plan, 'tab 2'), 'session-tab2-002')]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const winner = results.find(r => r.status === 200)!;
    expect([JSON.parse(read(plan)).name, sha(readFileSync(plan))]).toEqual([results[0].status === 200 ? 'tab 1' : 'tab 2', winner.json.revision]);
  });
  it('a failed session backup refuses the write (507) and changes nothing; the session backs up on its next write', async () => {
    const { plan, server } = await served(), s = await state(server), before = read(plan);
    writeFileSync(`${plan}.backups`, 'not a folder');
    const failed = await put(server, s.revision, renamed(s.plan, 'A'), 'session-fail-001');
    expect([failed.status, failed.json.code, read(plan)]).toEqual([507, 'BACKUP_FAILED', before]);
    renameSync(`${plan}.backups`, join(server.plan, '..', 'moved-aside'));
    const retry = await put(server, s.revision, renamed(s.plan, 'A'), 'session-fail-001');
    expect([retry.status, typeof retry.json.backup]).toEqual([200, 'string']);
  });
});

describe('the plan path is fixed at start', () => {
  it('after a symlink to the plan is pointed at another file, every request is refused and neither file changes', async () => {
    const dir = folder();
    run(dir, 'new', 'a.json', '--sample'); run(dir, 'new', 'b.json');
    symlinkSync(join(dir, 'a.json'), join(dir, 'alias.json'));
    const server = await startServer({ file: join(dir, 'alias.json'), port: 0, editorDir: EDITOR }); running.push(server);
    const s = await state(server), a = read(join(dir, 'a.json')), b = read(join(dir, 'b.json'));
    unlinkSync(join(dir, 'alias.json')); symlinkSync(join(dir, 'b.json'), join(dir, 'alias.json'));
    const write = await put(server, sha(b), renamed(s.plan, 'Wrong file'));
    expect([write.status, write.json.code]).toEqual([409, 'PLAN_PATH_CHANGED']);
    for (const [path, options] of [['/api/plan', {}], ['/api/backups', {}], ['/api/events', {}], ['/api/browser-backups', { method: 'POST', body: { plan: s.plan, label: 'replaced' } }],
      ['/api/load-file', { method: 'POST', body: { seenRevision: sha(b), plan: s.plan } }]] as const) {
      expect((await api(server, path, options)).json?.code, path).toBe('PLAN_PATH_CHANGED');
    }
    expect([read(join(dir, 'a.json')), read(join(dir, 'b.json')), existsSync(join(dir, 'b.json.backups'))]).toEqual([a, b, false]);
  });
});

describe('change events', () => {
  it('a change while a new stream reads its first state is not lost: the stream gets the newer state', async () => {
    let release!: () => void, reading!: () => void;
    const paused = new Promise<void>(done => { release = done; }), inRead = new Promise<void>(done => { reading = done; });
    let pauseNext = false;
    const { plan, server } = await served({ pollMs: 50, testHooks: { afterInitialRead: async () => { if (pauseNext) { pauseNext = false; reading(); await paused; } } } });
    pauseNext = true;
    const tab = events(server);
    await inRead;                                                         // the first state is read; the stream is not registered yet
    writeFileSync(plan, JSON.stringify(renamed(JSON.parse(read(plan)), 'Changed during subscribe')));
    await new Promise(done => setTimeout(done, 300));                     // the checks run (or wait) during the pause
    release();
    const t = await tab;
    expect((await t.next(e => e.data.state.plan?.name === 'Changed during subscribe', 2000)).data.state.revision).toBe(sha(readFileSync(plan)));
    t.close();
  });
  it('the first event is the current state; a browser write goes to every tab with the request id of the tab that sent it', async () => {
    const { server } = await served(), tab1 = await events(server), tab2 = await events(server);
    const s = await state(server);
    expect((await tab1.next()).data).toMatchObject({ requestId: null, state: { revision: s.revision, valid: true } });
    await tab2.next();
    const written = await put(server, s.revision, renamed(s.plan, 'From tab 1'), 'session-tab1-001', 'request-tab1-0001');
    for (const tab of [tab1, tab2]) {
      const e = await tab.next(x => x.type === 'change');
      expect([e.data.requestId, e.data.state.revision, e.data.state.plan.name]).toEqual(['request-tab1-0001', written.json.revision, 'From tab 1']);
    }
    await new Promise(done => setTimeout(done, 1500));
    expect([tab1.pending(), tab2.pending()]).toEqual([0, 0]);                 // the watcher does not send the same write again
    tab1.close(); tab2.close();
  });
  it('a CLI apply and a direct file write each send a change without a request id', async () => {
    const { dir, plan, server } = await served(), tab = await events(server);
    const s = (await tab.next()).data.state;
    writeFileSync(join(dir, 'c.json'), JSON.stringify({ expectedRevision: s.revision, commands: [{ op: 'set_plan_name', name: 'By the CLI' }] }));
    const started = Date.now();
    expect(run(dir, 'apply', 'plan.json', 'c.json').code).toBe(0);
    const applied = await tab.next(e => e.data.state.plan?.name === 'By the CLI');
    expect([applied.data.requestId, applied.data.state.revision, Date.now() - started < 2000]).toEqual([null, sha(readFileSync(plan)), true]);
    writeFileSync(plan, JSON.stringify(renamed(JSON.parse(read(plan)), 'Direct edit')));
    expect((await tab.next(e => e.data.state.plan?.name === 'Direct edit')).data.requestId).toBeNull();
    tab.close();
  });
  it('the 1 s check finds a change that the folder watcher missed (a rename of another file over the plan)', async () => {
    const { dir, plan, server } = await served({ pollMs: 200 }), tab = await events(server);
    await tab.next();
    writeFileSync(join(dir, 'next.tmp'), JSON.stringify(renamed(JSON.parse(read(plan)), 'Renamed in')));
    renameSync(join(dir, 'next.tmp'), plan);
    expect((await tab.next(e => e.data.state.plan?.name === 'Renamed in')).data.state.revision).toBe(sha(readFileSync(plan)));
    tab.close();
  });
  it('a folder-watcher error closes the watcher with a notice, and the 1 s check still finds each change', async () => {
    const fake = Object.assign(new EventEmitter(), { closed: false, close() { this.closed = true; } });
    const notices: string[] = [];
    const { plan, server } = await served({ pollMs: 200, onNotice: m => notices.push(m), testHooks: { watch: (() => fake) as never } });
    const tab = await events(server);
    await tab.next();
    fake.emit('error', Object.assign(new Error('watch failed'), { code: 'EPERM' }));
    expect([fake.closed, notices.length, notices[0]]).toEqual([true, 1, expect.stringContaining('The folder watcher stopped (EPERM)')]);
    writeFileSync(plan, JSON.stringify(renamed(JSON.parse(read(plan)), 'After the watcher error')));
    expect((await tab.next(e => e.data.state.plan?.name === 'After the watcher error')).data.state.revision).toBe(sha(readFileSync(plan)));
    tab.close();
  });
  it('a folder watcher that cannot start is reported, and the 1 s check finds each change', async () => {
    const notices: string[] = [];
    const { plan, server } = await served({ pollMs: 200, onNotice: m => notices.push(m), testHooks: { watch: (() => { throw Object.assign(new Error('no watch'), { code: 'ENOSYS' }); }) as never } });
    expect(notices).toEqual([expect.stringContaining('The folder watcher could not start (ENOSYS)')]);
    const tab = await events(server);
    await tab.next();
    writeFileSync(plan, JSON.stringify(renamed(JSON.parse(read(plan)), 'Without a watcher')));
    expect((await tab.next(e => e.data.state.plan?.name === 'Without a watcher')).data.state.revision).toBe(sha(readFileSync(plan)));
    tab.close();
  });
  it('after a reconnect, the first event has the current state, so a missed change cannot leave the tab on an old plan', async () => {
    const { plan, server } = await served(), tab = await events(server);
    await tab.next(); tab.close();
    writeFileSync(plan, JSON.stringify(renamed(JSON.parse(read(plan)), 'Changed while away')));
    await new Promise(done => setTimeout(done, 300));
    const again = await events(server), first = await again.next();
    expect([first.type, first.data.state.plan.name, first.data.state.revision]).toEqual(['state', 'Changed while away', sha(readFileSync(plan))]);
    again.close();
  });
  it('an invalid or half-written file is sent as not valid, with its errors; a valid file after it is sent again', async () => {
    const { plan, server } = await served(), tab = await events(server), good = read(plan);
    await tab.next();
    writeFileSync(plan, good.slice(0, 200));
    const broken = await tab.next(e => e.type === 'change');
    expect([broken.data.state.valid, broken.data.state.errors[0].code, broken.data.state.plan]).toEqual([false, 'json-invalid', undefined]);
    expect((await state(server)).valid).toBe(false);
    writeFileSync(plan, good);
    expect((await tab.next(e => e.type === 'change')).data.state).toMatchObject({ valid: true, revision: sha(good) });
    tab.close();
  });
});

describe('載入檔案版本, replacements and backups', () => {
  it('load-file keeps the browser plan as a -browser backup and returns the file version, if the revision is the one shown', async () => {
    const { plan, server } = await served(), s = await state(server);
    const browserPlan = renamed(s.plan, 'Browser edit');
    const r = await api(server, '/api/load-file', { method: 'POST', body: { seenRevision: s.revision, plan: browserPlan } });
    expect([r.status, r.json.state.revision, r.json.backup.endsWith('-browser.json')]).toEqual([200, s.revision, true]);
    expect(read(join(`${plan}.backups`, r.json.backup))).toBe(`${JSON.stringify(browserPlan, null, 2)}\n`);
    const listed = (await api(server, '/api/backups')).json.backups;
    expect(listed.map((b: any) => b.label)).toEqual(['browser']);
    expect(run(server.plan.replace(/plan\.json$/, ''), 'backups', 'plan.json').json.backups[0].label).toBe('browser');
  });
  it('load-file with an old revision is 409 with the current state, and keeps nothing; an invalid file is FILE_INVALID; a failed backup is 507', async () => {
    const { plan, server } = await served(), s = await state(server), browserPlan = renamed(s.plan, 'Browser edit');
    writeFileSync(plan, JSON.stringify(renamed(s.plan, 'Newer file')));
    const stale = await api(server, '/api/load-file', { method: 'POST', body: { seenRevision: s.revision, plan: browserPlan } });
    expect([stale.status, stale.json.code, stale.json.state.plan.name, backupsOf(plan)]).toEqual([409, 'REVISION_CONFLICT', 'Newer file', []]);
    writeFileSync(plan, '{"schemaVersion": 2');
    const invalid = await api(server, '/api/load-file', { method: 'POST', body: { seenRevision: sha('{"schemaVersion": 2'), plan: browserPlan } });
    expect([invalid.status, invalid.json.code, backupsOf(plan)]).toEqual([409, 'FILE_INVALID', []]);
    writeFileSync(plan, JSON.stringify(s.plan)); writeFileSync(`${plan}.backups`, 'not a folder');
    const failed = await api(server, '/api/load-file', { method: 'POST', body: { seenRevision: sha(JSON.stringify(s.plan)), plan: browserPlan } });
    expect([failed.status, failed.json.code]).toEqual([507, 'BACKUP_FAILED']);
  });
  it('a replacement keeps the browser plan as a -replaced backup, which the browser can read back; other labels and names are refused', async () => {
    const { server } = await served(), s = await state(server);
    const kept = await api(server, '/api/browser-backups', { method: 'POST', body: { plan: renamed(s.plan, 'Before replace'), label: 'replaced' } });
    expect([kept.status, kept.json.backup.endsWith('-replaced.json')]).toEqual([200, true]);
    const back = await api(server, `/api/backups/${kept.json.backup}`);
    expect([back.status, back.json.state.plan.name, back.json.state.valid]).toEqual([200, 'Before replace', true]);
    expect((await api(server, '/api/browser-backups', { method: 'POST', body: { plan: s.plan, label: 'file' } })).status).toBe(400);
    for (const name of ['..%2Fplan.json', '../plan.json', `20260101T000000000Z-${'a'.repeat(64)}.json`]) expect((await api(server, `/api/backups/${name}`)).status).toBe(404);
  });
});

describe('security', () => {
  it('the API needs the token; the editor files do not', async () => {
    const { server } = await served();
    expect((await api(server, '/api/plan', { token: null })).status).toBe(401);
    expect((await api(server, '/api/plan', { token: 'x'.repeat(64) })).status).toBe(401);
    expect((await api(server, '/api/plan', { token: 'short' })).status).toBe(401);
    expect((await api(server, '/api/events', { token: null })).status).toBe(401);
    // Every API route checks the token before it reads a body or a file; nothing changes without it.
    const before = read(server.plan);
    for (const [path, method, body] of [['/api/plan', 'PUT', {}], ['/api/load-file', 'POST', {}], ['/api/browser-backups', 'POST', { label: 'replaced', plan: {} }],
      ['/api/backups', 'GET', undefined], ['/api/backups/x.json', 'GET', undefined]] as const) {
      expect((await api(server, path, { method, body, token: null })).status, `${method} ${path}`).toBe(401);
      expect((await api(server, path, { method, body, token: 'x'.repeat(64) })).status, `${method} ${path}`).toBe(401);
    }
    expect([read(server.plan), backupsOf(server.plan)]).toEqual([before, []]);
    // A backup name that is not valid percent-encoding is 404, not a server error.
    expect((await api(server, '/api/backups/%E0')).json).toMatchObject({ ok: false, code: 'BACKUP_NOT_FOUND' });
    expect((await api(server, '/api/backups/%E0')).status).toBe(404);
    const index = await raw(server.port, { path: '/' });
    expect([index.status, index.text.includes('<div id="root">'), index.headers['content-type']]).toEqual([200, true, 'text/html; charset=utf-8']);
    expect(server.token).toMatch(/^[0-9a-f]{64}$/);
  });
  it('Host must be 127.0.0.1 or localhost with the actual port; a supplied Origin must match; no Origin is accepted with the token', async () => {
    const { server } = await served(), p = server.port;
    for (const host of ['evil.example', `evil.example:${p}`, `127.0.0.1:${p + 1}`, '127.0.0.1', `localhost.evil.example:${p}`]) {
      expect((await api(server, '/api/plan', { headers: { host } })).status, host).toBe(403);
      expect((await raw(p, { path: '/', headers: { host } })).status, host).toBe(403);
    }
    expect((await api(server, '/api/plan', { headers: { host: `localhost:${p}` } })).status).toBe(200);
    for (const origin of ['http://evil.example', `https://127.0.0.1:${p}`, `http://127.0.0.1:${p + 1}`, 'null']) expect((await api(server, '/api/plan', { headers: { origin } })).status, origin).toBe(403);
    for (const origin of [`http://127.0.0.1:${p}`, `http://localhost:${p}`]) expect((await api(server, '/api/plan', { headers: { origin } })).status).toBe(200);
  });
  it('no CORS: a preflight is refused, and no response allows another origin', async () => {
    const { server } = await served();
    const preflight = await raw(server.port, { path: '/api/plan', method: 'OPTIONS', headers: { origin: `http://127.0.0.1:${server.port}`, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'x-open-plan-token' } });
    expect(preflight.status).toBe(401);
    for (const r of [preflight, await api(server, '/api/plan'), await raw(server.port, { path: '/' })]) expect(Object.keys(r.headers).filter(h => h.startsWith('access-control-'))).toEqual([]);
  });
  it('bodies are JSON and at most 20 MB; routes are fixed; no path outside the editor files is served', async () => {
    const { server } = await served(), s = await state(server);
    const big = await api(server, '/api/plan', { method: 'PUT', body: { expectedRevision: s.revision, sessionId: 'session-big-0001', requestId: 'request-big-001', plan: 'x'.repeat(21 * 1024 * 1024) } });
    expect([big.status, big.json?.code]).toEqual([413, 'BODY_TOO_LARGE']);
    // The same body in chunks, without Content-Length: the limit applies while it is read.
    const bigChunked = await raw(server.port, { path: '/api/plan', method: 'PUT', chunked: true, body: JSON.stringify({ plan: 'x'.repeat(21 * 1024 * 1024) }),
      headers: { 'x-open-plan-token': server.token, 'content-type': 'application/json' } });
    expect([bigChunked.status, bigChunked.json?.code]).toEqual([413, 'BODY_TOO_LARGE']);
    expect((await api(server, '/api/plan', { method: 'PUT', headers: { 'content-type': 'text/plain' } })).status).toBe(415);
    expect((await raw(server.port, { path: '/api/plan', method: 'PUT', body: '{', headers: { 'x-open-plan-token': server.token, 'content-type': 'application/json' } })).status).toBe(400);
    expect((await put(server, s.revision, s.plan, '../../etc')).status).toBe(400);
    expect((await api(server, '/api/files')).status).toBe(404);
    expect((await api(server, '/api/plan', { method: 'DELETE' })).status).toBe(405);
    for (const path of ['/../package.json', '/%2e%2e/package.json', '/assets/../../cli.js', '/editor/index.html', '/plan.json', `/${'..%2F'.repeat(6)}etc/passwd`]) {
      expect((await raw(server.port, { path })).status, path).toBe(404);
    }
    expect((await raw(server.port, { path: '/', method: 'POST' })).status).toBe(405);
  });
  it('--host adds exactly one more address (here the IPv6 loopback)', async () => {
    const dir = folder(); run(dir, 'new', 'plan.json');
    const plain = await startServer({ file: join(dir, 'plan.json'), port: 0, editorDir: EDITOR }); running.push(plain);
    expect((await api(plain, '/api/plan', { headers: { host: `[::1]:${plain.port}` } })).status).toBe(403);
    const lan = await startServer({ file: join(dir, 'plan.json'), port: 0, host: '::1', editorDir: EDITOR }); running.push(lan);
    const viaV6 = await new Promise<number>((done, fail) => request({ host: '::1', port: lan.port, path: '/api/plan', headers: { 'x-open-plan-token': lan.token } }, res => { res.resume(); done(res.statusCode!); }).on('error', fail).end());
    expect(viaV6).toBe(200);
  });
});

describe('stopping', () => {
  it('Ctrl+C lets a write in progress finish, then the process ends with exit 0 and no lock file', async () => {
    const dir = folder(), plan = join(dir, 'plan.json');
    run(dir, 'new', 'plan.json', '--sample');
    const probe = createServer(); await new Promise<void>(done => probe.listen(0, '127.0.0.1', done));
    const free = (probe.address() as { port: number }).port; await new Promise(done => probe.close(done));
    const child = spawn(process.execPath, [CLI, 'serve', 'plan.json', '--no-open', '--json', '--port', String(free)], { cwd: dir });
    const started = await new Promise<any>(done => child.stdout.once('data', d => done(JSON.parse(String(d)))));
    const server = { port: started.port, token: started.url.split('token=')[1] } as RunningServer;
    const s = await state(server), held = await acquireLock(plan);
    const writing = put(server, s.revision, renamed(s.plan, 'Written while stopping'));
    await new Promise(done => setTimeout(done, 200));
    const exited = new Promise<number | null>(done => child.on('exit', code => done(code)));
    child.kill('SIGINT');
    await new Promise(done => setTimeout(done, 200));
    await releaseLock(held);
    const r = await writing;
    expect([r.status, await exited, JSON.parse(read(plan)).name, existsSync(lockPath(plan))]).toEqual([200, 0, 'Written while stopping', false]);
  });
});
