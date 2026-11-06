// Agent Bridge (v1.3.0): the console's thin layer between the browser and agent sessions.
// - One managed session per checkout (project root), whatever the provider or work item.
// - Permission requests wait for the user; unanswered ones are denied after a timeout.
// - Session records and permission decisions live in .yallaflow/local/agent-sessions/
//   (git-ignored). Transcripts stay with the provider; credentials are never touched.
// - It never activates work, approves gates, or writes .yallaflow outside local/.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { safeAppendFile, safeLocalDir, safeRemove, safeWriteFile } from './local-files.js';
import { CodexSession, DEFAULT_CODEX_MODE } from './codex.js';
import { loadClaude } from './experimental.js';
import { CAPABILITIES, agentEvent, isForbiddenMode } from './events.js';
import { detectProviders } from './detect.js';
import { acquireCheckoutLock, lockedError, readCheckoutLock } from './checkout-lock.js';

const RECORD_ID = /^[0-9a-f]{12}$/;
const MAX_EVENTS = 400;
export const DEFAULT_PERMISSION_TIMEOUT_MS = 5 * 60_000;

function localDir(root) {
  return path.join(root, '.yallaflow', 'local');
}

// .yallaflow/local is personal runtime state; make sure Git ignores it in any workspace.
// Symbolic links on the way are refused (see local-files.js).
export async function ensureLocalIgnored(root) {
  const dir = await safeLocalDir(root, '.yallaflow', 'local');
  try {
    await readFile(path.join(dir, '.gitignore'), 'utf8');
  } catch {
    await safeWriteFile(dir, '.gitignore', '*\n', 0o644);
  }
  return dir;
}

const sameToken = (given, expected) => {
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
};
const conflict = (message) => Object.assign(new Error(message), { status: 409, code: 'SESSION_ACTIVE' });

export function bridgeFile(root) {
  return path.join(localDir(root), 'agent-bridge.json');
}

export class AgentBridge {
  constructor({ projects, broadcast, claude = false, env = process.env, runActivate, permissionTimeoutMs, port }) {
    this.env = env;
    this.claudeEnabled = claude;
    this.broadcast = broadcast;
    this.runActivate = runActivate;
    this.port = port;
    this.timeoutMs = permissionTimeoutMs ?? (Number(env.YALLAFLOW_AGENT_PERMISSION_TIMEOUT_MS) || DEFAULT_PERMISSION_TIMEOUT_MS);
    this.projects = new Map(projects.map((project) => [project.id, {
      ...project,
      session: null, // { provider, record, impl }
      pending: new Map(),
      events: [],
      claude: null,
      bridgeToken: claude ? randomBytes(24).toString('hex') : null,
      owner: null, // the checkout lock while this console holds it
      holder: null // who holds it when another console does
    }]));
  }

  // ----- lifecycle -----
  async open() {
    // Development builds only: the Claude connection is loaded on demand (see experimental.js).
    if (this.claudeEnabled) this.ClaudeLink = (await loadClaude()).ClaudeLink;
    // Opening the console writes nothing into a project: the checkout is claimed only when
    // a session starts (or, in development builds, for the Claude bridge file).
    for (const project of this.projects.values()) {
      if (!this.claudeEnabled) continue;
      await ensureLocalIgnored(project.root);
      project.claude = this.newClaudeLink(project);
      await this.claimCheckout(project);
    }
  }

  // One agent console per checkout, across processes. A checkout another live console owns
  // is retried on every action, so it frees up as soon as that console stops.
  claimCheckout(project) {
    // One claim at a time per project: overlapping claims in this process would otherwise
    // see this console's own new lock and report it as another console's.
    project.claiming ??= this.claimNow(project).finally(() => { project.claiming = null; });
    return project.claiming;
  }

  async claimNow(project) {
    if (project.owner) {
      // Still ours? The file may have been removed (git clean, rm) or taken over.
      const current = await readCheckoutLock(project.root).catch(() => null);
      if (current?.nonce === project.owner.nonce) return true;
      if (current && !current.stale) {
        project.owner = null;
        project.holder = current;
        return false;
      }
      project.owner = null; // gone or stale: claim it again below
    }
    const result = await acquireCheckoutLock(project.root, { port: this.port });
    if (!result.acquired) {
      project.holder = result.holder;
      return false;
    }
    project.owner = result;
    project.holder = null;
    // Only the owner publishes the Claude bridge file, so it is never overwritten by
    // another console.
    if (this.claudeEnabled) {
      await safeWriteFile(await ensureLocalIgnored(project.root), 'agent-bridge.json', JSON.stringify({ port: this.port, token: project.bridgeToken, pid: process.pid }));
    }
    return true;
  }

  async ensureOwner(project) {
    if (!(await this.claimCheckout(project))) throw lockedError(project.holder);
  }

  // → [{ project, cleanup }] for sessions whose processes could not all be ended.
  async close() {
    const incomplete = [];
    for (const project of this.projects.values()) {
      this.denyPending(project, null, 'shutdown');
      let cleanup = null;
      if (project.session?.starting) cleanup = await this.stopStarting(project, 'console stopped');
      else if (project.session?.provider === 'codex' && project.session.impl) cleanup = await this.finishCodex(project, 'console stopped');
      if (cleanup && !cleanup.complete) incomplete.push({ project: project.name ?? project.root, cleanup });
      project.claude?.detach();
      if (project.owner) {
        if (this.claudeEnabled) await safeRemove(localDir(project.root), 'agent-bridge.json').catch(() => {});
        await project.owner.release();
        project.owner = null;
      }
    }
    return incomplete;
  }

  project(id) {
    const project = this.projects.get(id);
    if (!project) throw Object.assign(new Error('Unknown project.'), { status: 404, code: 'NOT_FOUND' });
    return project;
  }

  projectByBridgeToken(token) {
    for (const project of this.projects.values()) if (project.bridgeToken && sameToken(token, project.bridgeToken)) return project;
    return null;
  }

  emit(project, event) {
    project.events.push(event);
    if (project.events.length > MAX_EVENTS) project.events.splice(0, project.events.length - MAX_EVENTS);
    this.broadcast(project.id, event);
  }

  // ----- permissions -----
  askPermission(project, request) {
    const requestId = randomBytes(6).toString('hex');
    // Only what the provider offers; "allow_session" only where the provider scopes it to
    // the running session (see codex.js). YallaFlow keeps no decision for later reuse.
    const decisions = [...(request.allow ?? ['allow']).filter((decision) => ['allow', 'allow_session'].includes(decision)), 'deny'];
    return new Promise((resolve) => {
      const entry = {
        request: { requestId, title: request.title, detail: request.detail ?? null, kind: request.kind, decisions, provider: request.provider ?? project.session?.provider ?? null },
        externalKey: request.externalKey ?? null,
        decide: (decision, by) => {
          if (!project.pending.has(requestId)) return false;
          project.pending.delete(requestId);
          clearTimeout(entry.timer);
          this.recordDecision(project, entry.request, decision, by);
          this.emit(project, agentEvent('permission.resolved', { requestId, decision, by }));
          resolve(decision);
          return true;
        }
      };
      entry.timer = setTimeout(() => entry.decide('deny', 'timeout'), this.timeoutMs);
      entry.timer.unref?.();
      project.pending.set(requestId, entry);
      request.onOpened?.(requestId);
      this.emit(project, agentEvent('permission.requested', { ...entry.request, expiresAt: new Date(Date.now() + this.timeoutMs).toISOString() }));
    });
  }

  // The provider applied an answer given outside the console (for example in the Claude Code
  // terminal). The open console request is closed as answered there; YallaFlow claims nothing.
  settleElsewhere(project, externalKey) {
    for (const entry of project.pending.values()) {
      if (externalKey && entry.externalKey === externalKey) return entry.decide('elsewhere', 'provider');
    }
    return false;
  }

  denyPending(project, provider, by) {
    for (const entry of [...project.pending.values()]) if (!provider || entry.request.provider === provider) entry.decide('deny', by);
  }

  answerPermission(projectId, requestId, decision) {
    const project = this.project(projectId);
    const entry = project.pending.get(String(requestId));
    if (!entry) throw Object.assign(new Error('This permission request is no longer open.'), { status: 409, code: 'NOT_PENDING' });
    if (!entry.request.decisions.includes(decision)) throw Object.assign(new Error(`Decision ${decision} is not available for this request.`), { status: 400, code: 'BAD_DECISION' });
    entry.decide(decision, 'user');
    return { ok: true };
  }

  // ----- records (local, git-ignored) -----
  async recordsDir(project) {
    await ensureLocalIgnored(project.root);
    return safeLocalDir(project.root, '.yallaflow', 'local', 'agent-sessions');
  }

  async saveRecord(project, record) {
    if (!RECORD_ID.test(String(record.id))) throw new Error('Invalid session record id.');
    await safeWriteFile(await this.recordsDir(project), `${record.id}.json`, JSON.stringify(record, null, 1));
  }

  async recordDecision(project, request, decision, by) {
    try {
      const dir = await this.recordsDir(project);
      const line = { at: new Date().toISOString(), session: project.session?.record?.id ?? null, provider: request.provider, title: request.title, decision, by };
      await safeAppendFile(dir, 'decisions.jsonl', `${JSON.stringify(line)}\n`);
    } catch {
      // the decision itself still applies; the log is best-effort
    }
  }

  // Read-only: viewing the panel never creates anything in the project. A records folder
  // that is a symbolic link is ignored.
  async listRecords(project) {
    const dir = path.join(localDir(project.root), 'agent-sessions');
    let names = [];
    try {
      if (!(await lstat(dir)).isDirectory()) return [];
      names = await readdir(dir);
    } catch {
      return [];
    }
    const records = [];
    for (const name of names.filter((entry) => /^[0-9a-f]{12}\.json$/.test(entry))) {
      try {
        records.push(JSON.parse(await readFile(path.join(dir, name), 'utf8')));
      } catch {
        // an unreadable record is skipped
      }
    }
    return records.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  }

  // ----- status -----
  async status(projectId) {
    const project = this.project(projectId);
    const detected = await detectProviders({ env: this.env, claude: this.claudeEnabled });
    const providers = [{ id: 'codex', label: 'Codex', ready: detected.codex.ready, problems: detected.codex.problems, versions: { codex: detected.codex.codex?.version ?? null, adapter: detected.codex.adapter?.version ?? null }, capabilities: CAPABILITIES.codex }];
    if (this.claudeEnabled) providers.push({ id: 'claude', label: 'Claude Code', experimental: true, ready: detected.claude.ready, problems: detected.claude.problems, versions: { claude: detected.claude.claude?.version ?? null }, auth: detected.claude.auth ? { method: detected.claude.auth.method, plan: detected.claude.auth.plan } : null, capabilities: CAPABILITIES.claude });
    const records = await this.listRecords(project);
    // Read-only: another live console's lock is reported; nothing is claimed here.
    const holder = project.owner ? null : await readCheckoutLock(project.root).catch(() => null);
    const foreign = holder && !holder.stale && holder.nonce !== project.owner?.nonce;
    return {
      enabled: true,
      lockedBy: foreign ? { message: lockedError(holder).message } : null,
      claudeExperimental: this.claudeEnabled,
      permissionTimeoutMs: this.timeoutMs,
      providers,
      session: this.sessionSummary(project),
      pending: [...project.pending.values()].map((entry) => entry.request),
      resumable: records.filter((record) => record.provider === 'codex' && record.resumable && record.status !== 'running').slice(0, 5).map((record) => ({ id: record.id, workId: record.workId, startedAt: record.startedAt, endedAt: record.endedAt })),
      events: project.events.slice(-200)
    };
  }

  sessionSummary(project) {
    const session = project.session;
    if (session?.starting) return { provider: session.provider, ownership: 'managed', workId: session.record.workId, status: 'starting', mode: null, modes: [], auth: null, connected: false, recordId: session.record.id, startedAt: session.record.startedAt };
    if (session) {
      return {
        provider: session.provider,
        ownership: CAPABILITIES[session.provider].ownership,
        workId: session.record.workId,
        status: session.impl.status,
        mode: session.provider === 'codex' ? session.impl.mode : project.claude?.permissionMode ?? null,
        modes: session.provider === 'codex' ? session.impl.availableModes ?? [] : [],
        auth: session.provider === 'codex' ? (session.impl.auth?.label ?? null) : null,
        connected: session.provider === 'claude' ? project.claude.connected : true,
        recordId: session.record.id,
        startedAt: session.record.startedAt
      };
    }
    if (project.claude?.connected) return { provider: 'claude', ownership: 'user-session', workId: null, status: 'connected', mode: project.claude.permissionMode, connected: true, recordId: null };
    return null;
  }

  // ----- one session per checkout -----
  assertFree(project, provider) {
    if (project.session) throw Object.assign(new Error(`A ${project.session.provider === 'codex' ? 'Codex' : 'Claude Code'} session is already active in this checkout (${project.session.record.workId ?? 'no work item'}). End it first.`), { status: 409, code: 'SESSION_ACTIVE' });
    if (provider === 'codex' && project.claude?.connected) throw Object.assign(new Error('A Claude Code session is connected to this checkout. Close it in your terminal first.'), { status: 409, code: 'SESSION_ACTIVE' });
  }

  // Only the modes YallaFlow offers; an empty, unknown, or full-access mode is refused.
  checkCodexMode(mode) {
    if (typeof mode !== 'string' || isForbiddenMode(mode) || !CAPABILITIES.codex.modes.includes(mode)) {
      throw Object.assign(new Error(`Mode ${mode || '(none)'} is not available in YallaFlow. Choose ${CAPABILITIES.codex.modes.join(' or ')}.`), { status: 400, code: 'MODE_FORBIDDEN' });
    }
  }

  // The checkout's one session slot is taken synchronously, before any await, so two
  // concurrent start/resume requests can never both pass the check.
  reserve(project, record) {
    this.assertFree(project, 'codex');
    const slot = { provider: 'codex', record, impl: null, starting: true, cancelled: false };
    project.session = slot;
    return slot;
  }

  release(project, slot) {
    if (project.session === slot) project.session = null;
  }

  async launch(project, slot, run) {
    try {
      const detected = (await detectProviders({ env: this.env, claude: this.claudeEnabled })).codex;
      if (!detected.ready) throw Object.assign(new Error(detected.problems.join(' ')), { status: 422, code: 'PROVIDER_UNAVAILABLE' });
      if (slot.cancelled) throw Object.assign(new Error('The console stopped before the session started.'), { status: 409, code: 'CANCELLED' });
      slot.impl = this.newCodex(project, detected);
      const result = await run(slot.impl);
      if (slot.cancelled || project.session !== slot) {
        await slot.impl.end();
        throw Object.assign(new Error('The session was stopped while it was starting.'), { status: 409, code: 'CANCELLED' });
      }
      slot.starting = false;
      return result;
    } catch (caught) {
      // Stopped while starting (End, console stop): say so, not the adapter's exit error.
      const error = slot.cancelled && caught.code !== 'CANCELLED' ? Object.assign(new Error('The session was stopped while it was starting.'), { status: 409, code: 'CANCELLED' }) : caught;
      if (slot.impl && slot.impl.status !== 'ended') await slot.impl.end().catch(() => {});
      this.release(project, slot);
      throw Object.assign(error, { status: error.status ?? (error.code === 'SUBSCRIPTION_REQUIRED' ? 422 : error.code === 'MODE_FORBIDDEN' || error.code === 'MODE_UNAVAILABLE' ? 400 : 502) });
    }
  }

  // A started session whose record can't be written is ended, so the slot never stays
  // taken by a session the caller was told failed.
  async saveOrAbandon(project, slot, record) {
    try {
      await this.saveRecord(project, record);
    } catch (error) {
      await slot.impl.end().catch(() => {});
      this.release(project, slot);
      throw Object.assign(error, { status: 500, code: error.code ?? 'RECORD_FAILED' });
    }
  }

  async startCodex(projectId, { workId, mode = DEFAULT_CODEX_MODE } = {}) {
    const project = this.project(projectId);
    this.checkCodexMode(mode);
    await this.ensureOwner(project);
    const record = { id: randomBytes(6).toString('hex'), provider: 'codex', ownership: 'managed', workId: workId ?? null, startedAt: new Date().toISOString(), endedAt: null, status: 'running', sessionId: null, resumable: false };
    const slot = this.reserve(project, record);
    const started = await this.launch(project, slot, (impl) => impl.start({ mode }));
    record.sessionId = started.sessionId;
    record.resumable = true;
    record.mode = started.mode;
    await this.saveOrAbandon(project, slot, record);
    this.emit(project, agentEvent('session.started', { provider: 'codex', ownership: 'managed', workId: record.workId, mode: started.mode, auth: started.auth?.label ?? null }));
    return this.sessionSummary(project);
  }

  async resumeCodex(projectId, recordId, { mode = DEFAULT_CODEX_MODE } = {}) {
    const project = this.project(projectId);
    if (!RECORD_ID.test(String(recordId))) throw Object.assign(new Error('Invalid session record.'), { status: 400, code: 'BAD_RECORD' });
    this.checkCodexMode(mode);
    await this.ensureOwner(project);
    const placeholder = { id: String(recordId), provider: 'codex', workId: null, startedAt: new Date().toISOString() };
    const slot = this.reserve(project, placeholder);
    let record;
    try {
      record = (await this.listRecords(project)).find((entry) => entry.id === recordId && entry.provider === 'codex');
      if (!record || !record.resumable) throw Object.assign(new Error('This session cannot be resumed.'), { status: 404, code: 'NOT_RESUMABLE' });
    } catch (error) {
      this.release(project, slot);
      throw error;
    }
    slot.record = record;
    const resumed = await this.launch(project, slot, (impl) => impl.resume(record.sessionId, { mode }));
    record.status = 'running';
    record.endedAt = null;
    record.mode = resumed.mode;
    await this.saveOrAbandon(project, slot, record);
    this.emit(project, agentEvent('session.started', { provider: 'codex', ownership: 'managed', workId: record.workId, mode: resumed.mode, resumed: true, auth: resumed.auth?.label ?? null }));
    return this.sessionSummary(project);
  }

  newCodex(project, detection) {
    const impl = new CodexSession({
      root: project.root,
      detection,
      env: this.env,
      emit: (event) => {
        // Events of a session that no longer owns the checkout's slot (a stopped or
        // superseded start) are dropped, and its process is ended.
        const current = project.session?.impl === impl;
        if (!current) {
          if (event.type !== 'session.ended' && impl.status !== 'ended') impl.end().catch(() => {});
          return;
        }
        if (event.type === 'mode.changed' && project.session.starting) return; // replayed history; set_mode follows
        if (event.type === 'mode.changed' && (isForbiddenMode(event.mode) || !CAPABILITIES.codex.modes.includes(event.mode))) {
          this.emit(project, agentEvent('error', { code: 'MODE_FORBIDDEN', message: `Codex switched to ${String(event.mode).slice(0, 40)}, a mode YallaFlow does not use. The session was ended.` }));
          this.finishCodex(project, 'forbidden mode').catch(() => {});
          return;
        }
        this.emit(project, event);
        if (event.type === 'session.ended' && !project.session.starting) this.finishCodex(project, event.reason, true, event.cleanup ?? null);
      },
      askPermission: (request) => this.askPermission(project, { ...request, provider: 'codex' })
    });
    return impl;
  }

  // A session still starting: its adapter is ended now (not after the handshake), and the
  // slot is freed only once that is done, so no second adapter can start meanwhile.
  async stopStarting(project, reason) {
    const slot = project.session;
    slot.cancelled = true;
    const cleanup = slot.impl ? await slot.impl.end().catch(() => null) : { complete: true, verified: true, survivors: [] };
    this.release(project, slot);
    this.emit(project, agentEvent('session.ended', { reason, resumable: false, cleanup }));
    return cleanup;
  }

  // Returns the process cleanup result. A session whose processes could not all be ended
  // is reported as such (never as a clean stop), in the event and in its record.
  async finishCodex(project, reason, crashed = false, crashCleanup = null) {
    const session = project.session;
    if (!session || session.provider !== 'codex' || !session.impl) return null;
    project.session = null;
    this.denyPending(project, 'codex', 'session ended');
    const cleanup = crashed ? crashCleanup : await session.impl.end();
    session.record.status = crashed ? 'crashed' : 'ended';
    session.record.endedAt = new Date().toISOString();
    if (cleanup && !cleanup.complete) session.record.cleanup = { complete: false, survivors: cleanup.survivors };
    // A session that never got an id (it failed during the handshake) leaves no record.
    if (session.record.sessionId) await this.saveRecord(project, session.record).catch(() => {});
    if (!crashed) this.emit(project, agentEvent('session.ended', { reason, resumable: session.record.resumable, cleanup }));
    return cleanup;
  }

  async message(projectId, text) {
    const project = this.project(projectId);
    const value = String(text ?? '').trim();
    if (!value || value.length > 20_000) throw Object.assign(new Error('Write a message of up to 20,000 characters.'), { status: 400, code: 'BAD_MESSAGE' });
    if (project.session?.provider === 'codex') {
      if (!project.session.impl || project.session.impl.status !== 'idle') throw Object.assign(new Error('Codex is still working. Wait, or press Stop.'), { status: 409, code: 'SESSION_BUSY' });
      this.emit(project, agentEvent('message.sent', { role: 'user', text: value }));
      project.session.impl.prompt(value); // runs in the background; events stream to the page
      return { ok: true };
    }
    if (project.claude?.connected) {
      if (!project.claude.permissionMode) throw Object.assign(new Error('Claude Code has not reported its permission mode yet. It does when the session starts or when you type in it; try again in a moment.'), { status: 409, code: 'MODE_UNKNOWN' });
      if (isForbiddenMode(project.claude.permissionMode)) throw Object.assign(new Error(`Claude Code is in ${project.claude.permissionMode} mode, which skips every permission. YallaFlow does not send messages to a session in that mode; change the mode in Claude Code first.`), { status: 409, code: 'MODE_FORBIDDEN' });
      project.claude.send(value, project.session?.record.workId ?? null);
      return { ok: true };
    }
    throw Object.assign(new Error('No agent session is active.'), { status: 409, code: 'NO_SESSION' });
  }

  cancel(projectId) {
    const project = this.project(projectId);
    if (project.session?.provider !== 'codex' || !project.session.impl) throw Object.assign(new Error('Stop is not available for this session.'), { status: 409, code: 'UNSUPPORTED' });
    const sent = project.session.impl.cancel();
    return { ok: sent };
  }

  async end(projectId) {
    const project = this.project(projectId);
    if (project.session?.provider !== 'codex') throw Object.assign(new Error('Ending is done in Claude Code for Claude sessions.'), { status: 409, code: 'UNSUPPORTED' });
    if (project.session.starting) {
      const cleanup = await this.stopStarting(project, 'stopped while starting');
      return { ok: true, cleanup };
    }
    const cleanup = await this.finishCodex(project, 'ended by user');
    return { ok: true, cleanup };
  }

  // Claude: a user-started session joins through the channel; the console records which work
  // item the user is discussing, without activating it.
  async connectClaude(projectId, { workId }) {
    const project = this.project(projectId);
    if (!project.claude) throw Object.assign(new Error('Claude Code sessions are not enabled. Start the console with --agents --experimental-claude.'), { status: 409, code: 'UNSUPPORTED' });
    await this.ensureOwner(project);
    if (project.session) this.assertFree(project, 'claude');
    const record = { id: randomBytes(6).toString('hex'), provider: 'claude', ownership: 'user-session', workId: workId ?? null, startedAt: new Date().toISOString(), endedAt: null, status: 'running', sessionId: null, resumable: false };
    project.session = { provider: 'claude', record, impl: project.claude };
    await this.saveRecord(project, record);
    this.emit(project, agentEvent('session.started', { provider: 'claude', ownership: 'user-session', workId: record.workId }));
    return this.sessionSummary(project);
  }

  async disconnectClaude(projectId) {
    const project = this.project(projectId);
    if (project.session?.provider !== 'claude') throw Object.assign(new Error('No Claude Code session is linked.'), { status: 409, code: 'NO_SESSION' });
    const { record } = project.session;
    project.session = null;
    this.denyPending(project, 'claude', 'unlinked');
    record.status = 'ended';
    record.endedAt = new Date().toISOString();
    await this.saveRecord(project, record);
    this.emit(project, agentEvent('session.ended', { reason: 'unlinked in YallaFlow (Claude Code keeps running)', resumable: false }));
    return { ok: true };
  }

  newClaudeLink(project) {
    return new this.ClaudeLink({
      emit: (event) => this.emit(project, event),
      askPermission: (request) => {
        if (project.session?.provider === 'codex') {
          this.emit(project, agentEvent('notice', { text: 'A Claude Code permission request was denied: a Codex session owns this checkout.' }));
          return Promise.resolve('deny');
        }
        return this.askPermission(project, request);
      },
      settleElsewhere: (key) => this.settleElsewhere(project, key),
      // A dropped channel can't deliver a verdict: its open requests are denied in the console.
      onDisconnect: () => this.denyPending(project, 'claude', 'channel disconnected')
    });
  }

  async activate(projectId, workId) {
    const project = this.project(projectId);
    if (!/^PF-[A-Za-z0-9-]+$/.test(String(workId))) throw Object.assign(new Error('Invalid work item.'), { status: 400, code: 'BAD_WORK' });
    const result = await this.runActivate(project.root, workId);
    this.emit(project, agentEvent('work.activated', { workId }));
    return result;
  }
}
