import { findProjectRoot, getCurrentState, listWork, loadWorkMetaOrThrow } from '../core/workspace.js';
import { latestVerification } from '../core/evidence.js';
import { loadWorkKnowledge } from '../knowledge/store.js';
import { loadContextLedger } from '../context/ledger.js';
import { collectDoctorReport } from './doctor.js';
import { checkProjectCompatibility, describeCompatibility, loadSharedPolicy } from '../shared/config.js';
import { currentBranch, uncommittedPaths } from '../shared/git.js';
import { diffAgainstBase, loadWorkMemory, planSharedIntegration } from '../shared/memory.js';
import { shortFingerprint, ledgerFingerprint } from '../shared/fingerprint.js';

// `yallaflow finish [work-id]` (v0.3.10) — the Agent's completion protocol in one
// read-only answer to "may I tell the developer this is ready to push?".
//
// The default output is for the developer: plain outcome language, no internal IDs.
// --verbose adds the audit detail (work, verification, staged knowledge, memory base).
// Exit code 1 when the work is not ready. YallaFlow never commits or pushes.
export async function finishCommand(requestedWorkId, { verbose = false } = {}) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const state = await getCurrentState(root);
  let workId = requestedWorkId ?? state.activeWork;
  if (!workId) {
    const recent = (await listWork(root)).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0];
    workId = recent?.id;
  }
  if (!workId) throw new Error('No work item to finish. Provide a work ID: yallaflow finish <work-id>.');
  const meta = await loadWorkMetaOrThrow(root, workId);
  const report = await assessFinish(root, meta);

  for (const line of report.developer) console.log(line);
  if (!report.ready && report.agent.length) {
    console.log('\nFor the agent:');
    for (const step of report.agent) console.log(`  - ${step}`);
  }
  if (verbose) {
    console.log('\nDetail:');
    for (const line of report.detail) console.log(`  ${line}`);
  }
  if (!report.ready) process.exitCode = 1;
}

export async function assessFinish(root, meta) {
  const developer = [];
  const agent = [];
  const detail = [`work: ${meta.id} (${meta.type ?? 'pending'} / ${meta.scope ?? '-'}) at ${meta.status ?? 'PENDING'}`];
  let ready = true;
  const block = (developerLine, agentStep) => {
    ready = false;
    if (developerLine && !developer.includes(developerLine)) developer.push(developerLine);
    if (agentStep) agent.push(agentStep);
  };

  const compat = await checkProjectCompatibility(root);
  if (!compat.compatible) {
    block(`This project needs a newer YallaFlow (${describeCompatibility(compat)}). Please install a compatible version, then ask me to continue.`, null);
    return { ready, developer, agent, detail };
  }

  if (meta.routingStatus === 'pending' || meta.status !== 'DONE') {
    block('Not finished yet — the task is still in progress.', `yallaflow guide ${meta.id} (current stage: ${meta.status ?? 'awaiting routing'})`);
  } else {
    const verification = await latestVerification(root, meta.id);
    if (verification) detail.push(`verification: ${verification.id ?? 'recorded'} ${verification.success ? 'passed' : 'failed'} at ${verification.verifiedAt}`);
  }

  const doctor = await collectDoctorReport(root);
  const failures = doctor.checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (failures.length) block('Project state has an integrity problem I need to fix first.', `yallaflow doctor (${failures.length} failing check(s), e.g. ${failures[0]})`);

  const policy = await loadSharedPolicy(root);
  let knowledgeLine = 'The project knowledge is up to date.';
  if (policy.enabled) {
    const { ledger } = await loadContextLedger(root);
    const { record } = await loadWorkMemory(root, meta.id);
    if (record) {
      const diff = diffAgainstBase(record.contextBase, ledger);
      detail.push(`memory base: ${shortFingerprint(record.contextBase.ledgerFingerprint)} → current ${shortFingerprint(ledgerFingerprint(ledger))}${diff.unchanged ? ' (unchanged)' : ` (${diff.changed.length} changed, ${diff.added.length} added since this work began)`}`);
    }
    const { plan } = await planSharedIntegration(root);
    const mine = plan.items.filter((item) => item.workId === meta.id);
    const blocked = mine.filter((item) => item.action === 'blocked');
    for (const item of mine) detail.push(`staged ${item.candidateId}: ${item.action}${item.blockers.length ? ` — ${item.blockers.map((entry) => entry.message).join('; ')}` : ''}`);
    if (blocked.length) {
      block('Shared project knowledge changed while this task was in progress. I need to revalidate it against the current project memory before this is ready to push.',
        `revalidate ${blocked.map((item) => item.candidateId).join(', ')} of ${meta.id}: yallaflow knowledge reject ${meta.id} --candidate <K-###> --reason "...", then propose against the current fact (yallaflow context show <CTX-id>) and promote again`);
    } else if (mine.length) {
      if (currentBranch(root) === policy.integrationBranch) {
        block(null, 'yallaflow shared integrate (this checkout is the integration branch)');
        if (!developer.length) developer.push('Almost done — the new project knowledge still has to be added to the shared project memory.');
      } else {
        knowledgeLine = 'New project knowledge from this task will join the shared project memory after it is merged.';
      }
    }
    const knowledge = await loadWorkKnowledge(root, meta);
    const integrated = knowledge.ledger.candidates.filter((candidate) => candidate.status === 'promoted' && candidate.factId).length;
    if (integrated) detail.push(`integrated knowledge: ${integrated} candidate(s)`);
  }

  if (ready) {
    developer.push(`${meta.readOnly ? 'Completed and verified' : 'Implemented and verified'}. ${knowledgeLine}`);
    const dirty = uncommittedPaths(root);
    if (dirty?.length) developer.push(`${dirty.length} changed file(s) are not committed yet — commit them, then push.`);
    developer.push('Ready to push.');
  }
  return { ready, developer, agent, detail };
}
