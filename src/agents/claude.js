// Claude Code link (v1.3.0, experimental). The user starts their own unmodified Claude
// Code with the YallaFlow channel (resources/agents/claude-channel.mjs) and hook
// forwarder; both dial this console over localhost with the per-project bridge token.
// YallaFlow never starts, stops, or authenticates Claude Code.
// - Messages go in as channel events; replies come back through the channel's reply tool.
// - Permission prompts are relayed; Claude Code applies the first answer it receives
//   (terminal or console). A console request is tied to the tool call whose PreToolUse hook
//   preceded it; when that call runs (PostToolUse), an open request is closed as answered in
//   Claude Code, and a console deny is reported as overridden there. Without that tie the
//   console claims nothing.
// - Claude Code's bypassPermissions mode is never served: messages are refused (bridge) and
//   the panel says why.
import { agentEvent, isForbiddenMode } from './events.js';

const short = (value, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const REQUEST_ID = /^[a-km-z]{5}$/;

export class ClaudeLink {
  constructor({ emit, askPermission, settleElsewhere = () => false, onDisconnect = () => {} }) {
    this.emit = emit;
    this.askPermission = askPermission;
    this.settleElsewhere = settleElsewhere;
    this.onDisconnect = onDisconnect;
    this.stream = null; // the channel server's open response (SSE)
    this.outbox = [];
    this.connected = false;
    this.channel = null;
    this.sessionId = null;
    this.permissionMode = null;
    this.status = 'waiting';
    this.chat = 0;
    this.running = new Map(); // tool_use_id → tool name: PreToolUse seen, PostToolUse not yet
    this.boundSession = null; // hooks are accepted from one Claude Code session per channel
    this.denied = new Map(); // tool_use_id → console request id denied for that call
    this.lastHookAt = null;
  }

  streamBusy() {
    return Boolean(this.stream && !this.stream.destroyed && !this.stream.writableEnded);
  }

  // One channel at a time: a second stream is refused while the first is attached, so
  // another process holding the bridge token can't take over a live session.
  attachStream(response, info) {
    if (this.streamBusy()) return false;
    this.stream = response;
    this.connected = true;
    this.channel = { version: short(info?.version, 40) || null, pid: Number.isInteger(info?.pid) ? info.pid : null };
    this.status = 'connected';
    this.emit(agentEvent('session.connected', { provider: 'claude' }));
    for (const item of this.outbox.splice(0)) this.push(item);
    response.on('close', () => {
      if (this.stream !== response) return;
      this.stream = null;
      this.connected = false;
      this.status = 'disconnected';
      this.outbox.length = 0; // nothing queued for a session that left is delivered to the next one
      this.running.clear();
      this.boundSession = null;
      this.permissionMode = null;
      this.denied.clear();
      this.onDisconnect();
      this.emit(agentEvent('session.disconnected', { provider: 'claude', detail: 'The Claude Code session or its channel stopped.' }));
    });
    return true;
  }

  push(item) {
    if (!this.stream) {
      this.outbox.push(item);
      return false;
    }
    this.stream.write(`data: ${JSON.stringify(item)}\n\n`);
    return true;
  }

  send(text, workId) {
    if (!this.connected) throw Object.assign(new Error('No Claude Code session is connected.'), { code: 'NOT_CONNECTED' });
    const chatId = String(++this.chat);
    this.push({ type: 'message', content: text, meta: { chat_id: chatId, ...(workId ? { work_id: workId } : {}) } });
    this.emit(agentEvent('message.sent', { role: 'user', text, chatId }));
    this.status = 'working';
    return chatId;
  }

  // From the channel server.
  async onChannelEvent(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return;
    if (body.type === 'reply') {
      this.emit(agentEvent('message.done', { role: 'agent', text: String(body.text ?? '').slice(0, 20_000), chatId: short(body.chat_id, 20) }));
      return;
    }
    if (body.type === 'permission_request') {
      const requestId = String(body.request_id ?? '');
      if (!REQUEST_ID.test(requestId)) return;
      // One prompt per request id, and a bounded number waiting (security review, PF-0060).
      this.asking ??= new Set();
      if (this.asking.has(requestId) || this.asking.size >= 20) return;
      this.asking.add(requestId);
      try { await this.relayPermission(body, requestId); } finally { this.asking.delete(requestId); }
    }
  }

  async relayPermission(body, requestId) {
    {
      const tool = short(body.tool_name, 80);
      // Tied to a call only when exactly one call of this tool is waiting; otherwise ambiguous,
      // and the console claims nothing about what happened to it.
      const waiting = [...this.running].filter(([, name]) => name === tool).map(([id]) => id);
      const toolUseId = waiting.length === 1 ? waiting[0] : null;
      const stream = this.stream;
      let consoleId = null;
      const decision = await this.askPermission({
        onOpened: (id) => { consoleId = id; },
        title: `${tool}: ${short(body.description, 200)}`,
        detail: short(body.input_preview, 600),
        kind: tool,
        options: ['allow_once', 'reject_once'],
        provider: 'claude',
        externalKey: toolUseId ? `tool:${toolUseId}` : null
      });
      if (decision === 'elsewhere') return; // Claude Code already ran it on an answer given there
      // A verdict is only for the channel that asked; never replay it to a later session.
      if (!stream || this.stream !== stream) {
        this.emit(agentEvent('notice', { text: 'Your answer was not delivered: the Claude Code channel is no longer connected. Answer in Claude Code.' }));
        return;
      }
      const behavior = decision === 'allow' ? 'allow' : 'deny';
      if (behavior === 'deny' && toolUseId && consoleId) this.denied.set(toolUseId, consoleId);
      this.push({ type: 'verdict', request_id: requestId, behavior });
    }
  }

  // From the hook forwarder: activity, mode, and the final assistant message.
  onHook(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return;
    const session = typeof body.session_id === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(body.session_id) ? body.session_id : null;
    if (!session) return;
    // The first session seen is the one linked; hooks of any other Claude Code session in
    // this folder (for example a second launch whose channel was refused) are ignored.
    if (!this.boundSession) this.boundSession = session;
    else if (session !== this.boundSession) return;
    this.lastHookAt = Date.now();
    this.sessionId = session;
    if (typeof body.permission_mode === 'string') {
      const mode = short(body.permission_mode, 30);
      if (mode !== this.permissionMode) {
        this.permissionMode = mode;
        this.emit(agentEvent('mode.changed', { mode, ...(isForbiddenMode(mode) ? { forbidden: true } : {}) }));
      }
    }
    const tool = short(body.tool_name, 80);
    const toolUseId = short(body.tool_use_id, 80);
    switch (body.hook_event_name) {
      case 'UserPromptSubmit':
        this.status = 'working';
        this.emit(agentEvent('turn.started', {}));
        break;
      case 'PreToolUse':
        if (toolUseId) this.running.set(toolUseId, tool);
        if (this.running.size > 200) this.running.delete(this.running.keys().next().value);
        this.emit(agentEvent('tool.started', { toolCallId: toolUseId, kind: tool, title: `${tool}${body.summary ? `: ${short(body.summary, 160)}` : ''}`, status: 'in_progress' }));
        break;
      case 'PostToolUse': {
        this.emit(agentEvent('tool.updated', { toolCallId: toolUseId, status: 'completed' }));
        if (!toolUseId) break;
        this.running.delete(toolUseId);
        // Still open in the console: it was answered in Claude Code.
        this.settleElsewhere(`tool:${toolUseId}`);
        const denied = this.denied.get(toolUseId);
        if (denied) {
          this.denied.delete(toolUseId);
          this.emit(agentEvent('permission.overridden', { requestId: denied, detail: `${tool} ran anyway: the request was answered in Claude Code, not by YallaFlow.` }));
        }
        break;
      }
      case 'Notification':
        if (body.notification_type === 'permission_prompt') this.emit(agentEvent('notice', { text: short(body.message, 200) }));
        break;
      case 'Stop':
        this.status = 'connected';
        this.running.clear();
        this.denied.clear();
        this.emit(agentEvent('turn.ended', { stopReason: 'end_turn', ...(body.last_assistant_message ? { finalMessage: String(body.last_assistant_message).slice(0, 20_000) } : {}) }));
        break;
      default:
        break;
    }
  }

  detach() {
    if (this.stream) {
      try { this.stream.end(); } catch { /* closed */ }
    }
    this.stream = null;
    this.connected = false;
  }
}
