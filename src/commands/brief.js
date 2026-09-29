import { findProjectRoot } from '../core/workspace.js';
import { assessWorkspace } from '../core/assessment.js';
import { describeAgentContractState } from '../agent/contract.js';
import { needsRevalidation } from '../context/freshness.js';
import { needsCare, oneLine } from '../context/summary.js';
import { AREA_LABELS } from '../context/constants.js';
import { BOOTSTRAP_PROVIDERS } from '../agent/bootstrap.js';
import { loadDeliverySummary } from '../delivery/summary.js';
import { baselineNextStep, findBaselineWork } from '../baseline/store.js';
import { classifyProject, inventoryRepository } from '../inventory/inventory.js';

// Project-first brief (v0.3.9): fixed area order, fixed per-area caps, fact-ID order
// within an area, no ranking, no ledger field. Conventions and business rules show a
// count plus one sample. NEEDS CARE is bounded separately.
export const BRIEF_AREAS = Object.freeze([
  ['project', 3], ['tech-stack', 3], ['architecture', 3], ['database', 2], ['integration', 2], ['environment', 2]
].map(([area, limit]) => [area, AREA_LABELS[area], limit]));
export const BRIEF_SAMPLED_AREAS = Object.freeze(['convention', 'business-rule'].map((area) => [area, AREA_LABELS[area]]));
export const BRIEF_NEEDS_CARE_LIMIT = 5;
export const BRIEF_MAX_LINES = 45;

const byFactId = (a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4));

// Fresh-agent orientation: one deterministic, read-only command that says what the
// project is (from canonical project memory), where the work stands, and the one next
// command. It never dumps the whole ledger and does not replace resume/handoff/guide.
export async function briefCommand() {
  const root = await findProjectRoot();
  if (!root) {
    console.log('No .yallaflow workspace in this directory or any parent. YallaFlow is not initialized here (`yallaflow inspect`, then `yallaflow init`).');
    return;
  }
  const report = await assessWorkspace(root);
  const { state, work, memory, reconciliation } = report;
  const active = work.find((item) => item.id === state.activeWork) ?? null;
  const recent = work.filter((item) => item.id !== active?.id)
    .sort((a, b) => (a.updatedAt === b.updatedAt ? b.id.localeCompare(a.id) : (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')))[0] ?? null;
  const done = work.filter((item) => item.status === 'DONE').length;
  const lines = [];
  // Every printed entry is exactly one physical line: embedded newlines in stored text
  // (a pasted multi-line request, a title) are collapsed, keeping leading indentation.
  const out = (line) => lines.push(String(line).replace(/\s*[\r\n]+\s*/g, ' ').trimEnd());
  const title = (item) => oneLine(item.title ?? item.rawRequest ?? item.type ?? 'work');

  out(`YallaFlow Brief — ${report.project.name ?? 'project'}${report.project.kind ? ` (${report.project.kind})` : ''}`);
  out('');

  // Project knowledge first.
  const onboarding = memory.exists || memory.unreadable ? null : await onboardingState(root, report);
  if (memory.unreadable) {
    out(`Project memory: not read — ${report.plan[0].detail}`);
  } else if (memory.exists) {
    projectBlock(memory).forEach(out);
  } else {
    out('Project memory: no canonical ledger yet');
    const { inventory, classification } = onboarding;
    out(`Repository: ${classification.kind} by inventory — ${inventory.manifests.length} manifest(s), ${inventory.sourceFiles.total} recognized source file(s), ${inventory.documents.total} documentation candidate(s)${report.project.kind && report.project.kind !== classification.kind ? `; recorded kind ${report.project.kind}` : ''} (details: yallaflow inspect)`);
    if (onboarding.baseline) out(`Baseline: ${onboarding.baseline.step.text}`);
  }
  out('');

  // Work.
  out(`Active work: ${active ? `${active.id} — ${oneLine(active.title ?? active.type ?? 'work')} (${state.stage ?? active.status ?? 'pending routing'})` : 'none'}`);
  if (recent) out(`Most recent work: ${recent.id} ${recent.status ?? (recent.routingStatus === 'pending' ? 'PENDING' : '')} — ${title(recent)}`);
  out(`Work items: ${work.length} (${done} DONE) · Sources: ${report.sources.length}${report.sources.length ? ` (latest ${report.sources.at(-1).id})` : ''}`);
  const delivery = active ? await loadDeliverySummary(root, active) : { applies: false, lines: [] };
  if (delivery.applies) out(`Delivery (${active.id}): ${delivery.lines.slice(0, 2).join(' — ').replace(/^Delivery intent: /, '')}${delivery.pendingImpact ? ` — impact ${delivery.pendingImpact.id} pending` : ''}`);
  if (reconciliation) out(`Reconciliation: ${reconciliation.meta.id} — ${reconciliation.counts.decided}/${reconciliation.counts.total} decided, ${reconciliation.counts.applied} applied, review ${reconciliation.review}${reconciliation.blockers.length ? `; blockers: ${reconciliation.blockers.join('; ')}` : ''}`);
  else if (report.pendingLegacy.length) out(`Legacy context: ${report.pendingLegacy.length} fact(s) pending reconciliation`);

  // YallaFlow status last.
  const installed = report.bootstraps.filter((item) => !['not-installed', 'shared'].includes(item.state));
  out(`Package: ${report.packageVersion} · Agent contract: ${report.agent.state === 'current' ? `v${report.agent.version} current` : describeAgentContractState(report.agent)} · Agent bootstrap: ${installed.length ? installed.map((item) => `${item.file} ${item.state}`).join(', ') : `none (optional: yallaflow agent setup ${Object.keys(BOOTSTRAP_PROVIDERS).join('|')})`}`);
  if (report.doctor.failures.length) out(`Integrity: ${report.doctor.failures.length} doctor check(s) failing`);

  const concern = await primaryConcern(root, report, active, delivery, onboarding);
  const body = lines.splice(0);
  out('');
  out(`Primary next concern: ${concern.text}`);
  out(`Next: ${concern.command}`);
  out('Read .yallaflow/AGENT.md (agent contract) and .yallaflow/PROJECT.md, then only the context relevant to the request. YallaFlow state is changed only through yallaflow commands — never edit .yallaflow structured state by hand.');
  const tail = lines.splice(0);
  // Hard cap: the concern, next command, and contract pointer are always kept.
  const room = BRIEF_MAX_LINES - tail.length;
  const shown = body.length > room ? [...body.slice(0, room - 1), '… (brief truncated; see yallaflow context status and yallaflow status)'] : body;
  console.log([...shown, ...tail].join('\n'));
}

function projectBlock(memory) {
  const lines = [];
  const revalidate = memory.ledger.facts.filter((fact) => needsRevalidation(fact, memory.freshness.get(fact.id))).length;
  lines.push(`Project memory: ${memory.totals.current} current (${memory.totals.fresh} fresh) · ${memory.totals.disputed} disputed · ${revalidate} to revalidate`);
  const care = needsCare(memory);
  const flagged = new Set(care.map((entry) => entry.fact.id));
  const current = (area) => memory.ledger.facts.filter((fact) => fact.area === area && fact.state === 'current').sort(byFactId);
  const entry = (fact) => `${fact.id}${flagged.has(fact.id) ? ' [needs care]' : ''} ${oneLine(fact.summary)}`;
  for (const [area, label, limit] of BRIEF_AREAS) {
    const facts = current(area);
    if (!facts.length) continue;
    lines.push(`${label} (${facts.length}${facts.length > limit ? `, showing ${limit}` : ''}):`);
    for (const fact of facts.slice(0, limit)) lines.push(`  - ${entry(fact)}`);
  }
  for (const [area, label] of BRIEF_SAMPLED_AREAS) {
    const facts = current(area);
    if (facts.length) lines.push(`${label} (${facts.length}): ${entry(facts[0])}${facts.length > 1 ? ` (+${facts.length - 1} more)` : ''}`);
  }
  if (!care.length) {
    lines.push('NEEDS CARE: none — no fact is unresolved, disputed, MAY_BE_STALE, or STALE_EVIDENCE.');
  } else {
    const shown = care.slice(0, BRIEF_NEEDS_CARE_LIMIT);
    lines.push(`NEEDS CARE (${care.length}${care.length > shown.length ? `, showing ${shown.length}; all: yallaflow context status` : ''}) — recorded state or evidence freshness mechanically needs attention; not a risk assessment:`);
    for (const { fact, flags } of shown) lines.push(`  - ${fact.id} [${fact.area}] ${flags.join(', ')} — ${oneLine(fact.summary)}`);
  }
  return lines;
}

// Only computed when there is no project memory yet: the bounded inventory and any
// existing baseline, so the brief can say what the repository is and how to onboard.
async function onboardingState(root) {
  const inventory = await inventoryRepository(root);
  const classification = classifyProject(inventory);
  const meta = await findBaselineWork(root);
  const baseline = meta ? { meta, step: await baselineNextStep(root, meta) } : null;
  return { inventory, classification, baseline };
}

async function primaryConcern(root, report, active, delivery, onboarding) {
  if (report.memory.unreadable) return { text: 'the project context ledger uses a schema this CLI does not support', command: 'upgrade YallaFlow, then yallaflow doctor' };
  if (report.doctor.failures.length) return { text: `${report.doctor.failures.length} structural integrity failure(s)`, command: 'yallaflow doctor' };
  if (active?.reconciliation && report.reconciliation) return { text: 'reconcile legacy project context', command: report.reconciliation.nextAction };
  if (active && delivery?.pendingImpact) return { text: `assess impact ${delivery.pendingImpact.id} on ${active.id} (its approved intent changed)`, command: `yallaflow impact status ${active.id}` };
  if (active?.baseline) {
    const step = await baselineNextStep(root, active);
    return { text: step.text, command: step.command };
  }
  if (active) return { text: `continue ${active.id}`, command: `yallaflow resume ${active.id}` };
  if (report.agent.state !== 'current') return { text: 'agent contract is not current', command: report.plan.find((step) => step.title.includes('Agent') || step.title.includes('package'))?.command ?? 'yallaflow agent status' };
  const staleBootstrap = report.bootstraps.find((item) => ['outdated', 'modified', 'newer'].includes(item.state));
  if (staleBootstrap) return { text: `${staleBootstrap.file} agent bootstrap is ${staleBootstrap.state}`, command: report.plan.find((step) => step.title.includes(staleBootstrap.file) || step.title.includes('package'))?.command ?? 'yallaflow agent status' };
  if (report.reconciliation) return { text: 'legacy context reconciliation in progress', command: report.reconciliation.nextAction };
  if (report.pendingLegacy.length) return { text: 'legacy context reconciliation available', command: 'yallaflow context reconcile start' };
  if (onboarding?.baseline && onboarding.baseline.step.state !== 'approved') return { text: onboarding.baseline.step.text, command: onboarding.baseline.step.command };
  if (onboarding && !onboarding.baseline && (onboarding.classification.kind === 'brownfield' || report.project.kind === 'brownfield')) {
    return { text: 'no project memory yet — establish an evidence-backed Brownfield baseline (yallaflow inspect first; a human approves the draft)', command: 'yallaflow baseline start' };
  }
  if (report.memory.exists && report.memory.revalidate.length) return { text: `${report.memory.revalidate.length} project fact(s) may be stale or disputed`, command: 'yallaflow context status' };
  return { text: 'none — ready for new work', command: 'yallaflow start "<request>"' };
}
