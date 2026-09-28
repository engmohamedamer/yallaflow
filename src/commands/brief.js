import { findProjectRoot } from '../core/workspace.js';
import { assessWorkspace } from '../core/assessment.js';
import { describeAgentContractState } from '../agent/contract.js';
import { needsRevalidation } from '../context/freshness.js';

// Fresh-agent orientation: one deterministic, read-only command that says where the
// workspace stands and where to look next. It never dumps project context and does
// not replace resume/handoff/guide — it points to them.
export async function briefCommand() {
  const root = await findProjectRoot();
  if (!root) {
    console.log('No .yallaflow workspace in this directory or any parent. YallaFlow is not initialized here (`yallaflow init`).');
    return;
  }
  const report = await assessWorkspace(root);
  const { state, work, memory, reconciliation } = report;
  const active = work.find((item) => item.id === state.activeWork) ?? null;
  const recent = work.filter((item) => item.id !== active?.id)
    .sort((a, b) => (a.updatedAt === b.updatedAt ? b.id.localeCompare(a.id) : (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')))[0] ?? null;
  const done = work.filter((item) => item.status === 'DONE').length;

  console.log(`YallaFlow Brief — ${report.project.name ?? 'project'}${report.project.kind ? ` (${report.project.kind})` : ''}`);
  console.log(`Package: ${report.packageVersion} · Agent contract: ${report.agent.state === 'current' ? `v${report.agent.version} current` : describeAgentContractState(report.agent)}`);
  console.log(`Active work: ${active ? `${active.id} — ${active.title ?? active.type ?? 'work'} (${state.stage ?? active.status ?? 'pending routing'})` : 'none'}`);
  if (recent) console.log(`Most recent work: ${recent.id} ${recent.status ?? (recent.routingStatus === 'pending' ? 'PENDING' : '')} — ${recent.title ?? recent.rawRequest ?? ''}`.trimEnd());
  console.log(`Work items: ${work.length} (${done} DONE)`);
  if (memory.unreadable) {
    console.log(`Project memory: not read — ${report.plan[0].detail}`);
  } else if (memory.exists) {
    const revalidate = memory.ledger.facts.filter((fact) => needsRevalidation(fact, memory.freshness.get(fact.id))).length;
    console.log(`Project memory: ${memory.totals.current} current (${memory.totals.fresh} fresh) · ${memory.totals.disputed} disputed · ${revalidate} to revalidate`);
  } else {
    console.log('Project memory: no canonical ledger yet');
  }
  if (report.pendingLegacy.length) console.log(`Legacy context: ${report.pendingLegacy.length} fact(s) pending reconciliation`);
  if (reconciliation) console.log(`Reconciliation: ${reconciliation.meta.id} — ${reconciliation.counts.decided}/${reconciliation.counts.total} decided, ${reconciliation.counts.applied} applied, review ${reconciliation.review}${reconciliation.blockers.length ? `; blockers: ${reconciliation.blockers.join('; ')}` : ''}`);
  console.log(`Sources: ${report.sources.length}${report.sources.length ? ` (latest ${report.sources.at(-1).id})` : ''}`);
  if (report.doctor.failures.length) console.log(`Integrity: ${report.doctor.failures.length} doctor check(s) failing`);

  const concern = primaryConcern(report, active);
  console.log(`\nPrimary next concern: ${concern.text}`);
  console.log(`Next: ${concern.command}`);
  console.log('\nRead .yallaflow/AGENT.md (agent contract) and .yallaflow/PROJECT.md, then only the context relevant to the request.');
  console.log('YallaFlow state is changed only through yallaflow commands — never edit .yallaflow structured state by hand.');
}

function primaryConcern(report, active) {
  if (report.memory.unreadable) return { text: 'the project context ledger uses a schema this CLI does not support', command: 'upgrade YallaFlow, then yallaflow doctor' };
  if (report.doctor.failures.length) return { text: `${report.doctor.failures.length} structural integrity failure(s)`, command: 'yallaflow doctor' };
  if (active?.reconciliation && report.reconciliation) return { text: 'reconcile legacy project context', command: report.reconciliation.nextAction };
  if (active) return { text: `continue ${active.id}`, command: `yallaflow resume ${active.id}` };
  if (report.agent.state !== 'current') return { text: 'agent contract is not current', command: report.plan.find((step) => step.title.includes('Agent') || step.title.includes('package'))?.command ?? 'yallaflow agent status' };
  if (report.reconciliation) return { text: 'legacy context reconciliation in progress', command: report.reconciliation.nextAction };
  if (report.pendingLegacy.length) return { text: 'legacy context reconciliation available', command: 'yallaflow context reconcile start' };
  if (report.memory.exists && report.memory.revalidate.length) return { text: `${report.memory.revalidate.length} project fact(s) may be stale or disputed`, command: 'yallaflow context status' };
  return { text: 'none — ready for new work', command: 'yallaflow start "<request>"' };
}
