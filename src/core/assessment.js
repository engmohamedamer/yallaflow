import { getConfig, getCurrentState, listWork } from './workspace.js';
import { checkWorkspaceIntegrity } from './integrity.js';
import { listSources } from './sources.js';
import { collectDoctorReport } from '../commands/doctor.js';
import { describeAgentContractState, inspectAgentContract } from '../agent/contract.js';
import { summarizeProjectContext } from '../context/summary.js';
import { probeContextSchema, unsupportedSchemaMessage } from '../context/ledger.js';
import { findActiveReconciliation, pendingLegacyCandidates, reconciliationStatus } from '../reconciliation/store.js';
import { PACKAGE_VERSION } from '../version.js';

// Read-only, deterministic workspace assessment shared by `upgrade status`,
// `upgrade plan`, and `brief`. It only aggregates what doctor, the agent-contract
// inspector, project memory, and reconciliation already report — no semantic
// inference, no migration, no repair, no writes.
export async function assessWorkspace(root) {
  // A ledger written by a newer YallaFlow is reported, never read: memory-derived
  // sections are skipped rather than misinterpreted.
  const schema = await probeContextSchema(root);
  const readable = schema.supported || !schema.exists;
  const [config, state, work, sources, agent, doctor, memory, pendingLegacy, active] = await Promise.all([
    getConfig(root),
    getCurrentState(root),
    listWork(root),
    listSources(root).catch(() => []),
    inspectAgentContract(root),
    collectDoctorReport(root),
    readable ? summarizeProjectContext(root) : { exists: false, unreadable: true },
    readable ? pendingLegacyCandidates(root) : [],
    findActiveReconciliation(root)
  ]);
  const failures = doctor.checks.filter(([, ok]) => !ok).map(([name]) => name);
  const gitWarnings = checkWorkspaceIntegrity(root);
  const keptSections = doctor.warnings.filter((warning) => /was reconciled .* hand-edited|remains outside the managed block/.test(warning));
  const reconciliation = active && readable ? await reconciliationStatus(root, active.meta.id) : null;

  const legacyStructures = [];
  if (['legacy-generated', 'legacy-customized'].includes(agent.state)) legacyStructures.push('unversioned AGENT.md (pre-v0.3.6 agent guidance)');
  if (agent.state === 'outdated') legacyStructures.push(`agent contract v${agent.version} (installed v${agent.installed})`);
  if (pendingLegacy.length) legacyStructures.push(`v0.3.5 append-only project context (${pendingLegacy.length} item(s) not yet reconciled)`);
  const uncontracted = work.filter((item) => item.routingStatus !== 'pending' && !item.behaviorContract && !item.requiredCapabilities);
  if (uncontracted.length) legacyStructures.push(`${uncontracted.length} pre-v0.2 work item(s) without a pinned Behavior Contract (readable as-is; no action needed)`);

  const plan = [];
  if (!readable) {
    plan.push({ title: 'Upgrade the installed YallaFlow package', command: null, detail: schema.newer ? unsupportedSchemaMessage(schema.version) : '.yallaflow/context/index.yaml has an unreadable or unknown schema version; run `yallaflow doctor`.' });
  }
  if (failures.length) {
    plan.push({ title: 'Resolve structural integrity failures', command: 'yallaflow doctor', detail: `${failures.length} doctor check(s) fail; other upgrade steps may refuse until they are fixed.` });
  }
  if (!['current'].includes(agent.state)) {
    const command = agent.state === 'newer' ? null
      : ['legacy-customized', 'modified'].includes(agent.state) ? 'yallaflow agent refresh --preserve-existing --dry-run' : 'yallaflow agent refresh';
    plan.push({ title: agent.state === 'newer' ? 'Upgrade the installed YallaFlow package' : 'Refresh the Agent Contract', command, detail: describeAgentContractState(agent) });
  }
  if (reconciliation) {
    plan.push({ title: 'Continue legacy context reconciliation', command: reconciliation.nextAction, detail: `${reconciliation.meta.id}: ${reconciliation.counts.decided}/${reconciliation.counts.total} decided, ${reconciliation.counts.applied} applied, review ${reconciliation.review}.` });
  } else if (pendingLegacy.length) {
    plan.push({ title: 'Reconcile legacy project context', command: 'yallaflow context reconcile start', detail: `${pendingLegacy.length} v0.3.5 fact(s) must be reconciled before they become canonical current truth (inspect with \`yallaflow context adopt --dry-run\`).` });
  }
  if (keptSections.length) {
    plan.push({ title: 'Review hand-edited legacy sections kept after reconciliation', command: 'yallaflow doctor', detail: `${keptSections.length} section(s) were not removed automatically because they were edited by hand.` });
  }
  if (gitWarnings.length) {
    plan.push({ title: 'Review Git durability of .yallaflow', command: 'git add .yallaflow (or deliberately gitignore it)', detail: gitWarnings[0] });
  }
  if (plan.length) plan.push({ title: 'Confirm workspace health', command: 'yallaflow doctor', detail: 'Re-run after the steps above; warnings are informational.' });

  return {
    packageVersion: PACKAGE_VERSION,
    schema,
    project: config.project ?? {},
    state,
    work,
    sources,
    agent,
    doctor: { failures, warnings: doctor.warnings },
    memory,
    pendingLegacy,
    reconciliation,
    legacyStructures,
    gitWarnings,
    plan
  };
}
