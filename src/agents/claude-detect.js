// EXPERIMENTAL, development builds only (not in published releases; see experimental.js).
// Claude Code detection: version and subscription login, from Claude Code's own CLI. It
// never reads credential files, tokens, or keychains, and never logs in or out.
import { parseVersion, run, versionAtLeast, which } from './detect.js';

// Channel permission relay is restricted to registered channels from this version.
export const CLAUDE_MIN = Object.freeze([2, 1, 234]);

export async function detectClaude(env = process.env) {
  const claude = env.YALLAFLOW_CLAUDE_BIN || (await which('claude', env));
  const result = { provider: 'claude', claude: null, auth: null, ready: false, problems: [], warnings: [] };
  if (!claude) {
    result.problems.push('Claude Code (`claude`) is not installed or not on PATH.');
    return result;
  }
  const version = parseVersion((await run(claude, ['--version'], { env })).stdout);
  result.claude = { path: claude, version: version ? version.join('.') : null };
  if (!versionAtLeast(version, CLAUDE_MIN)) result.problems.push(`Claude Code ${result.claude.version ?? '?'} is too old for channels with permission relay (needs ${CLAUDE_MIN.join('.')} or later).`);
  const status = await run(claude, ['auth', 'status', '--json'], { env });
  try {
    const parsed = JSON.parse(status.stdout);
    // Keep only non-identifying fields; email, organization and IDs are discarded here.
    result.auth = { loggedIn: Boolean(parsed.loggedIn), method: parsed.authMethod ?? null, plan: parsed.subscriptionType ?? null };
  } catch {
    result.auth = { loggedIn: false, method: null, plan: null };
  }
  if (!result.auth.loggedIn) result.problems.push('Claude Code is not logged in. Run `claude` and sign in with your Claude account.');
  else if (result.auth.method !== 'claude.ai') result.problems.push('Claude Code is not using a Claude subscription login. YallaFlow connects only to subscription sessions; API-key sessions are not supported.');
  // On Claude Team and Enterprise accounts the organization decides whether the console may send
  // to Claude Code. YallaFlow cannot see that setting, so it says so once, calmly; the connection
  // check decides when Claude Code connects (PF-0145).
  if (result.auth.loggedIn && ['team', 'enterprise'].includes(String(result.auth.plan ?? '').toLowerCase())) {
    result.warnings.push(`This Claude Code login is a Claude ${result.auth.plan === 'team' ? 'Team' : 'Enterprise'} account. Your organization may not allow sending from the console. YallaFlow checks this when Claude Code connects; when sending is not available you write here, copy, and paste in the Claude Code terminal, and the console still shows the work.`);
  }
  result.ready = result.problems.length === 0;
  return result;
}
