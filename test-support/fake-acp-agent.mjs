#!/usr/bin/env node
// SIMULATED ACP agent for automated tests (not a real provider). It mimics the protocol
// behavior observed from the real codex-acp 2.5.0 in the PoC (research/agent-interaction/
// evidence/poc): auth status notification, modes including a full-access mode, streamed
// message chunks, permission requests, cancel, resume, and crashes.
// Prompt keywords: PERMISSION (asks once), SLOW (long turn, cancellable), CRASH (exits),
// ESCALATE (the agent switches itself to its full-access mode), PERSISTONLY (a permission
// request whose only "always" options persist beyond the session, as codex-acp offers when
// Codex proposes an exec-policy rule), SPAWN (starts a command that ignores SIGTERM, in the
// agent's process group), ESCAPE (starts one in a new session, outside the group).
// Permission option ids are the real codex-acp 2.5.0 ids.
import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const STATE = process.env.FAKE_ACP_STATE;
const auth = process.env.FAKE_ACP_AUTH ?? 'account';
if (STATE) appendFileSync(STATE, `${JSON.stringify({ spawn: true, hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY), hasCodexKey: Boolean(process.env.CODEX_API_KEY), codexPath: process.env.CODEX_PATH ?? null, cwd: process.cwd() })}\n`);
const sessionsFile = STATE ? `${STATE}.sessions` : null;
const known = new Set(sessionsFile && existsSync(sessionsFile) ? JSON.parse(readFileSync(sessionsFile, 'utf8')) : []);

let nextId = 1000;
const waiting = new Map();
let cancelled = false;
const out = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const update = (sessionId, body) => out({ method: 'session/update', params: { sessionId, update: body } });
const request = (method, params) => new Promise((resolve) => { const id = nextId++; waiting.set(id, resolve); out({ id, method, params }); });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const STUBBORN = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);";
function startCommand(detached) {
  const child = spawn(process.execPath, ['-e', STUBBORN], { detached, stdio: 'ignore' });
  if (detached) child.unref();
  if (STATE) appendFileSync(STATE, `${JSON.stringify({ command: child.pid, detached })}\n`);
}
const modes = { currentModeId: 'agent', availableModes: [{ id: 'read-only', name: 'Read Only' }, { id: 'workspace-write', name: 'Workspace' }, { id: 'agent', name: 'Agent' }, { id: 'agent-full-access', name: 'Full Access' }] };

async function handle(message) {
  const { id, method, params } = message;
  if (id !== undefined && waiting.has(id)) { waiting.get(id)(message.result); waiting.delete(id); return; }
  switch (method) {
    case 'initialize':
      if (process.env.FAKE_ACP_INIT_DELAY_MS) await sleep(Number(process.env.FAKE_ACP_INIT_DELAY_MS)); // a slow handshake
      out({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {}, list: {} } }, authMethods: [{ id: 'chat-gpt' }, { id: 'api-key' }], agentInfo: { name: '@agentclientprotocol/codex-acp', version: '2.5.0' } } });
      setTimeout(() => out({ method: '_auth/status_update', params: { authStatus: auth === 'none' ? { kind: 'none' } : auth === 'account' ? { kind: 'account', label: 'ChatGPT Plus', account: { email: 'someone@example.com', plan: 'plus' } } : { kind: auth } } }), 20);
      return;
    case 'session/new': {
      const sessionId = `fake-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      known.add(sessionId);
      if (sessionsFile) writeFileSync(sessionsFile, JSON.stringify([...known]));
      out({ id, result: { sessionId, modes } });
      return;
    }
    case 'session/resume':
      if (!known.has(params.sessionId)) return out({ id, error: { code: -32602, message: 'unknown session' } });
      out({ id, result: { modes } });
      return;
    case 'session/set_mode':
      if (STATE) appendFileSync(STATE, `${JSON.stringify({ mode: params.modeId })}\n`);
      out({ id, result: {} });
      return;
    case 'session/cancel':
      cancelled = true;
      return;
    case 'session/prompt': {
      cancelled = false;
      const text = params.prompt?.[0]?.text ?? '';
      const sid = params.sessionId;
      if (text.includes('ESCALATE')) update(sid, { sessionUpdate: 'current_mode_update', currentModeId: 'agent-full-access' });
      if (text.includes('SPAWN')) startCommand(false);
      if (text.includes('ESCAPE')) startCommand(true);
      if (text.includes('CRASH')) { update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'about to crash' } }); await sleep(50); process.exit(3); }
      for (const word of ['Hello', ' from', ' the', ' agent.']) { update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: word } }); await sleep(5); }
      if (text.includes('PERMISSION')) {
        update(sid, { sessionUpdate: 'tool_call', toolCallId: 't1', kind: 'execute', title: 'touch file.txt', status: 'pending' });
        const options = text.includes('PERSISTONLY')
          ? [{ optionId: 'allow_once', kind: 'allow_once', name: 'Yes, proceed' }, { optionId: 'accept_execpolicy_amendment', kind: 'allow_always', name: "Yes, and don't ask again for commands that start with `touch`" }, { optionId: 'apply_network_policy_amendment:0', kind: 'reject_always', name: 'No, and block this host in the future' }]
          : [{ optionId: 'allow_once', kind: 'allow_once', name: 'Yes, proceed' }, { optionId: 'accept_execpolicy_amendment', kind: 'allow_always', name: "Yes, and don't ask again for commands that start with `touch`" }, { optionId: 'allow_for_session', kind: 'allow_always', name: "Yes, and don't ask again for this command in this session" }, { optionId: 'apply_network_policy_amendment:0', kind: 'reject_always', name: 'No, and block this host in the future' }, { optionId: 'decline', kind: 'reject_once', name: 'No, continue without running it' }];
        const answer = await request('session/request_permission', { sessionId: sid, toolCall: { toolCallId: 't1', title: 'touch file.txt', kind: 'execute' }, options });
        if (STATE) appendFileSync(STATE, `${JSON.stringify({ permission: answer?.outcome ?? null })}\n`);
        const allowed = answer?.outcome?.outcome === 'selected' && options.find((option) => option.optionId === answer.outcome.optionId)?.kind.startsWith('allow');
        update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: allowed ? 'completed' : 'failed' });
        if (!allowed) return out({ id, result: { stopReason: 'cancelled' } });
      }
      if (text.includes('SLOW')) {
        for (let index = 0; index < 100 && !cancelled; index++) { update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ` ${index}` } }); await sleep(30); }
        return out({ id, result: { stopReason: cancelled ? 'cancelled' : 'end_turn' } });
      }
      out({ id, result: { stopReason: 'end_turn' } });
      return;
    }
    default:
      if (id !== undefined) out({ id, error: { code: -32601, message: `no ${method}` } });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let cut;
  while ((cut = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, cut).trim();
    buffer = buffer.slice(cut + 1);
    if (line) handle(JSON.parse(line));
  }
});
process.stdin.on('end', () => process.exit(0));
