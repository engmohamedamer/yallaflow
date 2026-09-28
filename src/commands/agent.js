import { findProjectRoot } from '../core/workspace.js';
import { describeAgentContractState, inspectAgentContract, refreshAgentContract } from '../agent/contract.js';
import { describeBootstrapState, inspectAllBootstraps, refreshBootstraps, resolveBootstrapProvider, setupBootstrap } from '../agent/bootstrap.js';

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
  console.log('\nAgent bootstrap (repository-root session files pointing to AGENT.md):');
  for (const bootstrap of await inspectAllBootstraps(root)) {
    console.log(`- ${bootstrap.provider} (${bootstrap.file}): ${describeBootstrapState(bootstrap)}`);
  }
}

const BOOTSTRAP_ACTIONS = {
  created: (file) => `create ${file} with the YallaFlow bootstrap block`,
  appended: (file) => `append the YallaFlow bootstrap block to ${file} (existing content unchanged)`,
  'updated-managed-block': (file) => `update only the YallaFlow bootstrap block in ${file} (content outside it unchanged)`,
  'installed-with-preserved-content': (file) => `install the current bootstrap block in ${file} and keep the edited block text verbatim under "## Preserved YallaFlow bootstrap edits"`
};

export async function agentSetupCommand(providerName, { preserveExisting, dryRun } = {}) {
  const root = await requireRoot();
  const provider = resolveBootstrapProvider(providerName);
  const result = await setupBootstrap(root, provider, { preserveExisting, dryRun });
  if (result.action === 'unchanged') {
    console.log(`${provider.file} already has the current YallaFlow bootstrap block (v${result.status.installed}); nothing changed.`);
  } else {
    console.log(`${dryRun ? 'Would' : 'Did'} ${BOOTSTRAP_ACTIONS[result.action](provider.file)} (bootstrap v${result.status.installed}).`);
    if (dryRun) {
      console.log('\n--- preview ---');
      process.stdout.write(result.preview);
    }
  }
  const contract = await inspectAgentContract(root);
  if (contract.state !== 'current') console.log(`\nNote: the canonical contract .yallaflow/AGENT.md is ${contract.state} — ${describeAgentContractState(contract)}`);
}

export async function agentRefreshCommand({ preserveExisting, dryRun } = {}) {
  const root = await requireRoot();
  const result = await refreshAgentContract(root, { preserveExisting, dryRun });
  if (result.action === 'unchanged') {
    console.log(`AGENT.md is already at agent contract v${result.status.installed}; nothing changed.`);
    await refreshProviderBootstraps(root, dryRun);
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
  await refreshProviderBootstraps(root, dryRun);
}

// Installed provider bootstrap blocks are refreshed with AGENT.md; only unmodified,
// outdated blocks are rewritten. Anything else is reported, never forced.
async function refreshProviderBootstraps(root, dryRun) {
  for (const result of await refreshBootstraps(root, { dryRun })) {
    const { status } = result;
    if (result.action === 'unchanged') console.log(`${status.file}: bootstrap block already current; nothing changed.`);
    else if (result.action === 'skipped') console.log(`${status.file}: bootstrap block not refreshed — ${describeBootstrapState(status)}`);
    else console.log(`${status.file}: ${dryRun ? 'would update' : 'updated'} only the YallaFlow bootstrap block (v${status.version} → v${status.installed}).`);
  }
}
