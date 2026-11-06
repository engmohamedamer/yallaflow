// The provider-neutral contract between the Agent Bridge and the console (v1.3.0):
// `yallaflow.agent-event/1` events and per-provider capability records. The UI renders
// only what a capability record allows; nothing here is provider-specific UI.
export const AGENT_EVENT_SCHEMA = 'yallaflow.agent-event/1';

// What each provider integration can actually do. Verified behavior is documented in
// research/agent-interaction/CAPABILITY_MATRIX.md; this table must never promise more.
export const CAPABILITIES = Object.freeze({
  codex: Object.freeze({
    ownership: 'managed',
    start: true, stop: true, end: true, resume: true, send: true, streamTokens: true,
    relayPermissions: true, allowForSession: true, observeTools: true, setMode: true,
    modes: ['read-only', 'workspace-write']
  }),
  claude: Object.freeze({
    ownership: 'user-session',
    start: false, stop: false, end: false, resume: false, send: true, streamTokens: false,
    relayPermissions: true, allowForSession: false, observeTools: true, setMode: false,
    modes: []
  })
});

// Modes the bridge never selects or offers, whatever a provider advertises.
const FORBIDDEN_MODE = /full-access|bypass|dangerous|yolo|skip/i;
export function isForbiddenMode(mode) {
  return typeof mode === 'string' && FORBIDDEN_MODE.test(mode);
}

let sequence = 0;
export function agentEvent(type, fields = {}) {
  return { schema: AGENT_EVENT_SCHEMA, seq: ++sequence, at: new Date().toISOString(), type, ...fields };
}

const short = (value, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// ACP `session/update` → agent-event/1. Text is kept (it is what the user reads); tool
// details are reduced to a title and status.
export function fromAcpUpdate(params) {
  const update = params?.update ?? {};
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return agentEvent('message.delta', { role: 'agent', text: update.content?.type === 'text' ? String(update.content.text ?? '') : '' });
    case 'agent_thought_chunk':
      return agentEvent('thought.delta', { text: update.content?.type === 'text' ? String(update.content.text ?? '') : '' });
    case 'tool_call':
      return agentEvent('tool.started', { toolCallId: String(update.toolCallId ?? ''), kind: update.kind ?? 'other', title: short(update.title, 200), status: update.status ?? 'pending' });
    case 'tool_call_update':
      return agentEvent('tool.updated', { toolCallId: String(update.toolCallId ?? ''), status: update.status ?? null, ...(update.title ? { title: short(update.title, 200) } : {}) });
    case 'plan':
      return agentEvent('plan.updated', { entries: (update.entries ?? []).map((entry) => ({ content: short(entry.content, 200), status: entry.status ?? 'pending' })) });
    case 'current_mode_update':
      return agentEvent('mode.changed', { mode: String(update.currentModeId ?? '') });
    default:
      return null; // usage, session info, command lists: not shown
  }
}

// Permission options in a provider-neutral form (ACP option kinds).
export function permissionOptions(options = []) {
  return options
    .filter((option) => ['allow_once', 'allow_always', 'reject_once', 'reject_always'].includes(option.kind))
    .map((option) => ({ id: String(option.optionId), kind: option.kind }));
}
