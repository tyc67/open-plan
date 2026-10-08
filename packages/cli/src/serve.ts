import { randomBytes, timingSafeEqual } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { canonicalPath, checkSingleLink, CliError, listBackups, readBytes } from './files.js';
import { backupBrowserPlan, loadFileVersion, readBackup, stateOf, writeBrowserPlan, type FileState } from './file-mode.js';
import type { LockOptions } from './lock.js';

/**
 * `serve` (roadmap C3a): the editor and one plan file on a local HTTP port. The browser reads and writes the plan only
 * through the fixed /api routes, with the token; every write uses the C2 lock, revision check and backups.
 */

export const DEFAULT_PORT = 5190;
const PORT_TRIES = 20;                              // only the default port falls back to the next free one
const MAX_BODY = 20 * 1024 * 1024;                  // the same limit as import in the browser
const ID = /^[A-Za-z0-9_-]{8,64}$/, HEX64 = /^[0-9a-f]{64}$/;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};
const STATUS: Record<string, number> = {
  BAD_REQUEST: 400, TOKEN_REQUIRED: 401, PLAN_PATH_CHANGED: 409, HOST_REFUSED: 403, ORIGIN_REFUSED: 403, NOT_FOUND: 404, BACKUP_NOT_FOUND: 404, METHOD_NOT_ALLOWED: 405,
  REVISION_CONFLICT: 409, FILE_INVALID: 409, BODY_TOO_LARGE: 413, UNSUPPORTED_MEDIA_TYPE: 415, VALIDATION_FAILED: 422, BACKUP_INVALID: 422,
  LOCK_TIMEOUT: 423, LOCK_STALE: 423, LOCK_UNCERTAIN: 423, STOPPING: 503, BACKUP_FAILED: 507,
};

export interface ServeOptions {
  file: string;
  /** An explicit port fails if it is in use; without it, DEFAULT_PORT and the next free ports are tried. 0: any free port (tests). */
  port?: number;
  /** One more address to listen on and to accept in the Host header (LAN access). */
  host?: string;
  /** The built editor (apps/web/dist). */
  editorDir: string;
  /** The interval of the fallback file check, in ms. */
  pollMs?: number;
  lock?: LockOptions;
  /** For tests only: runs after the first state of a new event stream is read, to force an ordering. */
  testHooks?: { afterInitialRead?: () => Promise<void> };
}
export interface RunningServer { url: string; port: number; token: string; plan: string; close(): Promise<void> }

/** Refuses a plan that file mode cannot open: missing, v1, or with errors that block rendering (roadmap C3, start-up). */
async function checkStart(file: string): Promise<string> {
  const plan = await canonicalPath(file, true);
  await checkSingleLink(plan);
  const state = stateOf(await readBytes(plan));
  if (state.valid) return plan;
  let version: unknown = null;
  try { version = JSON.parse((await readBytes(plan)).toString('utf8'))?.schemaVersion; } catch { /* not JSON */ }
  if (version === 1) throw new CliError('NOT_VERSION_2', `${file} is schema version 1. Run \`migrate\` first; serve does not convert it.`, { file });
  throw new CliError('VALIDATION_FAILED', `${file} has ${state.errors.length} error(s) that block rendering. Run \`validate\` and correct them first.`, { file, errors: state.errors });
}

/** The editor's files as fixed URL paths. Nothing outside this list is served. */
async function editorFiles(dir: string): Promise<Map<string, string>> {
  let names: string[];
  try { names = (await readdir(dir, { recursive: true, withFileTypes: true })).filter(e => e.isFile()).map(e => join(e.parentPath, e.name)); }
  catch { throw new CliError('EDITOR_MISSING', `The editor files are missing (${dir}). Build the CLI again.`, { dir }); }
  if (!names.some(n => basename(n) === 'index.html')) throw new CliError('EDITOR_MISSING', `The editor files are missing (${dir}). Build the CLI again.`, { dir });
  return new Map(names.map(path => [`/${relative(dir, path).split(sep).join('/')}`, path]));
}

function listen(server: Server, port: number, address: string): Promise<number> {
  return new Promise((done, fail) => {
    const failed = (error: Error) => { server.off('listening', ok); fail(error); };
    const ok = () => { server.off('error', failed); done((server.address() as { port: number }).port); };
    server.once('error', failed); server.once('listening', ok);
    server.listen(port, address);
  });
}

export async function startServer(options: ServeOptions): Promise<RunningServer> {
  const { file, host, pollMs = 1000, lock } = options;
  if (host !== undefined && ['', '0.0.0.0', '::', '[::]', '*'].includes(host)) throw new CliError('USAGE', '--host needs the one address to accept, for example the computer\'s LAN address, not a wildcard.');
  const plan = await checkStart(file);
  const files = await editorFiles(options.editorDir);
  const token = randomBytes(32).toString('hex'), tokenBytes = Buffer.from(token);
  // The path the editor shows in its mode indicator, with the home folder as ~.
  const home = homedir(), shownPath = plan.startsWith(`${home}${sep}`) ? `~${plan.slice(home.length)}` : plan;

  // ---- State shared by all requests ----
  const clients = new Set<ServerResponse>(), sessionsBackedUp = new Set<string>(), inFlight = new Set<Promise<unknown>>();
  // Revisions that a browser write is about to give the file, with the request id. The folder watcher can see the
  // rename before the write's response, so the check, not the write handler, sends the event with the id.
  const ownWrites = new Map<string, string>();
  let stopping = false, lastRevision = stateOf(await readBytes(plan)).revision, checking: Promise<void> = Promise.resolve();
  const sendEvent = (res: ServerResponse, type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const broadcast = (state: FileState, requestId: string | null) => { for (const res of clients) sendEvent(res, 'change', { requestId, state }); };
  const currentState = async (): Promise<FileState> => {
    try { return stateOf(await readBytes(plan)); } catch (error) {
      if ((error as CliError).code === 'FILE_NOT_FOUND') return { revision: '', valid: false, warnings: [], errors: [{ path: '$', code: 'file-missing', params: {} }] };
      throw error;
    }
  };
  // Checks and new streams run one at a time, in order; a failed step does not stop the later ones.
  const serial = (step: () => Promise<void>) => { const run = checking.then(step); checking = run.catch(() => {}); return run; };
  // Every check reads the file and compares its revision with the last one sent. A revision from a browser write is
  // sent with that write's request id, so only that browser treats it as its acknowledgement.
  const check = () => serial(async () => {
    const state = await currentState().catch(() => null);
    if (state && state.revision !== lastRevision) { lastRevision = state.revision; broadcast(state, ownWrites.get(state.revision) ?? null); }
  });
  let watcher: FSWatcher | null = null;
  try { watcher = watch(dirname(plan), (_event, name) => { if (!name || name === basename(plan)) check(); }); } catch { /* the 1 s check still runs */ }
  const poll = setInterval(check, pollMs);

  // ---- Requests ----
  let port = 0;
  const allowedHosts = () => {
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (host) hosts.push(host.includes(':') && !host.startsWith('[') ? `[${host}]:${port}` : `${host}:${port}`);
    return hosts;
  };
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const refuse = (res: ServerResponse, code: string, message: string) => json(res, STATUS[code] ?? 400, { ok: false, code, message });
  const reply = (res: ServerResponse, result: { ok: boolean; code?: string }) => json(res, result.ok ? 200 : STATUS[result.code!] ?? 400, result);

  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) throw new CliError('UNSUPPORTED_MEDIA_TYPE', 'The body must be JSON (Content-Type: application/json).');
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) throw new CliError('BODY_TOO_LARGE', `The body is larger than ${MAX_BODY / 1024 / 1024} MB.`);
    // Plain 'data' events, not for await: leaving a for-await loop destroys the request, and the client would get a
    // reset instead of the 413. The rest of a body that is too large is read and dropped.
    const text = await new Promise<string>((done, fail) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= MAX_BODY) chunks.push(chunk); });
      req.on('end', () => size > MAX_BODY ? fail(new CliError('BODY_TOO_LARGE', `The body is larger than ${MAX_BODY / 1024 / 1024} MB.`)) : done(Buffer.concat(chunks).toString('utf8')));
      req.on('error', fail);
    });
    try {
      const value = JSON.parse(text);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* below */ }
    throw new CliError('BAD_REQUEST', 'The body must be a JSON object.');
  }
  const field = (value: unknown, pattern: RegExp, name: string) => {
    if (typeof value !== 'string' || !pattern.test(value)) throw new CliError('BAD_REQUEST', `${name} is missing or not valid.`);
    return value;
  };
  // A write request keeps the server open until its response is sent, so a stop does not cut it.
  const tracked = <T>(work: Promise<T>) => { inFlight.add(work); work.finally(() => inFlight.delete(work)).catch(() => {}); return work; };

  async function api(req: IncomingMessage, res: ServerResponse, path: string) {
    const sent = req.headers['x-open-plan-token'];
    if (typeof sent !== 'string' || sent.length !== token.length || !timingSafeEqual(Buffer.from(sent), tokenBytes)) return refuse(res, 'TOKEN_REQUIRED', 'A valid token is required.');
    const method = req.method ?? 'GET';
    const isWrite = method === 'PUT' || method === 'POST';
    if (isWrite && stopping) return refuse(res, 'STOPPING', 'The server is stopping.');
    // Every operation uses the plan path fixed at start. If the name given at start now resolves to another file (a
    // symlink pointed elsewhere), every request is refused, so nothing reads one plan and writes another.
    if ((await canonicalPath(file, false).catch(() => null)) !== plan) return refuse(res, 'PLAN_PATH_CHANGED', `${file} now resolves to another file. Stop serve and start it again.`);
    if (path === '/api/plan' && method === 'GET') return json(res, 200, { ok: true, state: await currentState(), path: shownPath });
    if (path === '/api/plan' && method === 'PUT') {
      const b = await body(req), sessionId = field(b.sessionId, ID, 'sessionId'), requestId = field(b.requestId, ID, 'requestId');
      // keep-mine (保留我的版本) writes over a file version that the browser has not loaded, so it always backs it up.
      const mode = b.mode ?? 'autosave';
      if (mode !== 'autosave' && mode !== 'keep-mine') throw new CliError('BAD_REQUEST', 'mode must be "autosave" or "keep-mine".');
      const backupFirst = mode === 'keep-mine' || !sessionsBackedUp.has(sessionId);
      let written: string | null = null;
      try {
        const result = await writeBrowserPlan(plan, { expectedRevision: field(b.expectedRevision, HEX64, 'expectedRevision'), plan: b.plan, backupFirst,
          beforeWrite: revision => { written = revision; ownWrites.set(revision, requestId); } }, lock);
        if (result.ok && result.changed && backupFirst) sessionsBackedUp.add(sessionId);
        // The change event goes out before the response, so a tab never sees its acknowledgement before the event.
        if (result.ok && result.changed) await check();
        return reply(res, result);
      } finally { if (written) ownWrites.delete(written); }
    }
    if (path === '/api/load-file' && method === 'POST') {
      const b = await body(req);
      return reply(res, await loadFileVersion(plan, { seenRevision: field(b.seenRevision, HEX64, 'seenRevision'), plan: b.plan }, lock));
    }
    if (path === '/api/browser-backups' && method === 'POST') {
      const b = await body(req);
      if (b.label !== 'replaced') throw new CliError('BAD_REQUEST', 'label must be "replaced".');
      return reply(res, await backupBrowserPlan(plan, b.plan, 'replaced', lock));
    }
    if (path === '/api/backups' && method === 'GET') return json(res, 200, { ok: true, backups: await listBackups(plan) });
    if (path.startsWith('/api/backups/') && method === 'GET') return reply(res, await readBackup(plan, decodeURIComponent(path.slice('/api/backups/'.length))));
    if (path === '/api/events' && method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
      // The first event is the current state, so a browser that reconnects cannot stay on an old plan.
      // In the same serialized step as the checks: no change can be sent between this read and the registration.
      await serial(async () => {
        const initial = await currentState();
        await options.testHooks?.afterInitialRead?.();
        sendEvent(res, 'state', { requestId: null, state: initial });
        clients.add(res);
      });
      const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    const known = ['/api/plan', '/api/load-file', '/api/browser-backups', '/api/backups', '/api/events'].includes(path) || path.startsWith('/api/backups/');
    return known ? refuse(res, 'METHOD_NOT_ALLOWED', `${method} is not allowed here.`) : refuse(res, 'NOT_FOUND', 'There is no such route.');
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'DENY');
    // DNS rebinding: a page on another name that resolves to this computer still sends its own name in Host.
    if (!allowedHosts().includes(req.headers.host ?? '')) return refuse(res, 'HOST_REFUSED', 'The Host header is not allowed.');
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedHosts().some(h => origin === `http://${h}`)) return refuse(res, 'ORIGIN_REFUSED', 'The Origin header is not allowed.');
    const path = (req.url ?? '/').split('?')[0];
    try {
      if (path.startsWith('/api/')) return await (req.method === 'PUT' || req.method === 'POST' ? tracked(api(req, res, path)) : api(req, res, path));
      if (req.method !== 'GET' && req.method !== 'HEAD') return refuse(res, 'METHOD_NOT_ALLOWED', 'Only GET is allowed for the editor files.');
      const source = files.get(path === '/' ? '/index.html' : path);
      if (!source) return refuse(res, 'NOT_FOUND', 'There is no such file.');
      const data = await readFile(source);
      res.writeHead(200, { 'content-type': TYPES[extname(source)] ?? 'application/octet-stream', 'cache-control': path.startsWith('/assets/') ? 'max-age=31536000, immutable' : 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      // A body that is too large by its Content-Length is not read; it is dropped, so the client can read the response.
      // Only a client with the token gets this far: the token is checked before any body is read.
      if (error instanceof CliError && error.code === 'BODY_TOO_LARGE') req.resume();
      if (error instanceof CliError) return json(res, STATUS[error.code] ?? 500, { ok: false, code: error.code, message: error.message, ...error.details });
      json(res, 500, { ok: false, code: 'IO_ERROR', message: String((error as Error)?.message ?? error) });
    }
  }

  // ---- Listening ----
  const servers = [createServer(handle)];
  const explicit = options.port !== undefined;
  for (let i = 0; ; i++) {
    const wanted = explicit ? options.port! : DEFAULT_PORT + i;
    try { port = await listen(servers[0], wanted, '127.0.0.1'); break; } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE' && !explicit && i < PORT_TRIES - 1) continue;
      clearInterval(poll); watcher?.close();
      if (code === 'EADDRINUSE') throw new CliError('PORT_IN_USE', explicit ? `Port ${wanted} is in use. Choose another --port.` : `Ports ${DEFAULT_PORT}–${DEFAULT_PORT + PORT_TRIES - 1} are in use. Choose a --port.`, { port: wanted });
      throw new CliError('IO_ERROR', `Cannot listen on port ${wanted} (${code}).`);
    }
  }
  if (host) {
    servers.push(createServer(handle));
    try { await listen(servers[1], port, host.replace(/^\[|\]$/g, '')); } catch (error) {
      servers[0].close(); clearInterval(poll); watcher?.close();
      throw new CliError('IO_ERROR', `Cannot listen on ${host}:${port} (${(error as NodeJS.ErrnoException).code}).`);
    }
  }

  return {
    url: `http://127.0.0.1:${port}/#token=${token}`, port, token, plan,
    async close() {
      stopping = true;
      clearInterval(poll); watcher?.close();
      await Promise.allSettled([...inFlight]);
      for (const res of clients) res.end();
      clients.clear();
      await Promise.all(servers.map(s => new Promise(done => { s.close(done); s.closeAllConnections(); })));
    },
  };
}
