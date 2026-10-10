import { afterEach, describe, expect, it } from 'vitest';
import { createFileSync } from '../src/floorplan/fileSession.js';

// Race cases of live file mode (roadmap C3b): the test decides when each server response arrives, and in which order.
const encoder = new TextEncoder();
const tick = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise(done => setTimeout(done, 0)); };
const state = (revision, name, valid = true) => valid ? { revision, valid, plan: { name }, warnings: [], errors: [] } : { revision, valid, warnings: [], errors: [{ path: '$', code: 'json-invalid', params: {} }] };

/** A fake serve: requests wait until the test answers them (status 'network' fails the request); `emit` sends a change
 * event; `drop` ends the event stream. */
function fakeServer() {
  const calls = [], streams = [];
  globalThis.fetch = (url, init = {}) => {
    if (url === '/api/events') {
      let controller;
      const body = new ReadableStream({ start(c) { controller = c; } });
      streams.push(controller);
      return Promise.resolve(new Response(body, { status: 200 }));
    }
    return new Promise((resolve, reject) => calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null,
      respond: (status, json) => status === 'network' ? reject(new TypeError('Failed to fetch')) : resolve(new Response(JSON.stringify(json), { status })) }));
  };
  return {
    calls,
    emit(s, requestId = null) { streams.at(-1).enqueue(encoder.encode(`event: change\ndata: ${JSON.stringify({ requestId, state: s })}\n\n`)); },
    drop() { streams.at(-1).close(); },
    pending: path => calls.filter(c => c.url === path && !c.done),
    async answer(path, status, json) { const call = calls.find(c => c.url === path && !c.done); call.done = true; call.respond(status, json); await tick(); return call; },
  };
}
/** The editor as the file session sees it. */
function fakeEditor(doc) {
  const editor = { doc, isBusy: false, loads: 0, latest: () => editor.doc, busy: () => editor.isBusy, settle: () => editor.doc, load: plan => { editor.doc = plan; editor.loads++; } };
  return editor;
}
let sync = null;
afterEach(() => { sync?.stop(); sync = null; });
function start(initial, doc) {
  const server = fakeServer(), editor = fakeEditor(doc), views = [];
  sync = createFileSync({ token: 't'.repeat(64), state: initial }, editor, v => views.push(v));
  return { server, editor, views, view: () => sync.view };
}

describe('file session races', () => {
  it('checkpoint: the next write has mode checkpoint; one in flight keeps its mode; after it, writes are autosaves again', async () => {
    const { server, editor } = start(state('r0', 'Start'), { name: 'Start' });
    await tick();
    editor.doc = { name: 'Edit 1' }; sync.save(); await tick();
    // A scaling during the write in flight: that write stays an autosave, and the next one is the checkpoint.
    editor.doc = { name: 'Scaled' }; sync.checkpoint(); sync.save(); await tick();
    const first = await server.answer('/api/plan', 200, { revision: 'r1' });
    const second = await server.answer('/api/plan', 200, { revision: 'r2' });
    editor.doc = { name: 'Edit 2' }; sync.save(); await tick();
    const third = await server.answer('/api/plan', 200, { revision: 'r3' });
    expect([first, second, third].map(c => [c.body.mode, c.body.plan.name, c.body.expectedRevision])).toEqual([['autosave', 'Edit 1', 'r0'], ['checkpoint', 'Scaled', 'r1'], ['autosave', 'Edit 2', 'r2']]);
  });
  it('checkpoint: a second checkpoint during a checkpoint write in flight gets its own checkpoint write', async () => {
    const { server, editor } = start(state('r0', 'Start'), { name: 'Start' });
    await tick();
    editor.doc = { name: 'Scale 1' }; sync.checkpoint(); sync.save(); await tick();
    editor.doc = { name: 'Scale 2' }; sync.checkpoint(); sync.save(); await tick();
    const first = await server.answer('/api/plan', 200, { revision: 'r1' });
    const second = await server.answer('/api/plan', 200, { revision: 'r2' });
    editor.doc = { name: 'Edit' }; sync.save(); await tick();
    const third = await server.answer('/api/plan', 200, { revision: 'r3' });
    expect([first, second, third].map(c => [c.body.mode, c.body.plan.name])).toEqual([['checkpoint', 'Scale 1'], ['checkpoint', 'Scale 2'], ['autosave', 'Edit']]);
  });
  it('checkpoint: 載入檔案版本 drops the request, so the next edit is an autosave', async () => {
    const { server, editor, view } = start(state('r0', 'Start'), { name: 'Start' });
    await tick();
    editor.doc = { name: 'Scaled' }; sync.checkpoint(); sync.save(); await tick();
    await server.answer('/api/plan', 409, { code: 'REVISION_CONFLICT', state: state('r9', 'External') });
    sync.loadFile(); await tick();
    await server.answer('/api/load-file', 200, { state: state('r9', 'External'), backup: 'b.json' });
    expect([view().status, editor.doc.name]).toEqual(['ok', 'External']);
    editor.doc = { name: 'Edit after' }; sync.save(); await tick();
    expect(server.pending('/api/plan')[0].body.mode).toBe('autosave');
  });
  it('checkpoint: a refused checkpoint write (409) is a conflict; 保留我的版本 (a write with a backup) serves the request; an undo before the write drops it', async () => {
    const { server, editor, view } = start(state('r0', 'Start'), { name: 'Start' });
    await tick();
    editor.doc = { name: 'Scaled' }; sync.checkpoint(); sync.save(); await tick();
    await server.answer('/api/plan', 409, { code: 'REVISION_CONFLICT', state: state('r9', 'External') });
    expect([view().status, editor.doc.name]).toEqual(['conflict', 'Scaled']);
    sync.keepMine(); await tick();
    const kept = await server.answer('/api/plan', 200, { revision: 'r10', backup: 'b.json' });
    editor.doc = { name: 'Edit after' }; sync.save(); await tick();
    const next = await server.answer('/api/plan', 200, { revision: 'r11' });
    expect([kept.body.mode, next.body.mode]).toEqual(['keep-mine', 'autosave']);
    // The plan is back to the file's content before any write: nothing is written, and the request is dropped.
    const other = start(state('r0', 'Start'), { name: 'Start' });
    await tick();
    sync.checkpoint(); sync.save(); await tick();
    expect(other.server.pending('/api/plan')).toEqual([]);
    other.editor.doc = { name: 'Later edit' }; sync.save(); await tick();
    expect(other.server.pending('/api/plan')[0].body.mode).toBe('autosave');
  });
  it('a page that started on an invalid file and was edited does not lose the edit when the file is repaired: it is a conflict', async () => {
    const { server, editor, view } = start(state('bad', null, false), { name: 'empty fallback' });
    await tick();
    editor.doc = { name: 'edited while the file was invalid' };
    server.emit(state('good', 'Repaired'));
    await tick();
    expect([view().status, editor.doc.name, editor.loads]).toEqual(['conflict', 'edited while the file was invalid', 0]);
  });
  it('a page that started on an invalid file and was not edited loads the repaired file', async () => {
    const { server, editor, view } = start(state('bad', null, false), { name: 'empty fallback' });
    await tick();
    server.emit(state('good', 'Repaired'));
    await tick();
    expect([view().status, editor.doc.name]).toEqual(['ok', 'Repaired']);
  });
  it('載入檔案版本 does not replace edits made while its request was pending', async () => {
    const { server, editor, view } = start(state('r1', 'Mine'), { name: 'Mine' });
    await tick();
    editor.doc = { name: 'Mine, edited' }; editor.isBusy = true;
    server.emit(state('r2', 'Theirs'));
    await tick();
    expect(view().status).toBe('conflict');
    editor.isBusy = false;
    sync.loadFile();
    await tick();
    editor.doc = { name: 'Mine, edited again during the request' };
    await server.answer('/api/load-file', 200, { ok: true, state: state('r2', 'Theirs'), backup: 'x-browser.json' });
    expect([editor.doc.name, editor.loads, view().status]).toEqual(['Mine, edited again during the request', 0, 'conflict']);
  });
  it('a late successful save does not clear an invalid file or a lost connection that came after it', async () => {
    for (const later of ['invalid', 'disconnected']) {
      const { server, editor, view } = start(state('r1', 'A'), { name: 'A' });
      await tick();
      editor.doc = { name: 'B' };
      sync.save();
      await tick();
      expect(view().status).toBe('saving');
      if (later === 'invalid') server.emit(state('broken', null, false)); else server.drop();
      await tick();
      expect(view().status).toBe(later);
      await server.answer('/api/plan', 200, { ok: true, revision: 'r2', changed: true });
      expect(view().status, later).toBe(later);
      sync.stop();
    }
  });
  it('a late 保留我的版本 response does not clear an invalid file that came after it', async () => {
    const { server, editor, view } = start(state('r1', 'Mine'), { name: 'Mine' });
    await tick();
    editor.doc = { name: 'Mine, edited' }; editor.isBusy = true;
    server.emit(state('r2', 'Theirs'));
    await tick(); editor.isBusy = false;
    sync.keepMine();
    await tick();
    server.emit(state('broken', null, false));
    await tick();
    await server.answer('/api/plan', 200, { ok: true, revision: 'r3', changed: true });
    expect(view().status).toBe('invalid');
  });
  it('a late 載入檔案版本 response does not load over a newer file state that came after it', async () => {
    const { server, editor, view } = start(state('r1', 'Mine'), { name: 'Mine' });
    await tick();
    editor.doc = { name: 'Mine, edited' }; editor.isBusy = true;
    server.emit(state('r2', 'Theirs'));
    await tick(); editor.isBusy = false;
    sync.loadFile();
    await tick();
    server.emit(state('broken', null, false));
    await tick();
    await server.answer('/api/load-file', 200, { ok: true, state: state('r2', 'Theirs'), backup: 'x-browser.json' });
    expect([view().status, editor.doc.name, editor.loads]).toEqual(['invalid', 'Mine, edited', 0]);
  });
  it('a late successful save keeps a conflict that came after it, and still counts as written', async () => {
    const { server, editor, view } = start(state('r1', 'A'), { name: 'A' });
    await tick();
    editor.doc = { name: 'B' };
    sync.save();
    await tick();
    server.emit(state('r9', 'Theirs'));
    await tick();
    expect(view().status).toBe('conflict');
    await server.answer('/api/plan', 200, { ok: true, revision: 'r2', changed: true });
    expect([view().status, sync.unsaved(), server.pending('/api/plan').length]).toEqual(['conflict', false, 0]);
  });
  it('a save response with no newer state shows the saved state', async () => {
    const { server, editor, view } = start(state('r1', 'A'), { name: 'A' });
    await tick();
    editor.doc = { name: 'B' };
    sync.save();
    await tick();
    await server.answer('/api/plan', 200, { ok: true, revision: 'r2', changed: true });
    expect([view().status, view().saved, sync.unsaved()]).toEqual(['ok', true, false]);
  });
});

// Each late failure, answered after a newer file state is shown: that state must stay.
const failures = {
  '409': ['409', { ok: false, code: 'REVISION_CONFLICT', state: state('r2', 'Older') }],
  'server error': ['500', { ok: false, code: 'WRITE_FAILED', message: 'disk' }],
  'network failure': ['network', null],
};
const respond = (server, path, [status, json]) => server.answer(path, status === 'network' ? 'network' : Number(status), json);

describe('late failures do not replace a newer file state', () => {
  for (const [name, failure] of Object.entries(failures)) {
    for (const newer of ['invalid', 'conflict']) {
      it(`save: a delayed ${name} after a newer ${newer} state`, async () => {
        const { server, editor, view } = start(state('r1', 'A'), { name: 'A' });
        await tick();
        editor.doc = { name: 'B' };
        sync.save();
        await tick();
        server.emit(newer === 'invalid' ? state('r3', null, false) : state('r3', 'Theirs'));
        await tick();
        await respond(server, '/api/plan', failure);
        expect([view().status, view().state?.revision]).toEqual([newer, 'r3']);
      });
    }
    it(`保留我的版本: a delayed ${name} after a newer invalid state`, async () => {
      const { server, editor, view } = start(state('r1', 'Mine'), { name: 'Mine' });
      await tick();
      editor.doc = { name: 'Mine, edited' }; editor.isBusy = true;
      server.emit(state('r2', 'Theirs'));
      await tick(); editor.isBusy = false;
      sync.keepMine();
      await tick();
      server.emit(state('r3', null, false));
      await tick();
      await respond(server, '/api/plan', failure);
      expect([view().status, view().state?.revision]).toEqual(['invalid', 'r3']);
    });
    it(`載入檔案版本: a delayed ${name} after a newer invalid state`, async () => {
      const { server, editor, view } = start(state('r1', 'Mine'), { name: 'Mine' });
      await tick();
      editor.doc = { name: 'Mine, edited' }; editor.isBusy = true;
      server.emit(state('r2', 'Theirs'));
      await tick(); editor.isBusy = false;
      sync.loadFile();
      await tick();
      server.emit(state('r3', null, false));
      await tick();
      await respond(server, '/api/load-file', failure);
      expect([view().status, view().state?.revision, editor.doc.name]).toEqual(['invalid', 'r3', 'Mine, edited']);
    });
  }
  it('重試: a delayed answer after a newer invalid state', async () => {
    for (const late of [[200, { ok: true, state: state('r1', 'A') }], ['network', null]]) {
      const { server, editor, view } = start(state('r1', 'A'), { name: 'A' });
      await tick();
      editor.doc = { name: 'B' };
      sync.save();
      await tick();
      await server.answer('/api/plan', 500, { ok: false, code: 'WRITE_FAILED' });
      expect(view().status).toBe('error');
      sync.retry();
      await tick();
      server.emit(state('r3', null, false));
      await tick();
      await server.answer('/api/plan', ...late);
      expect([view().status, view().state?.revision], String(late[0])).toEqual(['invalid', 'r3']);
      sync.stop();
    }
  });
});
