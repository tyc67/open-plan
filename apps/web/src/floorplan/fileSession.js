// Live file mode (roadmap C3b): the editor works on one plan file through `serve`. This module holds the protocol and
// the synchronization state; the editor gives it the open plan and reacts to its callbacks. Website mode never loads it.

/** The token from the URL fragment (`#token=…`), or null in website mode. The fragment is never sent to a server. */
export function fileModeToken() {
  const match = /(?:^#|&)token=([0-9a-f]{64})(?:&|$)/.exec(location.hash);
  return match ? match[1] : null;
}

const randomId = prefix => `${prefix}-${crypto.getRandomValues(new Uint32Array(3)).join('')}`;

/** Reads the file state once, before the editor starts. Throws an Error with a zh-TW message if the server cannot be reached. */
export async function openFileSession(token) {
  let response;
  try { response = await fetch('/api/plan', { headers: { 'x-open-plan-token': token }, cache: 'no-store' }); }
  catch { throw new Error('無法連到本機檔案伺服器。請確認 serve 仍在執行，再重新開啟它顯示的連結。'); }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(body?.code === 'TOKEN_REQUIRED' ? '連結中的權杖不正確。請開啟 serve 這次啟動時顯示的連結。' : `本機檔案伺服器回應錯誤（${body?.code ?? response.status}）。`);
  const backups = await fetch('/api/backups', { headers: { 'x-open-plan-token': token } }).then(r => r.json()).catch(() => null);
  return { token, state: body.state, path: body.path, hasReplaced: !!backups?.backups?.some(b => b.label === 'replaced') };
}

/**
 * The synchronization of one browser page (one session) with the plan file.
 *
 * - `synced` is the plan last known to equal the file at `baseRevision`. Autosave writes only when the open plan differs
 *   from it, so loading a file version (which the validator may normalize) causes no write.
 * - One write at a time. A successful response marks the plan that was sent as synchronized, not the plan that is open
 *   then; edits made during the request stay unsaved and are written next.
 * - A change event from this page's own write carries its request id and is ignored (the response is the
 *   acknowledgement). Any other change loads at once if the page has no unsaved edit and no gesture; otherwise it is
 *   a conflict, which only the user resolves.
 * - An invalid file, a lost connection or a failed write blocks writes; the open plan stays.
 *
 * `editor` gives: latest() → the open plan; busy() → a gesture or a focused field; settle() → ends gestures and returns
 * the plan; load(plan) → shows a file version (no undo step, history reset). `onChange(view)` gets the state to show.
 */
export function createFileSync(session, editor, onChange) {
  const { token } = session, sessionId = randomId('session'), ownRequests = new Set();
  const valid = session.state.valid;
  let baseRevision = session.state.revision, synced = valid ? JSON.stringify(session.state.plan) : null;
  let writing = false, again = false, stopped = false;
  // A page that starts on an invalid file shows a fallback plan; an edit to it is an unsaved edit like any other.
  const fallback = valid ? null : JSON.stringify(editor.latest());
  // view.status: 'ok' | 'saving' | 'conflict' | 'invalid' | 'disconnected' | 'error'. Each change of view gets a new
  // version: a response may change the view only if nothing newer (an event, a lost connection) changed it meanwhile.
  let view = valid ? { status: 'ok' } : { status: 'invalid', state: session.state }, version = 0;
  const show = next => { version++; view = next; onChange(view); };
  const headers = json => ({ 'x-open-plan-token': token, ...(json ? { 'content-type': 'application/json' } : {}) });
  const dirty = () => JSON.stringify(editor.latest()) !== (synced ?? fallback);
  const blocked = () => ['conflict', 'invalid', 'disconnected', 'error'].includes(view.status);

  async function send(path, method, body) {
    const response = await fetch(path, { method, headers: headers(true), body: JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }
  function accept(plan, revision) { synced = JSON.stringify(plan); baseRevision = revision; }

  /** Writes the open plan if it differs from the synchronized one (autosave and the save button). */
  async function save() {
    if (stopped || blocked()) return;
    if (writing) { again = true; return; }
    if (!dirty()) return;
    const plan = editor.latest(), requestId = randomId('request');
    writing = true; again = false; ownRequests.add(requestId);
    show({ status: 'saving' });
    const mine = version;
    try {
      const r = await send('/api/plan', 'PUT', { expectedRevision: baseRevision, plan, sessionId, requestId, mode: 'autosave' });
      // The write counts (the plan sent is now the file), but a newer state (a conflict, an invalid file, a lost
      // connection) that arrived while it was in flight stays shown. A failure is older than that state, so it too
      // changes nothing.
      if (r.status === 200) accept(plan, r.body.revision);
      if (version === mine) {
        if (r.status === 200) show({ status: 'ok', saved: true });
        else if (r.status === 409 && r.body.code === 'REVISION_CONFLICT') external(r.body.state, null, true);
        else show({ status: 'error', code: r.body.code ?? String(r.status), message: r.body.message });
      }
    } catch { if (version === mine) show({ status: 'disconnected' }); }
    finally { writing = false; setTimeout(() => ownRequests.delete(requestId), 10_000); }
    if (again || (view.status === 'ok' && dirty())) save();
  }

  /** A file state from an event, a refused write or a retry. */
  function external(state, requestId, refused = false) {
    if (requestId && ownRequests.has(requestId)) return;
    if (!state.valid) { show({ status: 'invalid', state }); return; }
    if (state.revision === baseRevision && !refused) {
      if (['invalid', 'disconnected'].includes(view.status)) { show({ status: 'ok' }); save(); }
      return;
    }
    // A page with no unsaved edit, no write in flight and no gesture takes the file version at once.
    if (!refused && !writing && !dirty() && !editor.busy() && view.status !== 'conflict') { editor.load(state.plan); accept(state.plan, state.revision); show({ status: 'ok', loaded: true }); return; }
    show({ status: 'conflict', state });
  }

  /** 載入檔案版本: the server checks the revision shown, keeps the browser plan as a backup, and returns that file version. */
  async function loadFile() {
    if (view.status !== 'conflict') return;
    const shown = view.state, plan = editor.settle(), sent = JSON.stringify(plan), mine = version;
    try {
      const r = await send('/api/load-file', 'POST', { seenRevision: shown.revision, plan });
      if (version !== mine) return;                                   // a newer file state is shown; it decides
      if (r.status === 200) {
        // Edits made while the request was pending are not in the backup, so the file version must not replace them.
        if (JSON.stringify(editor.latest()) !== sent) { show({ status: 'conflict', state: r.body.state, failed: '等待時又有新的修改，所以沒有載入；送出時的版本已備份' }); return; }
        editor.load(r.body.state.plan); accept(r.body.state.plan, r.body.state.revision); show({ status: 'ok', loaded: true, backup: r.body.backup }); return;
      }
      if (r.status === 409 && r.body.code === 'REVISION_CONFLICT') { show({ status: 'conflict', state: r.body.state, refreshed: true }); return; }
      if (r.status === 409 && r.body.code === 'FILE_INVALID') { show({ status: 'invalid', state: r.body.state }); return; }
      show({ status: 'conflict', state: shown, failed: r.body.message ?? r.body.code });
    } catch { if (version === mine) show({ status: 'disconnected' }); }
  }

  /** 保留我的版本: writes the browser plan over the file version shown; the server backs that version up first. */
  async function keepMine() {
    if (view.status !== 'conflict') return;
    const shown = view.state, plan = editor.settle(), requestId = randomId('request'), mine = version;
    ownRequests.add(requestId);
    try {
      const r = await send('/api/plan', 'PUT', { expectedRevision: shown.revision, plan, sessionId, requestId, mode: 'keep-mine' });
      if (r.status === 200) { accept(plan, r.body.revision); if (version === mine) { show({ status: 'ok', saved: true, kept: true }); save(); } return; }
      if (version !== mine) return;
      if (r.status === 409 && r.body.code === 'REVISION_CONFLICT') { show({ status: 'conflict', state: r.body.state, refreshed: true }); return; }
      show({ status: 'conflict', state: shown, failed: r.body.message ?? r.body.code });
    } catch { if (version === mine) show({ status: 'disconnected' }); }
    finally { setTimeout(() => ownRequests.delete(requestId), 10_000); }
  }

  /** After a failed write: reads the current revision first, then saves or shows the change. */
  async function retry() {
    const mine = version;
    try {
      const r = await fetch('/api/plan', { headers: headers(false), cache: 'no-store' }).then(x => x.json());
      if (version !== mine) return;
      if (!r.ok) { show({ status: 'error', code: r.code, message: r.message }); return; }
      show({ status: 'ok' });
      if (r.state.revision === baseRevision) save(); else external(r.state, null);
    } catch { if (version === mine) show({ status: 'disconnected' }); }
  }

  // ---- Change events, with reconnection. The first event of each connection is the current state. ----
  let controller = null;
  async function listen() {
    let delay = 500;
    while (!stopped) {
      controller = new AbortController();
      try {
        const response = await fetch('/api/events', { headers: headers(false), signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        delay = 500;
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (data) { const event = JSON.parse(data); external(event.state, event.requestId); }
          }
        }
      } catch { /* below */ }
      if (stopped) return;
      if (!['conflict', 'invalid'].includes(view.status)) show({ status: 'disconnected' });
      await new Promise(done => setTimeout(done, delay));
      delay = Math.min(delay * 2, 5000);
    }
  }
  listen();

  return {
    save, loadFile, keepMine, retry,
    /** Unsaved edits: the open plan differs from the file, or a write is in flight. */
    unsaved: () => dirty() || writing,
    stop() { stopped = true; controller?.abort(); },
    get view() { return view; },
    /** Keeps a browser plan on the server before a replacement (`-replaced`). Throws an Error with a message if it fails. */
    async backupBeforeReplace(plan) {
      const r = await send('/api/browser-backups', 'POST', { plan, label: 'replaced' }).catch(() => ({ status: 0, body: { message: '無法連到本機檔案伺服器' } }));
      if (r.status !== 200) throw new Error(r.body.message ?? r.body.code ?? String(r.status));
    },
    /** The newest `-replaced` backup as { plan, warnings }, or null. */
    async replacedPlan() {
      const list = await fetch('/api/backups', { headers: headers(false) }).then(r => r.json()).catch(() => null);
      const newest = list?.backups?.filter(b => b.label === 'replaced').at(-1);
      if (!newest) return null;
      const r = await fetch(`/api/backups/${newest.name}`, { headers: headers(false) }).then(x => x.json()).catch(() => null);
      return r?.ok ? { plan: r.state.plan, warnings: r.state.warnings } : null;
    },
  };
}
