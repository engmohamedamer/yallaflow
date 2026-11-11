// Project readiness (PF-0123, 1.5.2): what a project still needs before normal work, derived
// on every request from authoritative state — never stored, so there is nothing to migrate and
// nothing that can drift from Core.
//
// - initialized    the project's records can be read (it is registered, so .yallaflow exists).
// - understanding  Core's own gate (projectUnderstandingGate): only a project recorded as
//                  Brownfield needs an approved understanding; Greenfield is never gated.
// - agent          a provider the console can use is set up (needed for agent sessions and
//                  queue runs only — creating work never needs an agent).
// - runtime        optional: blocks nothing but "Start project".
//
// `allows` is what the server enforces (see server.js); the console only explains it.
import { assessProjectUnderstanding, projectUnderstandingGate, UNDERSTANDING } from '../baseline/understanding.js';

export const READINESS_SCHEMA = 'yallaflow.console.readiness/1';

const STATUS_BY_UNDERSTANDING = Object.freeze({
  [UNDERSTANDING.REQUIRED]: 'required',
  [UNDERSTANDING.IN_PROGRESS]: 'in-progress',
  [UNDERSTANDING.AWAITING_REVIEW]: 'awaiting-review'
});

// snapshotError: the message when the project's records could not be read (null when fine).
// agent: { checked: boolean, enabled: boolean, ready: boolean, problems: string[] }.
// runtime: the `runtime status --json` document, or null when it could not be read.
export async function computeReadiness(root, { snapshotError = null, agent, runtime = null } = {}) {
  const steps = [];
  steps.push(snapshotError
    ? { id: 'initialized', status: 'attention', detail: String(snapshotError).slice(0, 300), next: { kind: 'command', command: 'yallaflow doctor' } }
    : { id: 'initialized', status: 'done' });

  let gate = null;
  let understanding = null;
  try {
    gate = await projectUnderstandingGate(root);
    if (gate) understanding = await assessProjectUnderstanding(root, { kind: 'brownfield' });
  } catch {
    gate = null; // unreadable records are reported by the initialized step and by doctor
  }
  if (!gate) steps.push({ id: 'understanding', status: 'done' });
  else {
    const status = STATUS_BY_UNDERSTANDING[gate.state] ?? 'required';
    steps.push({
      id: 'understanding',
      status,
      blocks: ['createWork', 'runQueue'],
      baselineId: understanding?.baselineId ?? null,
      next: status === 'awaiting-review'
        ? { kind: 'review', workId: understanding?.baselineId ?? null }
        : { kind: 'agent', ask: status === 'required' ? 'Establish project understanding for this repository.' : 'Continue the project-understanding discovery.' }
    });
  }

  const agentStatus = !agent?.checked ? 'unknown' : !agent.enabled ? 'off' : agent.ready ? 'done' : 'missing';
  steps.push({
    id: 'agent',
    status: agentStatus,
    blocks: agentStatus === 'done' || agentStatus === 'unknown' ? [] : ['agentSession', 'runQueue'],
    ...(agent?.problems?.length ? { problems: agent.problems.slice(0, 5) } : {}),
    ...(agentStatus === 'done' || agentStatus === 'unknown' ? {} : { next: { kind: 'setup' } })
  });

  const services = Array.isArray(runtime?.services) ? runtime.services : [];
  const running = services.filter((service) => ['running', 'starting'].includes(service.state)).length;
  const failed = services.filter((service) => service.state === 'failed').length;
  steps.push({
    id: 'runtime',
    optional: true,
    status: runtime?.supported === false ? 'unsupported' : !services.length ? 'not-configured' : failed ? 'failed' : running === services.length ? 'done' : 'stopped',
    services: services.length,
    running,
    failed
  });

  const blocks = new Set(steps.flatMap((step) => step.blocks ?? []));
  const requiredOpen = steps.filter((step) => !step.optional && !['done', 'unknown'].includes(step.status) && (step.id !== 'agent'));
  return {
    schema: READINESS_SCHEMA,
    level: steps.some((step) => step.status === 'attention') ? 'attention' : requiredOpen.length ? 'incomplete' : 'ready',
    steps,
    allows: {
      createWork: !blocks.has('createWork'),
      runQueue: !blocks.has('runQueue'),
      agentSessions: !blocks.has('agentSession')
    },
    // The understanding work item itself may always run, so onboarding never deadlocks.
    onboardingWorkId: steps.find((step) => step.id === 'understanding')?.baselineId ?? null
  };
}

// A refusal for the server (409 unless a caller keeps an existing status) with the readiness document so the console can show the next step.
export function notReady(code, message, readiness, status = 409) {
  return Object.assign(new Error(message), { status, code, extra: { readiness } });
}
