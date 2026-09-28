import { findProjectRoot } from '../core/workspace.js';
import { assessWorkspace } from '../core/assessment.js';
import { describeAgentContractState } from '../agent/contract.js';

async function requireRoot() {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  return root;
}

// Read-only. One place to see what an upgraded workspace still needs, assembled from
// doctor, agent status, context status, and reconciliation — never an automatic
// "upgrade everything": upgrades contain decisions, so they are exposed, not hidden.
export async function upgradeStatusCommand() {
  const root = await requireRoot();
  const report = await assessWorkspace(root);
  const { memory, reconciliation } = report;
  console.log('YallaFlow Workspace Upgrade Status');
  console.log(`\nInstalled package: ${report.packageVersion}`);
  console.log(`Workspace: ${report.legacyStructures.length ? 'legacy structures present' : 'current structures'}`);
  for (const entry of report.legacyStructures) console.log(`  - ${entry}`);
  console.log(`\nAgent contract: ${report.agent.state === 'current' ? `v${report.agent.version} / current` : describeAgentContractState(report.agent)}`);
  const bootstraps = report.bootstraps.filter((item) => !['not-installed', 'shared'].includes(item.state));
  console.log(`Agent bootstrap: ${bootstraps.length ? bootstraps.map((item) => `${item.file} ${item.state}`).join(', ') : 'none set up (optional)'}`);
  console.log('\nProject context:');
  console.log(`  ${describeSchema(report.schema)}`);
  if (memory.unreadable) console.log('  not read — the ledger schema is not supported by this CLI');
  else console.log(memory.exists
    ? `  ${memory.totals.current} canonical current fact(s) · ${memory.totals.disputed} disputed · ${memory.totals.superseded} superseded`
    : '  no canonical ledger yet');
  if (!memory.unreadable) console.log(`  ${report.pendingLegacy.length} legacy fact(s) pending reconciliation`);
  if (reconciliation) console.log(`  reconciliation ${reconciliation.meta.id}: ${reconciliation.counts.decided}/${reconciliation.counts.total} decided, ${reconciliation.counts.applied} applied, review ${reconciliation.review}`);
  const sourceIssues = report.doctor.failures.filter((name) => /source/i.test(name));
  console.log(`\nSources: ${report.sources.length} · ${sourceIssues.length ? `${sourceIssues.length} issue(s)` : 'healthy'}`);
  const workIssues = report.doctor.failures.filter((name) => /^PF-\d+:/.test(name));
  console.log(`Work history: ${report.work.length} item(s) · ${workIssues.length ? `${workIssues.length} issue(s)` : 'healthy'}`);
  console.log(`Integrity: ${report.doctor.failures.length ? `${report.doctor.failures.length} doctor check(s) failing` : 'doctor healthy'}`);
  console.log(`\nRecommended next action:\n  ${report.plan.length ? report.plan[0].command ?? report.plan[0].title : 'none — the workspace is current'}`);
  const warnings = [...report.gitWarnings];
  if (warnings.length) {
    console.log('\nWarnings:');
    for (const warning of warnings) console.log(`  ${warning}`);
  }
  if (report.plan.length > 1) console.log('\nFull ordered plan: yallaflow upgrade plan');
}

function describeSchema(schema) {
  if (!schema.exists) return 'context schema: none yet (a new ledger starts at v1)';
  if (schema.newer) return `context schema: v${schema.version} — NEWER than this CLI supports (v1–v2); upgrade YallaFlow`;
  if (!schema.supported) return 'context schema: unreadable or unknown — run `yallaflow doctor`';
  return schema.version === 1
    ? 'context schema: v1 (also readable by YallaFlow 0.3.6)'
    : 'context schema: v2 (multi-origin / reconciled knowledge; requires YallaFlow ≥ 0.3.7)';
}

export async function upgradePlanCommand() {
  const root = await requireRoot();
  const report = await assessWorkspace(root);
  console.log('YallaFlow Upgrade Plan (read-only; nothing is changed — each step is a deliberate command)');
  if (!report.plan.length) {
    console.log('\nNo upgrade actions required. The workspace is current.');
    return;
  }
  report.plan.forEach((step, index) => {
    console.log(`\n${index + 1}. ${step.title}`);
    if (step.command) console.log(`   ${step.command}`);
    if (step.detail) console.log(`   ${step.detail}`);
  });
}
