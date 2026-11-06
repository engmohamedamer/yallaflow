import { findProjectRoot } from '../core/workspace.js';
import { detectProviders } from '../agents/detect.js';
import { claudeIncluded, loadClaude } from '../agents/experimental.js';

// `yallaflow agents detect` (read-only) and, in development builds only, `yallaflow agents
// claude-files` (v1.3.0). Agents run on the user's own subscriptions; nothing here reads or
// stores credentials.
export async function agentsCommand(action) {
  if (action === 'detect') {
    const withClaude = claudeIncluded();
    const found = await detectProviders({ claude: withClaude, maxAgeMs: 0 });
    const codex = found.codex;
    console.log(`Codex: ${codex.ready ? 'ready' : 'not ready'}${codex.codex?.version ? ` · codex ${codex.codex.version}` : ''}${codex.adapter?.version ? ` · codex-acp ${codex.adapter.version}` : ''}`);
    for (const problem of codex.problems) console.log(`  - ${problem}`);
    console.log('  Subscription check: when a session starts (ChatGPT login required; API keys are never used).');
    if (withClaude) {
      const claude = found.claude;
      console.log(`Claude Code (experimental, development build): ${claude.ready ? 'ready' : 'not ready'}${claude.claude?.version ? ` · claude ${claude.claude.version}` : ''}${claude.auth?.method ? ` · login ${claude.auth.method}${claude.auth.plan ? ` (${claude.auth.plan})` : ''}` : ''}`);
      for (const problem of claude.problems) console.log(`  - ${problem}`);
    }
    console.log(`\nStart the Agent Workspace: yallaflow console --agents${withClaude ? '  (add --experimental-claude for Claude Code)' : ''}`);
    return;
  }
  const { writeClaudeLaunchFiles } = await loadClaude();
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const files = await writeClaudeLaunchFiles(root);
  console.log('Wrote the local Claude Code connection files (git-ignored):');
  console.log(`  ${files.mcpFile}`);
  console.log(`  ${files.settingsFile}`);
  console.log('\nWith `yallaflow console --agents --experimental-claude` running, start Claude Code yourself in this folder:');
  console.log(`  ${files.command}`);
  console.log('\nClaude Code shows a development-channel warning while the YallaFlow channel is not on Anthropic\'s allowlist; the decision is yours.');
}
