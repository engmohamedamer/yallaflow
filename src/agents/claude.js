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
// - PF-0145: an open stream proves nothing about delivery (Claude Code drops channel messages
//   without an error when the organization has channels off, and never acknowledges one). Each
//   connection is checked once with a nonce the session must send back; direct messages are
//   sent only after that. Otherwise the console works in Terminal Mode: the developer pastes
//   the message in Claude Code and the hooks show the work. A message's state changes only on
//   evidence that names its chat id.
import { randomBytes } from 'node:crypto';
import { agentEvent, isForbiddenMode } from './events.js';

const short = (value, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const REQUEST_ID = /^[a-km-z]{5}$/;

const CHAT_ID = /^[0-9a-f]{8}$/;
const OWN_TOOL = /^mcp__yallaflow__/;
const RANK = { copied: 0, sending: 0, unconfirmed: 0, received: 1, answered: 2 };

// How long a directly sent message may go without evidence naming it before the console says
// its delivery is unconfirmed (never "dropped": Claude Code may only be busy).
export const DELIVERY_TIMEOUT_MS = Number(process.env.YALLAFLOW_CLAUDE_DELIVERY_TIMEOUT_MS) || 60_000;
// How long the connection check may go unanswered before the console offers Terminal Mode.
export const PROBE_TIMEOUT_MS = Number(process.env.YALLAFLOW_CLAUDE_PROBE_TIMEOUT_MS) || 60_000;
export const PROBE_TEXT = 'YallaFlow connection check. This is not a task: run no commands, read no files and change nothing. Only call the yallaflow reply tool with this chat_id and the text "ok".';

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
    this.channelState = 'none'; // none (no stream) | checking | verified | unverified
    this.probe = null; // { nonce, sent } for the attached stream
    this.chats = new Map(); // chat id → { route: direct|terminal, state, timer }
    this.turnChat = null; // the chat whose marker opened the running turn
    this.hookLive = false; // hooks of the bound session are arriving
    this.running = new Map(); // tool_use_id → tool name: PreToolUse seen, PostToolUse not yet
    this.boundSession = null; // hooks are accepted from one Claude Code session per channel
    this.denied = new Map(); // tool_use_id → console request id denied for that call
    this.lastHookAt = null;
  }

  streamBusy() {
    return Boolean(this.stream && !this.stream.destroyed && !this.stream.writableEnded);
  }

  // Connected: the channel stream is open, or the bound session's hooks are arriving
  // (Terminal Mode needs no channel). Announced once per change.
  refresh() {
    const now = this.streamBusy() || this.hookLive;
    if (now === this.connected) return;
    this.connected = now;
    this.status = now ? 'connected' : 'disconnected';
    this.emit(agentEvent(now ? 'session.connected' : 'session.disconnected', { provider: 'claude' }));
  }

  setChannel(state) {
    if (this.channelState === state) return;
    this.channelState = state;
    this.emit(agentEvent('channel.state', { provider: 'claude', state }));
  }

  // One channel at a time: a second stream is refused while the first is attached, so
  // another process holding the bridge token can't take over a live session.
  attachStream(response, info) {
    if (this.streamBusy()) return false;
    this.stream = response;
    this.channel = { version: short(info?.version, 40) || null, pid: Number.isInteger(info?.pid) ? info.pid : null };
    // A new stream is a new Claude Code process as far as the console can tell: its hooks bind
    // again and its channel is checked again, with a nonce of its own.
    this.boundSession = null;
    this.permissionMode = null;
    this.hookLive = false;
    this.probe = { nonce: randomBytes(8).toString('hex'), sent: false };
    this.refresh();
    this.setChannel('checking');
    this.armProbeTimer();
    response.on('close', () => {
      if (this.stream !== response) return;
      this.stream = null;
      clearTimeout(this.probeTimer);
      this.probe = null;
      this.outbox.length = 0; // nothing queued for a session that left is delivered to the next one
      this.running.clear();
      this.boundSession = null;
      this.permissionMode = null;
      this.hookLive = false;
      this.turnChat = null;
      this.denied.clear();
      // Whatever was still on its way stays unconfirmed; it is never sent again.
      for (const [id, chat] of this.chats) if (chat.state === 'sending') this.markChat(id, 'unconfirmed');
      this.onDisconnect();
      this.setChannel('none');
      this.refresh();
    });
    return true;
  }

  // A timeout means the channel is unverified, never that a message was dropped. An
  // acknowledgment that arrives later, on the same stream with the same nonce, still verifies it.
  armProbeTimer() {
    clearTimeout(this.probeTimer);
    this.probeTimer = setTimeout(() => { if (this.channelState === 'checking') this.setChannel('unverified'); }, this.probeTimeoutMs ?? PROBE_TIMEOUT_MS);
    this.probeTimer.unref?.();
  }

  // The check goes out once per connection, and only to a session whose permission mode is
  // known and served. It asks for nothing but the acknowledgment.
  maybeProbe() {
    if (!this.probe || this.probe.sent || !this.streamBusy()) return;
    if (!this.permissionMode || isForbiddenMode(this.permissionMode)) return;
    this.probe.sent = true;
    this.push({ type: 'message', content: PROBE_TEXT, meta: { chat_id: `check-${this.probe.nonce}`, kind: 'connection_check' } });
    if (this.channelState === 'checking') this.armProbeTimer();
  }

  // Does this id name the pending check or a message of this console?
  owns(chatId) {
    if (typeof chatId !== 'string' || !chatId) return false;
    return (this.probe?.sent && chatId === `check-${this.probe.nonce}`) || this.chats.has(chatId);
  }

  acknowledge(chatId) {
    if (!this.probe?.sent || chatId !== `check-${this.probe.nonce}` || !this.streamBusy()) return false;
    clearTimeout(this.probeTimer);
    this.setChannel('verified');
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

  remember(chatId, chat) {
    this.chats.set(chatId, chat);
    if (this.chats.size > 200) {
      const [oldest, old] = this.chats.entries().next().value;
      clearTimeout(old.timer);
      this.chats.delete(oldest);
    }
  }

  // States only move forward on evidence (received, answered); "unconfirmed" is only ever
  // said of a message still on its way.
  markChat(chatId, state) {
    const chat = this.chats.get(chatId);
    if (!chat || chat.state === state) return false;
    if (state === 'unconfirmed' ? chat.state !== 'sending' : RANK[state] <= RANK[chat.state]) return false;
    chat.state = state;
    clearTimeout(chat.timer);
    // The turn that took the message ends with its answer, said in the console or in Claude Code.
    if (state === 'received') { this.turnChat = chatId; this.status = 'working'; }
    this.emit(agentEvent('message.state', { chatId, state }));
    return true;
  }

  // Direct: only on a verified channel. The message goes out once; its state then follows
  // evidence that names its chat id.
  send(text, workId) {
    if (!this.streamBusy()) throw Object.assign(new Error('No Claude Code session is connected.'), { code: 'NOT_CONNECTED' });
    if (this.channelState !== 'verified') throw Object.assign(new Error('Sending from the console is not available for this Claude Code session. Use "Copy for terminal" and paste the message in Claude Code.'), { code: 'CHANNEL_UNVERIFIED', status: 409 });
    const chatId = randomBytes(4).toString('hex');
    const chat = { route: 'direct', state: 'sending', timer: null };
    this.remember(chatId, chat);
    this.push({ type: 'message', content: text, meta: { chat_id: chatId, ...(workId ? { work_id: workId } : {}) } });
    this.emit(agentEvent('message.sent', { role: 'user', text, chatId, route: 'direct', state: 'sending' }));
    chat.timer = setTimeout(() => this.markChat(chatId, 'unconfirmed'), this.deliveryTimeoutMs ?? DELIVERY_TIMEOUT_MS);
    chat.timer.unref?.();
    return chatId;
  }

  // Terminal Mode: the developer copied the message (with its marker) to paste in Claude Code.
  // Nothing is sent through the channel for it, now or later.
  noteTerminal(text, chatId) {
    if (!CHAT_ID.test(String(chatId ?? '')) || this.chats.has(chatId)) throw Object.assign(new Error('This message could not be prepared. Try again.'), { code: 'BAD_MESSAGE', status: 400 });
    this.remember(chatId, { route: 'terminal', state: 'copied', timer: null });
    this.emit(agentEvent('message.sent', { role: 'user', text, chatId, route: 'terminal', state: 'copied' }));
    return chatId;
  }

  // From the channel server.
  async onChannelEvent(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return;
    if (body.type === 'reply' || body.type === 'received') {
      const chatId = short(body.chat_id, 40);
      // The connection check's answer (or a stale one from an earlier connection) is never chat.
      if (chatId.startsWith('check-')) { this.acknowledge(chatId); return; }
      if (body.type === 'received') { this.markChat(chatId, 'received'); return; }
      this.markChat(chatId, 'answered');
      this.emit(agentEvent('message.done', { role: 'agent', text: String(body.text ?? '').slice(0, 20_000), chatId: chatId.slice(0, 20) }));
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
    const chatId = typeof body.chat_id === 'string' ? short(body.chat_id, 40) : '';
    const proof = this.owns(chatId);
    // The first session seen is the one linked; hooks of any other Claude Code session in
    // this folder (for example a second launch whose channel was refused) are ignored, unless
    // a hook proves it is the session this console talks to: it names the pending connection
    // check or one of this console's messages (PF-0145; a new session after /clear).
    if (!this.boundSession) this.boundSession = session;
    else if (session !== this.boundSession) {
      if (!proof) return;
      this.boundSession = session;
      this.running.clear();
      this.denied.clear();
      this.turnChat = null;
    }
    const event = body.hook_event_name;
    if (event === 'SessionEnd') {
      // The session is over (exit, /clear): the next one binds afresh.
      this.boundSession = null;
      this.hookLive = false;
      this.turnChat = null;
      this.running.clear();
      this.denied.clear();
      if (this.status === 'working') this.status = 'connected';
      this.refresh();
      return;
    }
    this.lastHookAt = Date.now();
    this.sessionId = session;
    this.hookLive = true;
    this.refresh();
    if (typeof body.permission_mode === 'string') {
      const mode = short(body.permission_mode, 30);
      if (mode !== this.permissionMode) {
        this.permissionMode = mode;
        this.emit(agentEvent('mode.changed', { mode, ...(isForbiddenMode(mode) ? { forbidden: true } : {}) }));
      }
    }
    this.maybeProbe();
    const tool = short(body.tool_name, 80);
    const toolUseId = short(body.tool_use_id, 80);
    const own = OWN_TOOL.test(tool); // the channel's own reply/received calls are not project work
    if (proof && this.chats.has(chatId)) this.markChat(chatId, 'received');
    switch (event) {
      case 'UserPromptSubmit':
        this.status = 'working';
        this.turnChat = proof && this.chats.has(chatId) ? chatId : null;
        this.emit(agentEvent('turn.started', {}));
        break;
      case 'PreToolUse':
        if (own) break;
        if (toolUseId) this.running.set(toolUseId, tool);
        if (this.running.size > 200) this.running.delete(this.running.keys().next().value);
        this.emit(agentEvent('tool.started', { toolCallId: toolUseId, kind: tool, title: `${tool}${body.summary ? `: ${short(body.summary, 160)}` : ''}`, status: 'in_progress' }));
        break;
      case 'PostToolUse': {
        if (own) break;
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
        // The turn this console's message opened has ended: it was answered (in Claude Code).
        if (this.turnChat) this.markChat(this.turnChat, 'answered');
        this.turnChat = null;
        break;
      default:
        break;
    }
  }

  detach() {
    clearTimeout(this.probeTimer);
    for (const chat of this.chats.values()) clearTimeout(chat.timer);
    if (this.stream) {
      try { this.stream.end(); } catch { /* closed */ }
    }
    this.stream = null;
    this.connected = false;
    this.hookLive = false;
    this.channelState = 'none';
  }
}
