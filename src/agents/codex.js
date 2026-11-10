// Managed Codex session (v1.3.0) through the user-installed ACP adapter `codex-acp`,
// which runs the user's own `codex app-server` with the user's own ChatGPT login.
// - The adapter environment never carries API keys, so no API billing can happen silently.
// - A session starts only when the adapter reports a ChatGPT account login.
// - Only modes that keep approvals are selected; full-access modes are refused.
import { AcpConnection } from './acp.js';
import { agentEvent, fromAcpUpdate, isForbiddenMode, permissionOptions } from './events.js';

const STRIPPED_ENV = ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORG_ID', 'OPENAI_PROJECT_ID'];
export const DEFAULT_CODEX_MODE = 'workspace-write';
const AUTH_WAIT_MS = 15_000;

// "Allow for session" selects only options the adapter scopes to the running session
// (codex-acp 2.5.0 ids). Options of the same ACP kind that persist beyond it are never
// chosen: `accept_execpolicy_amendment` (adds a Codex rule for a command prefix),
// `apply_network_policy_amendment:*` (a host rule for the future), MCP `allow_always`.
export const SESSION_SCOPED_OPTIONS = Object.freeze(['allow_for_session', 'allow_permissions_session', 'allow_session']);

// The provider option for a console decision, or null (the request is then cancelled,
// which ACP treats as a refusal). Deny never picks a persistent `reject_always`.
export function optionFor(decision, options) {
  if (decision === 'allow') return options.find((option) => option.kind === 'allow_once') ?? null;
  if (decision === 'allow_session') return options.find((option) => option.kind === 'allow_always' && SESSION_SCOPED_OPTIONS.includes(option.id)) ?? null;
  return options.find((option) => option.kind === 'reject_once') ?? null;
}

// PF-0112: the files and the command an ACP tool call names, when the adapter sends them
// (`locations`, diff `content`, `rawInput`). Shown on the approval card only.
export function toolScope(toolCall = {}) {
  const paths = [];
  for (const location of Array.isArray(toolCall?.locations) ? toolCall.locations : []) if (typeof location?.path === 'string') paths.push(location.path);
  for (const item of Array.isArray(toolCall?.content) ? toolCall.content : []) if (item?.type === 'diff' && typeof item.path === 'string') paths.push(item.path);
  const input = toolCall?.rawInput;
  let command = null;
  if (input && typeof input === 'object') {
    // Each argument stays recognisable: quoted when it holds spaces or shell characters (review L9).
    if (Array.isArray(input.command)) command = input.command.filter((part) => typeof part === 'string').map((part) => (/^[A-Za-z0-9_./=:@%+,-]+$/.test(part) ? part : JSON.stringify(part))).join(' ');
    else if (typeof input.command === 'string') command = input.command;
    for (const key of ['path', 'file_path', 'filePath']) if (typeof input[key] === 'string') paths.push(input[key]);
  }
  return { ...(paths.length ? { paths } : {}), ...(command ? { command } : {}) };
}

export function adapterEnvironment(env, codexPath) {
  const clean = { ...env };
  for (const name of STRIPPED_ENV) delete clean[name];
  if (codexPath) clean.CODEX_PATH = codexPath;
  return clean;
}

export class CodexSession {
  // emit(event) delivers agent-event/1; askPermission(request) → Promise<'allow'|'allow_session'|'deny'>
  constructor({ root, detection, emit, askPermission, env = process.env, nodePath = process.execPath }) {
    this.root = root;
    this.detection = detection;
    this.emit = emit;
    this.askPermission = askPermission;
    this.env = env;
    this.nodePath = nodePath;
    this.conn = null;
    this.sessionId = null;
    this.mode = null;
    this.status = 'idle';
    this.auth = null;
    this.ending = false;
    this.toolTitles = new Map(); // toolCallId → what the tool does (shown on permission cards)
  }

  spawnAdapter() {
    const adapter = this.detection.adapter.path;
    const env = adapterEnvironment(this.env, this.detection.codex?.path);
    let authResolve;
    this.authReport = new Promise((resolve) => { authResolve = resolve; });
    this.conn = new AcpConnection(adapter, [], {
      cwd: this.root,
      env,
      onNotification: (method, params) => this.onNotification(method, params, authResolve),
      onRequest: (method, params) => this.onRequest(method, params)
    });
    const conn = this.conn;
    conn.exited.then(async ({ code, signal }) => {
      if (this.ending) return;
      this.status = 'ended';
      // The adapter is gone; whatever it started is ended too before the console reports it.
      const cleanup = await conn.cleanup();
      this.emit(agentEvent('session.ended', { reason: 'crashed', detail: `adapter exited (${signal ?? code})`, resumable: Boolean(this.sessionId), cleanup }));
    });
  }

  onNotification(method, params, authResolve) {
    if (method === '_auth/status_update') {
      const status = params?.authStatus ?? {};
      // Only the kind and the plan label are kept; account identity is discarded.
      authResolve({ kind: status.kind ?? null, label: typeof status.label === 'string' ? status.label : null });
      return;
    }
    if (method !== 'session/update') return;
    const event = fromAcpUpdate(params);
    if (event) {
      if (event.type === 'mode.changed') this.mode = event.mode;
      if (event.type === 'tool.started' || event.type === 'tool.updated') this.conn?.remember(); // see what a command started, early
      if (event.type === 'tool.started' && event.toolCallId) {
        this.toolTitles.set(event.toolCallId, event.title);
        if (this.toolTitles.size > 200) this.toolTitles.delete(this.toolTitles.keys().next().value);
      }
      this.emit(event);
    }
  }

  async onRequest(method, params) {
    if (method !== 'session/request_permission') throw Object.assign(new Error(`${method} is not supported by YallaFlow`), { code: -32601 });
    const options = permissionOptions(params.options);
    const toolCallId = String(params.toolCall?.toolCallId ?? '');
    const title = String(params.toolCall?.title ?? 'Tool call').slice(0, 300);
    const described = this.toolTitles.get(toolCallId);
    const offered = ['allow', 'allow_session'].filter((decision) => optionFor(decision, options));
    const decision = await this.askPermission({
      title,
      detail: described && described !== title ? described : null,
      kind: params.toolCall?.kind ?? 'other',
      toolCallId: String(params.toolCall?.toolCallId ?? ''),
      allow: offered,
      ...toolScope(params.toolCall)
    });
    const option = optionFor(decision, options);
    return option ? { outcome: { outcome: 'selected', optionId: option.id } } : { outcome: { outcome: 'cancelled' } };
  }

  async handshake() {
    const init = await this.conn.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'yallaflow', title: 'YallaFlow', version: '1.3.0' }
    }, 60_000);
    let timer;
    const auth = await Promise.race([this.authReport, new Promise((resolve) => { timer = setTimeout(() => resolve(null), AUTH_WAIT_MS); })]);
    clearTimeout(timer); // never keep the process alive for the wait
    this.auth = auth;
    if (!auth || auth.kind !== 'account') {
      throw Object.assign(new Error('Codex is not signed in with a ChatGPT account. YallaFlow uses only your ChatGPT subscription login: run `codex login` (ChatGPT) and try again.'), { code: 'SUBSCRIPTION_REQUIRED' });
    }
    return init;
  }

  // Always called on start and resume, so the session never keeps a mode YallaFlow did not choose.
  async setMode(mode) {
    if (typeof mode !== 'string' || !mode) throw Object.assign(new Error('A permission mode is required.'), { code: 'MODE_FORBIDDEN' });
    if (isForbiddenMode(mode)) throw Object.assign(new Error(`Mode ${mode} is never used by YallaFlow.`), { code: 'MODE_FORBIDDEN' });
    if (!this.availableModes?.includes(mode)) throw Object.assign(new Error(`Codex does not offer mode ${mode}.`), { code: 'MODE_UNAVAILABLE' });
    await this.conn.request('session/set_mode', { sessionId: this.sessionId, modeId: mode }, 30_000);
    this.mode = mode;
  }

  safeModes(modes) {
    return (modes?.availableModes ?? []).map((entry) => String(entry.id)).filter((id) => !isForbiddenMode(id));
  }

  async start({ mode = DEFAULT_CODEX_MODE } = {}) {
    this.status = 'starting';
    this.spawnAdapter();
    try {
      await this.handshake();
      const created = await this.conn.request('session/new', { cwd: this.root, mcpServers: [] }, 90_000);
      this.sessionId = String(created.sessionId);
      this.availableModes = this.safeModes(created.modes);
      await this.setMode(mode);
      this.status = 'idle';
      return { sessionId: this.sessionId, mode: this.mode, modes: this.availableModes, auth: this.auth };
    } catch (error) {
      this.ending = true;
      this.cleanup = await this.conn.close();
      this.status = 'ended';
      throw error;
    }
  }

  async resume(sessionId, { mode = DEFAULT_CODEX_MODE } = {}) {
    if (!/^[A-Za-z0-9-]{8,80}$/.test(String(sessionId))) throw Object.assign(new Error('Invalid session id.'), { code: 'BAD_SESSION' });
    this.status = 'starting';
    this.spawnAdapter();
    try {
      const init = await this.handshake();
      const caps = init.agentCapabilities?.sessionCapabilities ?? {};
      const method = caps.resume ? 'session/resume' : init.agentCapabilities?.loadSession ? 'session/load' : null;
      if (!method) throw Object.assign(new Error('This Codex adapter cannot resume sessions.'), { code: 'RESUME_UNSUPPORTED' });
      const resumed = await this.conn.request(method, { sessionId, cwd: this.root, mcpServers: [] }, 90_000);
      this.sessionId = String(sessionId);
      this.availableModes = this.safeModes(resumed?.modes);
      await this.setMode(mode);
      this.status = 'idle';
      return { sessionId: this.sessionId, mode: this.mode, modes: this.availableModes, auth: this.auth };
    } catch (error) {
      this.ending = true;
      this.cleanup = await this.conn.close();
      this.status = 'ended';
      throw error;
    }
  }

  async prompt(text) {
    if (this.status !== 'idle') throw Object.assign(new Error(this.status === 'working' ? 'Codex is still working on the previous message.' : 'The session is not running.'), { code: 'SESSION_BUSY' });
    this.status = 'working';
    this.emit(agentEvent('turn.started', {}));
    try {
      const result = await this.conn.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text }] }, 0);
      this.status = 'idle';
      this.emit(agentEvent('turn.ended', { stopReason: result?.stopReason ?? 'end_turn' }));
    } catch (error) {
      if (this.status === 'working') this.status = this.conn.closed ? 'ended' : 'idle';
      if (!this.conn.closed) this.emit(agentEvent('error', { code: error.code ?? 'AGENT_ERROR', message: String(error.message).slice(0, 300) }));
      // The turn is over even when it failed (for example a usage limit): say so, so the
      // console never keeps showing "Working…" for a turn that ended (PF-0059).
      this.emit(agentEvent('turn.ended', { stopReason: 'error' }));
    }
  }

  cancel() {
    if (this.status !== 'working') return false;
    this.conn.notify('session/cancel', { sessionId: this.sessionId });
    return true;
  }

  // Returns the process cleanup result ({ complete, verified, survivors }).
  async end() {
    this.ending = true;
    if (this.conn) this.cleanup = await this.conn.close();
    this.status = 'ended';
    return this.cleanup ?? { complete: true, verified: true, survivors: [] };
  }
}
