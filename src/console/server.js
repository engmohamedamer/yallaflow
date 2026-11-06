// `yallaflow console` server (v1.2.0): local; its only write is Create Work.
//
// - Listens on 127.0.0.1 only. Every API request needs the per-run token
//   (Authorization: Bearer). Static UI files carry no project data and need none.
// - Host must be this loopback origin (421), a present Origin must match (403). GET/HEAD
//   are served everywhere; POST only on the two Create Work routes, and there the Origin
//   is required and the Content-Type exact. --read-only answers every POST with 405.
//   Every data path is addressed by validated ID; nothing is resolved from a request path
//   into the filesystem except the fixed UI file map.
// - Reads come from `snapshot --json` / `work show --json` (runner.js) and preserved
//   source originals read by ID. Create Work runs the CLI's own start/route/intake add
//   (create.js), never writing .yallaflow itself.
import http from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRunner } from './runner.js';
import { watchWorkspace } from './watch.js';
import { changedFiles, listWorktrees } from './worktrees.js';
import { exists } from '../utils/fs.js';
import { loadSource, loadSourceText, sourceOriginalPath } from '../core/sources.js';
import { isSourceId, isWorkId } from '../core/ids.js';
import { HttpError, MAX_JSON_BYTES, attachFile, createWork, validateCreateBody } from './create.js';

const UI_DIR = fileURLToPath(new URL('../../resources/console/', import.meta.url));
const UI_FILES = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  '/fonts/ReadexPro.ttf': ['fonts/ReadexPro.ttf', 'font/ttf'],
  '/fonts/OFL.txt': ['fonts/OFL.txt', 'text/plain; charset=utf-8']
});

// The only routes that accept POST: create a work item, and attach a file to it.
const WRITE_ROUTE = /^\/api\/p\/[0-9a-f]{10}\/work(?:\/[^/]+\/sources)?$/;

const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "frame-src blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const BASE_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store'
});

// Preserved originals the UI may preview. Anything else is offered as extracted text.
const PREVIEW_TYPES = Object.freeze({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  pdf: 'application/pdf',
  md: 'text/plain; charset=utf-8', txt: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8', json: 'text/plain; charset=utf-8', yaml: 'text/plain; charset=utf-8', yml: 'text/plain; charset=utf-8'
});

// The project's own name (config.yaml project.name), else the folder name.
async function projectName(root) {
  try {
    return JSON.parse(await readFile(path.join(root, '.yallaflow', 'config.yaml'), 'utf8')).project?.name ?? null;
  } catch {
    return null;
  }
}

export function projectId(root) {
  return createHash('sha256').update(root).digest('hex').slice(0, 10);
}

export async function startConsoleServer({ roots, port = 0, host = '127.0.0.1', token = randomBytes(24).toString('hex'), poll = false, missing = [], readOnly = false } = {}) {
  const runner = createRunner();
  const projects = await Promise.all(roots.map(async (root) => ({ id: projectId(root), root, name: (await projectName(root)) ?? path.basename(root) })));
  const byId = new Map(projects.map((entry) => [entry.id, entry]));
  const clients = new Set();
  const tokenBuffer = Buffer.from(token);

  const watchers = projects.map((project) => watchWorkspace(project.root, () => {
    runner.invalidate(project.root);
    const message = `data: ${JSON.stringify({ type: 'change', project: project.id, at: new Date().toISOString() })}\n\n`;
    for (const client of clients) client.write(message);
  }, { poll }));
  const heartbeat = setInterval(() => { for (const client of clients) client.write(': ping\n\n'); }, 25_000);
  heartbeat.unref();

  const server = http.createServer(async (request, response) => {
    try {
      await handle(request, response);
    } catch (error) {
      send(response, error.status ?? (error.code === 'WORK_NOT_FOUND' ? 404 : 500), { error: { code: error.code ?? 'ERROR', message: error.message, ...(error.command ? { command: error.command } : {}) }, ...(error.extra ?? {}) });
    }
  });

  async function handle(request, response) {
    const address = server.address();
    const allowedHosts = [`127.0.0.1:${address.port}`, `localhost:${address.port}`];
    if (!allowedHosts.includes(request.headers.host)) return send(response, 421, { error: { code: 'MISDIRECTED', message: 'Unknown host.' } });
    const origin = request.headers.origin;
    if (origin && !allowedHosts.map((entry) => `http://${entry}`).includes(origin)) return send(response, 403, { error: { code: 'FORBIDDEN_ORIGIN', message: 'Foreign origin.' } });
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'POST') {
      // Writes: only the Create Work routes, only with the token, our own Origin and the exact type.
      if (readOnly || !WRITE_ROUTE.test(url.pathname)) return send(response, 405, { error: { code: 'READ_ONLY', message: readOnly ? 'This console was started with --read-only.' : 'Only Create Work accepts POST.' } }, { Allow: 'GET, HEAD' });
      if (!authorized(request)) return send(response, 401, { error: { code: 'UNAUTHORIZED', message: 'Missing or wrong console token. Open the link printed by `yallaflow console`.' } });
      if (!origin) return send(response, 403, { error: { code: 'FORBIDDEN_ORIGIN', message: 'A write needs the console page as its Origin.' } });
      return handleWrite(request, response, url);
    }
    if (!['GET', 'HEAD'].includes(request.method)) return send(response, 405, { error: { code: 'METHOD', message: 'Only GET, HEAD and the Create Work POST are served.' } }, { Allow: 'GET, HEAD' });

    if (!url.pathname.startsWith('/api/')) return serveUi(url.pathname, response);
    if (!authorized(request)) return send(response, 401, { error: { code: 'UNAUTHORIZED', message: 'Missing or wrong console token. Open the link printed by `yallaflow console`.' } });

    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    if (parts.length === 2 && parts[1] === 'projects') {
      return send(response, 200, { projects: projects.map(({ id, name, root }) => ({ id, name, root })), unavailable: missing, readOnly });
    }
    if (parts.length === 2 && parts[1] === 'events') {
      if (request.method !== 'GET') return send(response, 405, { error: { code: 'METHOD', message: 'The event stream is GET only.' } }, { Allow: 'GET' });
      return openEvents(request, response);
    }
    if (parts[1] !== 'p' || !byId.has(parts[2])) return send(response, 404, { error: { code: 'NOT_FOUND', message: 'Unknown project.' } });
    const project = byId.get(parts[2]);
    const rest = parts.slice(3);
    if (rest.length === 1 && rest[0] === 'snapshot') {
      return send(response, 200, await runner.get(project.root, 'snapshot', ['snapshot', '--json']));
    }
    if (rest.length === 2 && rest[0] === 'work' && isWorkId(rest[1])) {
      return send(response, 200, await runner.get(project.root, `work:${rest[1]}`, ['work', 'show', rest[1], '--json']));
    }
    if (rest.length === 1 && rest[0] === 'worktrees') {
      return send(response, 200, await teamView(project));
    }
    if (rest.length === 3 && rest[0] === 'sources' && isSourceId(rest[1]) && ['original', 'text'].includes(rest[2])) {
      return serveSource(project.root, rest[1], rest[2], response);
    }
    return send(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
  }

  // POST /api/p/<project>/work                 — create (JSON)
  // POST /api/p/<project>/work/<id>/sources    — attach one file to the item it created
  async function handleWrite(request, response, url) {
    const parts = url.pathname.split('/').filter(Boolean);
    const project = parts[1] === 'p' ? byId.get(parts[2]) : null;
    if (!project) return send(response, 404, { error: { code: 'NOT_FOUND', message: 'Unknown project.' } });
    const rest = parts.slice(3);
    const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (rest.length === 1 && rest[0] === 'work') {
      if (type !== 'application/json') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send application/json.' } });
      const input = validateCreateBody(await readJsonBody(request));
      const result = await createWork(project.root, input, runner);
      const detail = await runner.get(project.root, `work:${result.id}`, ['work', 'show', result.id, '--json']);
      return send(response, result.created ? 201 : 200, { ...result, item: detail.item });
    }
    if (rest.length === 3 && rest[0] === 'work' && isWorkId(rest[1]) && rest[2] === 'sources') {
      if (type !== 'application/octet-stream') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send the file as application/octet-stream.' } });
      const result = await attachFile(project.root, rest[1], request, runner);
      return send(response, result.duplicate ? 200 : 201, result);
    }
    return send(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
  }

  // Worktrees of a project, each with its own recorded YallaFlow state and changed files.
  // Recomputed at most every 5 s; worktree snapshots are read fresh each time.
  const teamCache = new Map();
  async function teamView(project) {
    const cached = teamCache.get(project.id);
    if (cached && Date.now() - cached.at < 5000) return cached.value;
    const listed = await listWorktrees(project.root);
    const worktrees = [];
    for (const entry of listed.worktrees) {
      const item = { path: entry.path, branch: entry.branch, main: entry.main, exists: entry.exists, yallaflow: false, changed: null, ...(entry.unverified ? { unverified: true } : {}) };
      if (entry.exists) {
        item.changed = await changedFiles(entry.path);
        if (await exists(path.join(entry.path, '.yallaflow'))) {
          item.yallaflow = true;
          runner.invalidate(entry.path);
          try {
            const snap = await runner.get(entry.path, 'snapshot', ['snapshot', '--json']);
            const active = snap.items.find((it) => it.id === snap.project.activeWork) ?? null;
            item.activeWork = active ? { id: active.id, title: active.title, state: active.state, currentStation: active.currentStation, completion: active.completion, stage: active.stage } : null;
            item.counts = snap.counts;
            item.lastRecordedActivity = snap.items.map((it) => it.lastActivityAt).filter(Boolean).sort().at(-1) ?? null;
          } catch (error) {
            item.error = error.message;
          }
          if (entry.path !== project.root) runner.invalidate(entry.path);
        }
      }
      worktrees.push(item);
    }
    const owners = new Map();
    for (const item of worktrees) for (const file of item.changed ?? []) owners.set(file.path, [...(owners.get(file.path) ?? []), item.path]);
    const overlaps = [...owners].filter(([, list]) => list.length > 1).map(([file, list]) => ({ path: file, worktrees: list }));
    const value = { git: listed.git, worktrees, overlaps, generatedAt: new Date().toISOString() };
    teamCache.set(project.id, { at: Date.now(), value });
    return value;
  }

  function authorized(request) {
    const header = request.headers.authorization ?? '';
    const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
    return given.length === tokenBuffer.length && timingSafeEqual(given, tokenBuffer);
  }

  function openEvents(request, response) {
    response.writeHead(200, { ...BASE_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
    response.write(`data: ${JSON.stringify({ type: 'hello', at: new Date().toISOString() })}\n\n`);
    clients.add(response);
    request.on('close', () => clients.delete(response));
  }

  const listening = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server.address()));
  });

  return {
    url: `http://127.0.0.1:${listening.port}/`,
    port: listening.port,
    token,
    projects,
    watchModes: watchers.map((entry) => entry.mode),
    async close() {
      clearInterval(heartbeat);
      for (const watcher of watchers) watcher.close();
      for (const client of clients) client.end();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

async function serveUi(pathname, response) {
  const entry = UI_FILES[pathname];
  if (!entry) return send(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
  const body = await readFile(path.join(UI_DIR, entry[0]));
  response.writeHead(200, { ...BASE_HEADERS, 'Content-Type': entry[1], ...(entry[0] === 'index.html' ? { 'Content-Security-Policy': PAGE_CSP } : {}) });
  response.end(body);
}

async function serveSource(root, sourceId, kind, response) {
  let record;
  try {
    record = await loadSource(root, sourceId);
  } catch {
    return send(response, 404, { error: { code: 'NOT_FOUND', message: `Source ${sourceId} was not found.` } });
  }
  const sourcesDir = await realpath(path.join(root, '.yallaflow', 'sources'));
  if (kind === 'text') {
    const text = await loadSourceText(root, record);
    if (text === null) return send(response, 404, { error: { code: 'NO_TEXT', message: `${sourceId} has no extracted text.` } });
    response.writeHead(200, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': "sandbox; default-src 'none'" });
    return response.end(text);
  }
  const file = sourceOriginalPath(root, record);
  let real;
  try {
    real = await realpath(file);
  } catch {
    return send(response, 404, { error: { code: 'NOT_FOUND', message: `${sourceId} has no preserved original.` } });
  }
  if (!real.startsWith(sourcesDir + path.sep) || !(await stat(real)).isFile()) return send(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
  const extension = path.extname(real).slice(1).toLowerCase();
  const type = PREVIEW_TYPES[extension];
  if (!type) return send(response, 415, { error: { code: 'NO_PREVIEW', message: `${sourceId} (${extension || 'unknown'}) has no preview; use its extracted text.` } });
  response.writeHead(200, {
    ...BASE_HEADERS,
    'Content-Type': type,
    'Content-Disposition': `inline; filename="${path.basename(real).replace(/[^\w.-]/g, '_')}"`,
    'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'"
  });
  response.end(await readFile(real));
}

function send(response, status, body, headers = {}) {
  if (response.headersSent) return response.end();
  response.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new HttpError(413, 'TOO_LARGE', 'The request is too large.');
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new HttpError(413, 'TOO_LARGE', 'The request is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'BAD_REQUEST', 'The body is not valid JSON.');
  }
}
