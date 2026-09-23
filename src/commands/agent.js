import { findProjectRoot } from '../core/workspace.js';
import { describeAgentContractState, inspectAgentContract, refreshAgentContract } from '../agent/contract.js';

async function requireRoot() {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  return root;
}

// Read-only.
export async function agentStatusCommand() {
  const root = await requireRoot();
  const status = await inspectAgentContract(root);
  console.log(`Agent contract (.yallaflow/AGENT.md): ${status.state}`);
  console.log(`Installed package contract: v${status.installed}`);
  if (status.version !== undefined) console.log(`Workspace contract: v${status.version}`);
  if (status.legacy) console.log(`Workspace contract: unversioned ${status.legacy} template`);
  console.log(describeAgentContractState(status));
}

export async function agentRefreshCommand({ preserveExisting, dryRun } = {}) {
  const root = await requireRoot();
  const result = await refreshAgentContract(root, { preserveExisting, dryRun });
  if (result.action === 'unchanged') {
    console.log(`AGENT.md is already at agent contract v${result.status.installed}; nothing changed.`);
    return;
  }
  const verb = dryRun ? 'Would' : 'Did';
  const description = {
    created: 'create AGENT.md with the managed agent contract',
    'replaced-generated': `replace the unmodified ${result.status.legacy} generated AGENT.md with the managed contract`,
    'updated-managed-block': 'update only the YallaFlow-managed block (content outside it unchanged)',
    'installed-with-preserved-content': 'install the managed contract and keep the previous content verbatim under "## Preserved project instructions"'
  }[result.action];
  console.log(`${verb} ${description} (agent contract v${result.status.installed}).`);
  if (dryRun) {
    console.log('\n--- preview ---');
    process.stdout.write(result.preview);
  }
}
