// Machine readiness (PF-0160): what this machine still needs before an agent can work, derived
// on every request from the machine setup's own checks (src/agents/setup.js) — never stored,
// so there is nothing to migrate and nothing that can claim an agent is online when it is not.
// It is the machine-level twin of project readiness (src/console/readiness.js).
//
// For each agent three states are kept apart, because each fails differently:
// - installed      the agent's own program was found and can be started;
// - authenticated  the agent's own CLI reports a subscription sign-in (never an API key);
// - connection     the console's integration with it: for Codex a handshake test this console
//                  run; for Claude Code only a session the developer starts can show it.
//
// `support` says what YallaFlow claims on this operating system, and no more:
// - 'supported'     setup is offered and was exercised on this kind of system;
// - 'not-verified'  the code paths exist but were only exercised with simulated platform data.
// Claude Code is experimental on every system.
// The agents a developer can prefer (the preferences file stores one of these ids).
export const AGENT_IDS = Object.freeze(['codex', 'claude']);
export const MACHINE_READINESS_SCHEMA = 'yallaflow.console.machine-readiness/1';
// Systems where guided agent setup was exercised for real (see docs/agents.md).
export const SETUP_PLATFORMS = Object.freeze(['linux', 'darwin']);
export const KNOWN_PLATFORMS = Object.freeze(['linux', 'darwin', 'win32']);

const support = (platform) => (SETUP_PLATFORMS.includes(platform) ? 'supported' : 'not-verified');

function codexView(codex, platform) {
  const installed = Boolean(codex?.installed);
  const login = codex?.login ?? {};
  const authenticated = !codex?.cli ? null : !login.checked ? null : Boolean(login.loggedIn && login.subscription);
  const verified = codex?.verified ?? null;
  const connection = !installed ? 'unavailable' : verified?.ok ? 'verified' : verified ? 'failed' : 'not-tested';
  const next = !installed ? (codex?.install ? 'install' : 'install-manually') : authenticated !== true ? 'sign-in' : connection !== 'verified' ? 'verify' : null;
  return {
    id: 'codex',
    stability: 'supported',
    support: support(platform),
    installed,
    authenticated,
    // An API-key sign-in is a known, different state: signed in, but not usable here.
    ...(login.method === 'api-key' ? { authProblem: 'api-key' } : {}),
    connection,
    // Usable for a session now: installed and signed in with a subscription. A connection test
    // is proof, not a precondition (the session itself checks the sign-in again).
    ready: Boolean(installed && authenticated === true),
    next,
    problems: (codex?.problems ?? []).slice(0, 5)
  };
}

function claudeView(claude, platform) {
  const included = Boolean(claude?.connectionIncluded);
  const installed = Boolean(claude?.installed);
  const auth = claude?.auth ?? null;
  const authenticated = !installed || !auth ? null : Boolean(auth.loggedIn && auth.method === 'claude.ai');
  return {
    id: 'claude',
    stability: 'experimental',
    support: support(platform),
    included,
    installed,
    authenticated,
    ...(auth?.loggedIn && auth.method !== 'claude.ai' ? { authProblem: 'not-subscription' } : {}),
    // The console cannot test Claude Code ahead of time: the developer starts the session, and
    // the console checks the connection then (PF-0145). It is never reported as verified here.
    connection: !included ? 'unavailable' : 'session-only',
    ready: Boolean(included && installed && authenticated === true && !(claude?.problems?.length)),
    next: !included ? null : !installed ? 'install-manually' : authenticated !== true ? 'sign-in-manually' : null,
    problems: (claude?.problems ?? []).slice(0, 5),
    warnings: (claude?.warnings ?? []).slice(0, 3)
  };
}

// status: MachineSetup.status(). preferences: loadPreferences(). Pure: no I/O, no clock.
export function computeMachineReadiness(status, { preferences = null, platform = status?.platform ?? process.platform } = {}) {
  const agents = { codex: codexView(status?.codex, platform), claude: claudeView(status?.claude, platform) };
  const wanted = preferences?.preferredAgent ?? null;
  // A saved preference is a wish, not a fact: it counts only while that agent can be offered,
  // and its readiness is the one computed now.
  const offered = wanted && agents[wanted] && (wanted !== 'claude' || agents.claude.included) ? wanted : null;
  const ready = Object.values(agents).filter((agent) => agent.ready).map((agent) => agent.id);
  return {
    schema: MACHINE_READINESS_SCHEMA,
    platform,
    platformSupport: support(platform),
    knownPlatform: KNOWN_PLATFORMS.includes(platform),
    agents,
    preferredAgent: offered ? { id: offered, ready: agents[offered].ready, next: agents[offered].next } : null,
    readyAgents: ready,
    level: ready.length ? 'ready' : 'needs-setup'
  };
}
