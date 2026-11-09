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
import { decideGate, gateReview, runAction } from './actions.js';
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
import { isServiceId, runRuntimeAction, runRuntimePlanAction, runRuntimeProjectAction } from './runtime.js';
import { wizardCatalog, wizardCreate, wizardPlan, wizardProgress } from './newproject.js';
import { AgentBridge } from '../agents/bridge.js';
import { detectProviders } from '../agents/detect.js';
import { FolderError, listFolders } from './folders.js';
import { addProject as saveToRegistry, removeProject as forgetInRegistry } from './registry.js';
import { addRuntimeService, attachPlannedFile, createdProjectRoot, gitInit, probeTools, workspaceRoot } from './greenfield.js';
import { CLAUDE_NOT_INCLUDED, claudeIncluded, loadClaude } from '../agents/experimental.js';
import { readAgentSettings, writeAgentSettings } from '../agents/settings.js';
import { markSetup, readSetup, scanSetup, setupPending } from './setup.js';

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
// 1.4.0: work-item actions and review-gate decisions (PF-0043) join Create Work.
// 1.4.0 Greenfield journey (PF-0057): register a project, enable agents for this run, Git init,
// add a runtime service, attach a planned file to a new project's first work item.
const WRITE_ROUTE = /^\/api\/p\/[0-9a-f]{10}\/(?:work(?:\/[^/]+\/(?:sources|revision-sources|actions\/[a-z]+|gates\/[a-z]+\/decision))?|runtime\/[a-z][a-z0-9-]{0,31}\/(?:trust|start|stop|restart)|runtime\/services|runtime\/(?:start|stop)-all|runtime\/analyze|runtime\/plan\/save|agents\/(?:settings|launch-files)|setup\/(?:scan|step)|git\/init)$|^\/api\/new\/(?:plan|create|plans\/NP-\d{14}-[0-9a-f]{6}\/files)$|^\/api\/(?:projects|projects\/remove|agents\/enable)$/;
// Agent Interaction (v1.3.0, only with --agents): the Agent Workspace's actions.
const AGENT_ROUTE = /^\/api\/p\/[0-9a-f]{10}\/agent\/(start|message|permission|cancel|end|resume|connect|disconnect|activate)$/;
// The Claude channel server and hook forwarder (bridge token, never a browser).
const BRIDGE_ROUTE = /^\/api\/agent-bridge\/claude\/(stream|event|hook|hello)$/;

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

export async function startConsoleServer({ roots, port = 0, host = '127.0.0.1', token = randomBytes(24).toString('hex'), poll = false, missing = [], readOnly = false, agents = false, experimentalClaude = false, agentEnv = process.env } = {}) {
  // Agent Interaction needs writes; --read-only keeps the console genuinely read-only.
  // Agents start on with --agents, or later for this run only by an explicit, confirmed
  // action in a non-read-only console (owner decision, PF-0057 Q-001).
  let agentsOn = Boolean(agents) && !readOnly;
  // Claude Code (experimental, PF-0060): only with --experimental-claude or an explicit
  // choice when enabling agents in the console; never by default, never read-only.
  let claudeOn = agentsOn && Boolean(experimentalClaude);
  let bridge = null;
  const runner = createRunner();
  const projects = await Promise.all(roots.map(async (root) => ({ id: projectId(root), root, name: (await projectName(root)) ?? path.basename(root) })));
  const byId = new Map(projects.map((entry) => [entry.id, entry]));
  // PF-0069: each project's saved agent choice (.yallaflow/local/agents.json) applies when
  // the console opens. A read-only console ignores it.
  const savedChoices = new Map();
  if (!readOnly) for (const entry of projects) savedChoices.set(entry.id, await readAgentSettings(entry.root));
  if (!readOnly && [...savedChoices.values()].some((choice) => choice.chosen && choice.agents)) agentsOn = true;
  const claudeChosen = () => (claudeIncluded() ? [...savedChoices.entries()].filter(([, choice]) => choice.chosen && choice.claude).map(([id]) => id) : []);
  const clients = new Set();
  const tokenBuffer = Buffer.from(token);

  const watch = (project) => watchWorkspace(project.root, () => {
    runner.invalidate(project.root);
    const message = `data: ${JSON.stringify({ type: 'change', project: project.id, at: new Date().toISOString() })}\n\n`;
    for (const client of clients) client.write(message);
  }, { poll });
  const watchers = projects.map(watch);

  // Adds a workspace to this running console and to the saved list (no duplicates).
  // Registrations run one at a time (security review, PF-0057): parallel requests for the
  // same folder must not add it twice, and the saved list is rewritten by one writer.
  let registering = Promise.resolve();
  function registerRoot(root) {
    const next = registering.then(() => registerNow(root));
    registering = next.catch(() => {});
    return next;
  }
  async function registerNow(root) {
    const real = await workspaceRoot(root);
    const known = [];
    for (const entry of projects) known.push([entry, await realpath(entry.root).catch(() => entry.root)]);
    const already = known.find(([, existing]) => existing === real)?.[0];
    const saved = await saveToRegistry(real);
    if (already) return { id: already.id, name: already.name, root: already.root, added: false, saved: saved.added };
    if (byId.has(projectId(real))) { const same = byId.get(projectId(real)); return { id: same.id, name: same.name, root: same.root, added: false, saved: saved.added }; }
    const entry = { id: projectId(real), root: real, name: (await projectName(real)) ?? path.basename(real) };
    projects.push(entry);
    byId.set(entry.id, entry);
    watchers.push(watch(entry));
    if (!readOnly) {
      const choice = await readAgentSettings(entry.root);
      savedChoices.set(entry.id, choice);
      if (choice.chosen && choice.agents && !agentsOn) await enableAgents();
    }
    await bridge?.addProject(entry);
    if (bridge && savedChoices.get(entry.id)?.claude && claudeIncluded()) await bridge.enableClaude(entry.id);
    const message = `data: ${JSON.stringify({ type: 'projects', project: entry.id, at: new Date().toISOString() })}\n\n`;
    for (const client of clients) client.write(message);
    return { id: entry.id, name: entry.name, root: entry.root, added: true, saved: saved.added };
  }
  // A project the wizard just made: add it, then scan its stack once (PF-0084), so Setup
  // starts from the generated files instead of asking for a scan the developer just chose.
  // A failed scan only leaves the step open.
  async function registerCreated(planId) {
    const registration = await registerRoot((await createdProjectRoot(planId)).root);
    if (!readOnly) await scanSetup(registration.root, runner).catch(() => {});
    return registration;
  }
  // PF-0081: takes a project off this console and off the saved list. The project's own
  // files and .yallaflow records are never touched; it can be added again later. Runs in
  // the same queue as registration, so the saved list keeps one writer.
  function unregister(target) {
    const next = registering.then(() => unregisterNow(target));
    registering = next.catch(() => {});
    return next;
  }
  async function unregisterNow({ id, root }) {
    if (root !== undefined) {
      // An unavailable saved project: only an entry the console listed as unavailable.
      const at = missing.indexOf(root);
      if (at === -1) throw Object.assign(new Error('That folder is not in the unavailable list.'), { status: 404, code: 'NOT_FOUND' });
      await forgetInRegistry(root);
      missing.splice(at, 1);
      broadcastProjects(null);
      return { removed: true, root };
    }
    const entry = byId.get(id);
    if (!entry) throw Object.assign(new Error('Unknown project.'), { status: 404, code: 'NOT_FOUND' });
    await bridge?.removeProject(entry.id);
    await forgetInRegistry(entry.root);
    const at = projects.indexOf(entry);
    if (at !== -1) {
      projects.splice(at, 1);
      watchers.splice(at, 1)[0]?.close();
    }
    byId.delete(entry.id);
    savedChoices.delete(entry.id);
    teamCache.delete(entry.id);
    runner.invalidate(entry.root);
    broadcastProjects(entry.id);
    return { removed: true, id: entry.id, root: entry.root };
  }
  function broadcastProjects(projectId) {
    const message = `data: ${JSON.stringify({ type: 'projects', project: projectId, at: new Date().toISOString() })}\n\n`;
    for (const client of clients) client.write(message);
  }
  async function agentSettingsView(project, scan) {
    // A read-only console runs no agent probes (security review, PF-0069).
    if (readOnly) return { readOnly: true, claudeAvailable: claudeIncluded(), saved: { chosen: false }, applied: { agents: false, claude: false }, codex: null, claude: null, checklist: null };
    const choice = savedChoices.get(project.id) ?? (readOnly ? { chosen: false } : await readAgentSettings(project.root));
    const claudeOnHere = Boolean(bridge?.claudeOnFor(project.id));
    const detected = await detectProviders({ env: agentEnv, claude: (scan || claudeOnHere || choice.claude) && claudeIncluded(), maxAgeMs: scan ? 0 : 30_000 });
    const claudeKit = claudeOnHere ? await loadClaude() : null;
    const launchFiles = claudeKit ? await claudeKit.launchFilesCurrent(project.root) : false;
    const provider = (found) => (found ? { ready: Boolean(found.ready), problems: found.problems ?? [], warnings: found.warnings ?? [], version: found.claude?.version ?? found.codex?.version ?? null, auth: found.auth ? { loggedIn: Boolean(found.auth.loggedIn), method: found.auth.method ?? null, plan: found.auth.plan ?? null } : null } : null);
    return {
      readOnly, claudeAvailable: claudeIncluded(),
      saved: choice,
      applied: { agents: agentsOn, claude: claudeOnHere },
      codex: provider(detected.codex),
      claude: detected.claude ? provider(detected.claude) : null,
      checklist: claudeOnHere ? { ...bridge.claudeChecklist(project.id), launchFiles } : null,
      // The command to run, once the launch files on disk are current (never before).
      launchCommand: launchFiles ? claudeKit.launchCommand(project.root) : null
    };
  }
  const heartbeat = setInterval(() => { for (const client of clients) client.write(': ping\n\n'); }, 25_000);
  heartbeat.unref();

  const server = http.createServer(async (request, response) => {
    try {
      await handle(request, response);
    } catch (error) {
      send(response, error.status ?? (['WORK_NOT_FOUND', 'RUNTIME_UNKNOWN_SERVICE'].includes(error.code) ? 404 : 500), { error: { code: error.code ?? 'ERROR', message: error.message, ...(error.command ? { command: error.command } : {}) }, ...(error.extra ?? {}) });
    }
  });

  async function handle(request, response) {
    const address = server.address();
    const allowedHosts = [`127.0.0.1:${address.port}`, `localhost:${address.port}`];
    if (!allowedHosts.includes(request.headers.host)) return send(response, 421, { error: { code: 'MISDIRECTED', message: 'Unknown host.' } });
    const origin = request.headers.origin;
    if (origin && !allowedHosts.map((entry) => `http://${entry}`).includes(origin)) return send(response, 403, { error: { code: 'FORBIDDEN_ORIGIN', message: 'Foreign origin.' } });
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (BRIDGE_ROUTE.test(url.pathname)) return handleBridge(request, response, url);
    if (request.method === 'POST' && agentsOn && AGENT_ROUTE.test(url.pathname)) {
      if (!authorized(request)) return send(response, 401, { error: { code: 'UNAUTHORIZED', message: 'Missing or wrong console token. Open the link printed by `yallaflow console`.' } });
      if (!origin) return send(response, 403, { error: { code: 'FORBIDDEN_ORIGIN', message: 'An agent action needs the console page as its Origin.' } });
      return handleAgent(request, response, url);
    }
    if (request.method === 'POST') {
      // Writes: only the Create Work routes, only with the token, our own Origin and the exact type.
      if (readOnly || !WRITE_ROUTE.test(url.pathname)) return send(response, 405, { error: { code: 'READ_ONLY', message: readOnly ? 'This console was started with --read-only.' : 'Only Create Work, work-item actions, gate decisions, runtime actions, project registration, agent enablement, Git init and the New Project Wizard accept POST.' } }, { Allow: 'GET, HEAD' });
      if (!authorized(request)) return send(response, 401, { error: { code: 'UNAUTHORIZED', message: 'Missing or wrong console token. Open the link printed by `yallaflow console`.' } });
      if (!origin) return send(response, 403, { error: { code: 'FORBIDDEN_ORIGIN', message: 'A write needs the console page as its Origin.' } });
      return handleWrite(request, response, url);
    }
    if (!['GET', 'HEAD'].includes(request.method)) return send(response, 405, { error: { code: 'METHOD', message: 'Only GET, HEAD and the Create Work POST are served.' } }, { Allow: 'GET, HEAD' });

    if (!url.pathname.startsWith('/api/')) return serveUi(url.pathname, response);
    if (!authorized(request)) return send(response, 401, { error: { code: 'UNAUTHORIZED', message: 'Missing or wrong console token. Open the link printed by `yallaflow console`.' } });

    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
    if (parts.length === 2 && parts[1] === 'projects') {
      return send(response, 200, { projects: projects.map(({ id, name, root }) => ({ id, name, root })), unavailable: missing, readOnly, agents: { enabled: agentsOn, claude: claudeOn, canEnable: !readOnly && !agentsOn, claudeAvailable: claudeIncluded() } });
    }
    // 1.4.0 (PF-0057) reads: folders inside home, tool availability, agent readiness.
    if (parts.length === 3 && parts[1] === 'fs' && parts[2] === 'dirs') {
      if (readOnly) return send(response, 405, { error: { code: 'READ_ONLY', message: 'This console was started with --read-only; it does not choose folders.' } });
      try {
        return send(response, 200, await listFolders(url.searchParams.get('path') ?? ''));
      } catch (error) {
        if (error instanceof FolderError) return send(response, error.status, { error: { code: error.code, message: error.message } });
        throw error;
      }
    }
    // Probes run programs (--version only): never in a read-only console (security review).
    if (parts.length === 3 && parts[1] === 'new' && parts[2] === 'tools') return readOnly ? send(response, 405, { error: { code: 'READ_ONLY', message: 'This console was started with --read-only.' } }) : send(response, 200, await probeTools());
    if (parts.length === 2 && parts[1] === 'agents') {
      if (readOnly) return send(response, 200, { enabled: false, canEnable: false, readOnly: true, claude: false, codex: null });
      const found = await detectProviders({ env: agentEnv, claude: claudeOn });
      return send(response, 200, { enabled: agentsOn, canEnable: !readOnly && !agentsOn, readOnly, claude: claudeOn, claudeAvailable: claudeIncluded(), codex: { ready: Boolean(found.codex?.ready), problems: found.codex?.problems ?? [] }, ...(found.claude ? { claudeCode: { ready: Boolean(found.claude.ready), problems: found.claude.problems ?? [] } } : {}) });
    }
    if (parts.length === 2 && parts[1] === 'events') {
      if (request.method !== 'GET') return send(response, 405, { error: { code: 'METHOD', message: 'The event stream is GET only.' } }, { Allow: 'GET' });
      return openEvents(request, response);
    }
    // 1.4.0 New Project Wizard reads (not tied to an existing project).
    if (parts.length === 3 && parts[1] === 'new' && parts[2] === 'catalog') return send(response, 200, await wizardCatalog(projects[0]?.root ?? process.cwd(), runner));
    if (parts.length === 4 && parts[1] === 'new' && parts[2] === 'plans' && /^NP-\d{14}-[0-9a-f]{6}$/.test(parts[3])) return send(response, 200, await wizardProgress(parts[3]));
    if (parts[1] !== 'p' || !byId.has(parts[2])) return send(response, 404, { error: { code: 'NOT_FOUND', message: 'Unknown project.' } });
    const project = byId.get(parts[2]);
    const rest = parts.slice(3);
    if (rest.length === 1 && rest[0] === 'snapshot') {
      return send(response, 200, await runner.get(project.root, 'snapshot', ['snapshot', '--json']));
    }
    // 1.4.0 runtime: services, their live state and suggestions; logs on demand. Never starts anything.
    // PF-0069: Setup → Agents. The saved choice, what is applied in this run, detection
    // (Claude only on request: ?scan=1) and the connection checklist. Read-only.
    if (rest.length === 2 && rest[0] === 'agents' && rest[1] === 'settings') {
      return send(response, 200, await agentSettingsView(project, url.searchParams.get('scan') === '1'));
    }
    // PF-0069: the saved project setup (last stack scan, steps) and whether to offer it.
    if (rest.length === 1 && rest[0] === 'setup') {
      const record = await readSetup(project.root);
      return send(response, 200, { record, pending: !readOnly && setupPending(record), readOnly });
    }
    if (rest.length === 1 && rest[0] === 'runtime') {
      return send(response, 200, await runner.readFresh(project.root, ['runtime', 'status', '--json']));
    }
    // PF-0072: the runtime plan (scan + agent proposal) and the review before trust. Read-only.
    if (rest.length === 2 && rest[0] === 'runtime' && rest[1] === 'plan') {
      return send(response, 200, await runner.readFresh(project.root, ['runtime', 'plan', 'show', '--json']));
    }
    if (rest.length === 3 && rest[0] === 'runtime' && isServiceId(rest[1]) && rest[2] === 'review') {
      return send(response, 200, await runner.readFresh(project.root, ['runtime', 'review', rest[1], '--json']));
    }
    if (rest.length === 3 && rest[0] === 'runtime' && isServiceId(rest[1]) && rest[2] === 'logs') {
      const lines = Math.max(1, Math.min(1000, Number.parseInt(url.searchParams.get('lines') ?? '200', 10) || 200));
      return send(response, 200, await runner.readFresh(project.root, ['runtime', 'logs', rest[1], '--lines', String(lines), '--json']));
    }
    // 1.4.0: the project itself — memory, evidence-based stack, onboarding status. Read-only.
    if (rest.length === 1 && rest[0] === 'overview') {
      return send(response, 200, await runner.readFresh(project.root, ['overview', '--json']));
    }
    if (rest.length === 2 && rest[0] === 'work' && isWorkId(rest[1])) {
      return send(response, 200, await runner.get(project.root, `work:${rest[1]}`, ['work', 'show', rest[1], '--json']));
    }
    // 1.4.0: what a review-gate decision is about, with the digest the decision must match.
    if (rest.length === 4 && rest[0] === 'work' && isWorkId(rest[1]) && rest[2] === 'gates') {
      return send(response, 200, await gateReview(project.root, rest[1], rest[3], runner));
    }
    if (rest.length === 1 && rest[0] === 'agent') {
      if (!agentsOn) return send(response, 200, { enabled: false });
      return send(response, 200, await bridge.status(project.id));
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
    // 1.4.0 (PF-0057): register a project — a plan's finished project, or an existing
    // YallaFlow project inside the home folder chosen in the folder chooser.
    if (parts.length === 2 && parts[1] === 'projects') {
      const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send application/json.' } });
      const body = await readJsonBody(request);
      const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
      if (keys.length !== 1 || !['planId', 'root'].includes(keys[0]) || typeof body[keys[0]] !== 'string' || !body[keys[0]]) return send(response, 400, { error: { code: 'BAD_REQUEST', message: 'Send { planId } or { root }.' } });
      if (body.planId) return send(response, 200, await registerRoot((await createdProjectRoot(body.planId)).root));
      try {
        const listed = await listFolders(body.root); // home-bounded, real folder
        return send(response, 200, await registerRoot(listed.path));
      } catch (error) {
        if (error instanceof FolderError) return send(response, error.status, { error: { code: error.code, message: error.message } });
        throw error;
      }
    }
    if (parts.length === 3 && parts[1] === 'projects' && parts[2] === 'remove') {
      const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send application/json.' } });
      const body = await readJsonBody(request);
      const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
      if (keys.length !== 1 || !['id', 'root'].includes(keys[0]) || typeof body[keys[0]] !== 'string' || !body[keys[0]]) return send(response, 400, { error: { code: 'BAD_REQUEST', message: 'Send { id } or { root }.' } });
      return send(response, 200, await unregister(body));
    }
    if (parts.length === 3 && parts[1] === 'agents' && parts[2] === 'enable') {
      const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send application/json.' } });
      const body = await readJsonBody(request);
      const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
      if (body?.confirm !== true || keys.some((key) => !['confirm', 'claude'].includes(key)) || ('claude' in body && typeof body.claude !== 'boolean')) return send(response, 400, { error: { code: 'CONFIRMATION_REQUIRED', message: 'Confirm enabling agents for this console session.' } });
      return send(response, 200, await enableAgents({ claude: body.claude === true }));
    }
    if (parts.length === 5 && parts[1] === 'new' && parts[2] === 'plans' && parts[4] === 'files') {
      const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/octet-stream') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send the file as application/octet-stream.' } });
      const result = await attachPlannedFile(parts[3], request, runner);
      return send(response, result.duplicate ? 200 : 201, result);
    }
    // 1.4.0 New Project Wizard: POST /api/new/plan, /api/new/create (JSON only).
    if (parts[1] === 'new') {
      const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send application/json.' } });
      const body = await readJsonBody(request);
      const cwd = projects[0]?.root ?? process.cwd();
      return send(response, 200, parts[2] === 'plan' ? await wizardPlan(cwd, body, runner) : await wizardCreate(cwd, body, runner, { register: registerCreated }));
    }
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
    if (rest.length === 4 && rest[0] === 'work' && isWorkId(rest[1]) && rest[2] === 'actions') {
      if (type !== 'application/json') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send application/json.' } });
      return send(response, 200, await runAction(project.root, rest[3], rest[1], await readJsonBody(request), runner));
    }
    if (rest.length === 5 && rest[0] === 'work' && isWorkId(rest[1]) && rest[2] === 'gates' && rest[4] === 'decision') {
      if (type !== 'application/json') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send application/json.' } });
      return send(response, 200, await decideGate(project.root, rest[1], rest[3], await readJsonBody(request), runner));
    }
    // 1.4.0 (PF-0057): add a runtime service (Core runtime add; nothing starts), Git init.
    if (rest.length === 2 && rest[0] === 'runtime' && rest[1] === 'services') {
      if (type !== 'application/json') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send application/json.' } });
      return send(response, 201, await addRuntimeService(project.root, await readJsonBody(request), runner));
    }
    if (rest.length === 2 && rest[0] === 'git' && rest[1] === 'init') {
      if (type !== 'application/json') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send application/json.' } });
      const body = await readJsonBody(request);
      if (!body || body.confirm !== true || Object.keys(body).length !== 1) return send(response, 400, { error: { code: 'CONFIRMATION_REQUIRED', message: 'Confirm initializing a Git repository.' } });
      teamCache.delete(project.id);
      return send(response, 200, await gitInit(project.root));
    }
    // PF-0069: save the project's agent choice and apply it now; write the launch files.
    if (rest.length === 2 && rest[0] === 'agents' && ['settings', 'launch-files'].includes(rest[1])) {
      if (type !== 'application/json') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send application/json.' } });
      const body = await readJsonBody(request);
      if (rest[1] === 'launch-files') {
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) return send(response, 400, { error: { code: 'BAD_REQUEST', message: 'Send an empty JSON object.' } });
        if (!bridge?.claudeOnFor(project.id)) return send(response, 409, { error: { code: 'CLAUDE_OFF', message: 'Turn Claude Code on for this project first.' } });
        const files = await (await loadClaude()).writeClaudeLaunchFiles(project.root);
        return send(response, 200, { command: files.command });
      }
      const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
      if (keys.length !== 2 || typeof body.agents !== 'boolean' || typeof body.claude !== 'boolean') return send(response, 400, { error: { code: 'BAD_REQUEST', message: 'Send { "agents": true|false, "claude": true|false }.' } });
      if (body.claude && !claudeIncluded()) return send(response, 409, { error: { code: 'CLAUDE_NOT_INCLUDED', message: CLAUDE_NOT_INCLUDED } });
      const choice = await writeAgentSettings(project.root, body);
      savedChoices.set(project.id, choice);
      if (choice.agents && !agentsOn) await enableAgents();
      if (bridge) {
        if (choice.claude) {
          await bridge.enableClaude(project.id);
          // Written now, so the command the checklist shows always runs YallaFlow's own files.
          await (await loadClaude()).writeClaudeLaunchFiles(project.root);
        } else await bridge.disableClaude(project.id);
      }
      return send(response, 200, await agentSettingsView(project, false));
    }
    // PF-0069: scan (or rescan) the stack and save it; mark a setup step done or skipped.
    if (rest.length === 2 && rest[0] === 'setup' && ['scan', 'step'].includes(rest[1])) {
      if (type !== 'application/json') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send application/json.' } });
      const body = await readJsonBody(request);
      if (rest[1] === 'scan') {
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) return send(response, 400, { error: { code: 'BAD_REQUEST', message: 'Send an empty JSON object.' } });
        return send(response, 200, await scanSetup(project.root, runner));
      }
      return send(response, 200, { record: await markSetup(project.root, body) });
    }
    // PF-0072: Analyze (read-only scan) and Save selected (untrusted definitions).
    if ((rest.length === 2 && rest[0] === 'runtime' && rest[1] === 'analyze') || (rest.length === 3 && rest[0] === 'runtime' && rest[1] === 'plan' && rest[2] === 'save')) {
      if (type !== 'application/json') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send application/json.' } });
      return send(response, 200, await runRuntimePlanAction(project.root, rest[1] === 'analyze' ? 'analyze' : 'save', await readJsonBody(request), runner));
    }
    // PF-0069: Start project / Stop project.
    if (rest.length === 2 && rest[0] === 'runtime' && ['start-all', 'stop-all'].includes(rest[1])) {
      if (type !== 'application/json') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send application/json.' } });
      return send(response, 200, await runRuntimeProjectAction(project.root, rest[1].replace('-all', ''), await readJsonBody(request), runner));
    }
    // 1.4.0 runtime: POST /api/p/<project>/runtime/<service>/(trust|start|stop|restart)
    if (rest.length === 3 && rest[0] === 'runtime' && isServiceId(rest[1])) {
      if (type !== 'application/json') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send application/json.' } });
      return send(response, 200, await runRuntimeAction(project.root, rest[1], rest[2], await readJsonBody(request), runner));
    }
    if (rest.length === 3 && rest[0] === 'work' && isWorkId(rest[1]) && ['sources', 'revision-sources'].includes(rest[2])) {
      if (type !== 'application/octet-stream') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send the file as application/octet-stream.' } });
      const result = await attachFile(project.root, rest[1], request, runner, { revision: rest[2] === 'revision-sources' });
      return send(response, result.duplicate ? 200 : 201, result);
    }
    return send(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
  }

  // ----- Agent Workspace actions (browser token + Origin, JSON only) -----
  async function handleAgent(request, response, url) {
    const type = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') return send(response, 415, { error: { code: 'CONTENT_TYPE', message: 'Send application/json.' } });
    const parts = url.pathname.split('/').filter(Boolean);
    const project = byId.get(parts[2]);
    if (!project) return send(response, 404, { error: { code: 'NOT_FOUND', message: 'Unknown project.' } });
    const body = await readJsonBody(request);
    const action = parts[4];
    const workId = body.workId === undefined || body.workId === null ? null : String(body.workId);
    if (workId !== null && !isWorkId(workId)) return send(response, 400, { error: { code: 'BAD_WORK', message: 'Invalid work item.' } });
    switch (action) {
      case 'start':
        if (body.provider !== 'codex') return send(response, 400, { error: { code: 'UNSUPPORTED', message: 'Only Codex sessions are started by YallaFlow.' } });
        return send(response, 201, await bridge.startCodex(project.id, { workId, mode: 'mode' in body ? body.mode : undefined }));
      case 'resume':
        return send(response, 201, await bridge.resumeCodex(project.id, String(body.recordId ?? ''), { mode: 'mode' in body ? body.mode : undefined }));
      case 'message':
        return send(response, 202, await bridge.message(project.id, body.text));
      case 'permission':
        return send(response, 200, bridge.answerPermission(project.id, String(body.requestId ?? ''), String(body.decision ?? '')));
      case 'cancel':
        return send(response, 200, bridge.cancel(project.id));
      case 'end':
        return send(response, 200, await bridge.end(project.id));
      case 'connect': {
        if (body.provider !== 'claude' || !bridge.claudeOnFor(project.id)) return send(response, 400, { error: { code: 'UNSUPPORTED', message: 'Claude Code sessions are not enabled in this console.' } });
        // Claim the slot first; the launch files are written only by the console that owns it.
        const summary = await bridge.connectClaude(project.id, { workId });
        const files = await (await loadClaude()).writeClaudeLaunchFiles(project.root);
        return send(response, 200, { ...summary, launch: { command: files.command } });
      }
      case 'disconnect':
        return send(response, 200, await bridge.disconnectClaude(project.id));
      case 'activate': {
        if (!workId) return send(response, 400, { error: { code: 'BAD_WORK', message: 'Name the work item to activate.' } });
        return send(response, 200, await bridge.activate(project.id, workId));
      }
      default:
        return send(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
    }
  }

  // ----- Claude channel server + hook forwarder (bridge token; never a browser) -----
  async function handleBridge(request, response, url) {
    if (!agentsOn || !bridge?.anyClaude()) return send(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
    if (request.headers.origin) return send(response, 403, { error: { code: 'FORBIDDEN_ORIGIN', message: 'Not for browsers.' } });
    // The channel and the hook check this console before they send the token (PF-0060).
    if (url.pathname.endsWith('/hello')) {
      if (request.method !== 'GET') return send(response, 405, { error: { code: 'METHOD', message: 'GET only.' } });
      const proof = bridge.bridgeProof(String(url.searchParams.get('id') ?? ''), String(url.searchParams.get('nonce') ?? ''));
      return proof ? send(response, 200, { proof }) : send(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
    }
    const header = String(request.headers.authorization ?? '');
    const target = bridge.projectByBridgeToken(header.startsWith('Bearer ') ? header.slice(7) : '');
    if (!target) return send(response, 401, { error: { code: 'UNAUTHORIZED', message: 'Missing or wrong bridge token.' } });
    if (!target.claudeOn || !target.claude) return send(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
    const kind = url.pathname.split('/').pop();
    if (kind === 'stream') {
      if (request.method !== 'GET') return send(response, 405, { error: { code: 'METHOD', message: 'GET only.' } });
      const pid = Number(url.searchParams.get('pid'));
      if (!target.owner) return send(response, 409, { error: { code: 'CHECKOUT_LOCKED', message: 'Another YallaFlow console owns agent sessions in this checkout.' } });
      if (target.session?.provider === 'codex') return send(response, 409, { error: { code: 'SESSION_ACTIVE', message: 'A Codex session owns this checkout. End it first.' } });
      if (target.claude.streamBusy()) return send(response, 409, { error: { code: 'CHANNEL_ACTIVE', message: 'A Claude Code channel is already connected to this project.' } });
      response.writeHead(200, { ...BASE_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
      response.write(': connected\n\n');
      target.claude.attachStream(response, { pid: Number.isInteger(pid) ? pid : null });
      return;
    }
    if (request.method !== 'POST') return send(response, 405, { error: { code: 'METHOD', message: 'POST only.' } });
    const body = await readJsonBody(request);
    // Claude may have been turned off while the body was read.
    if (!target.claudeOn || !target.claude) return send(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
    if (kind === 'event') {
      target.claude.onChannelEvent(body).catch(() => {});
      return send(response, 200, { ok: true });
    }
    target.claude.onHook(body);
    return send(response, 200, {});
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

  const makeBridge = ({ claude = claudeOn } = {}) => new AgentBridge({
    projects,
    port: listening.port,
    claude,
    claudeFor: claudeChosen(),
    env: agentEnv,
    broadcast: (projectId, event) => {
      const message = `data: ${JSON.stringify({ type: 'agent', project: projectId, event })}\n\n`;
      for (const client of clients) client.write(message);
    },
    // Activation is an explicit user action, carried out by Core itself.
    runActivate: async (root, workId) => {
      const result = await runner.write(root, ['activate', workId]);
      if (result.status !== 0) throw Object.assign(new Error((result.stderr || result.stdout).trim().split('\n')[0] || 'Activation failed.'), { status: 422, code: 'ACTIVATE_REFUSED' });
      return { ok: true, workId };
    }
  });
  bridge = agentsOn ? makeBridge() : null;
  // Enabling agents for this run: builds the bridge the --agents flag would have built. It
  // starts no session, claims no checkout and activates nothing.
  let enabling = null;
  async function enableAgents({ claude = false } = {}) {
    if (readOnly) throw Object.assign(new Error('This console was started with --read-only.'), { status: 405, code: 'READ_ONLY' });
    if (claude && !claudeIncluded()) throw Object.assign(new Error(CLAUDE_NOT_INCLUDED), { status: 409, code: 'CLAUDE_NOT_INCLUDED' });
    if (agentsOn && bridge) {
      // Agents already on (PF-0069): Claude can still be added for every project, no restart.
      if (claude && !claudeOn) {
        claudeOn = true;
        bridge.claudeEnabled = true;
        for (const project of projects) await bridge.enableClaude(project.id);
        api.agents = { enabled: true, claude: true };
        return { enabled: true, claude: true, already: false };
      }
      return { enabled: true, claude: claudeOn, already: true };
    }
    enabling ??= (async () => {
      // Claude Code only when the developer chose it explicitly in this request (PF-0060).
      const next = makeBridge({ claude });
      try {
        await next.open();
      } catch (error) {
        // A partly opened bridge must not leave checkout locks or bridge files behind.
        await next.close().catch(() => {});
        throw error;
      }
      bridge = next;
      // A project registered while the bridge was being built is added now.
      for (const project of projects) await next.addProject(project);
      agentsOn = true;
      claudeOn = claude;
      api.agents = { enabled: true, claude };
      const message = `data: ${JSON.stringify({ type: 'agents', enabled: true, claude, at: new Date().toISOString() })}\n\n`;
      for (const client of clients) client.write(message);
    })().finally(() => { enabling = null; });
    await enabling;
    return { enabled: true, claude: claudeOn, already: false };
  }
  const api = {
    url: `http://127.0.0.1:${listening.port}/`,
    port: listening.port,
    token,
    projects,
    watchModes: watchers.map((entry) => entry.mode),
    agents: { enabled: agentsOn, claude: claudeOn },
    // Resolves to the agent sessions whose processes could not all be ended (empty when
    // everything stopped), so the caller can say so instead of claiming a clean stop.
    async close() {
      const incomplete = (await bridge?.close()) ?? [];
      clearInterval(heartbeat);
      for (const watcher of watchers) watcher.close();
      for (const client of clients) client.end();
      await new Promise((resolve) => server.close(resolve));
      return incomplete;
    }
  };
  try {
    await bridge?.open();
  } catch (error) {
    // For example a symbolic link where the bridge file goes: nothing is left listening.
    await api.close().catch(() => {});
    server.closeAllConnections?.();
    throw error;
  }
  return api;
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
