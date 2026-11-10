// Merge (PF-0112 M3, FR22–FR29): executes an approved Review & Merge plan, step by step.
//
// - Approval is bound to the plan hash (D8). Before anything is committed the plan is
//   prepared again; any difference stops for a fresh approval.
// - Three-way merging happens only in objects (merge-tree + commit-tree); checkouts only
//   fast-forward, to a merge commit that was tested in the lane first (A10).
// - A write-ahead journal records each step before and after it runs. Every step first checks
//   whether its effect is already there, so Continue after a crash never repeats a step.
// - Nothing is rolled back or repaired automatically: no reset, revert, checkout, lock
//   removal or retried mutation (A1). A failure stops in a non-verified state with guidance.
// - MERGED & VERIFIED only after the fast-forward, the post-merge checks, knowledge
//   integration, the integration record and the knowledge commit all succeeded (FR28).
// - One merge at a time per home checkout (in-process queue plus a lock file across consoles).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { safeLocalDir, safeWriteFile } from '../agents/local-files.js';
import { ensureLocalIgnored } from '../agents/bridge.js';
import { createLockFile, liveness, lockRecord, removeStaleLock, withWorkspaceLock } from '../utils/lock.js';
import { createHash } from 'node:crypto';
import { redactSecrets } from '../security/redact.js';
import { integrateSharedMemory, loadWorkMemory } from '../shared/memory.js';
import * as gitops from './git-ops.js';
import { OWNED_AFTER_MERGE, homeBlockers, prepareReview } from './review.js';
import { readLanes } from './lanes.js';
import { recordIntegration } from './integration.js';

export const STEPS = Object.freeze(['revalidate', 'lane-commit', 'merge-commit', 'lane-ff', 'checks', 'integration-preview', 'target-ff', 'post-merge', 'knowledge', 'record', 'knowledge-commit']);
const AFTER_TARGET = new Set(['post-merge', 'knowledge', 'record', 'knowledge-commit']);
const CHECK_TIMEOUT_MS = 30 * 60_000;
const PAST = { introduce: 'introduced', supersede: 'superseded', reconfirm: 'reconfirmed', dispute: 'disputed', 'merge-duplicate': 'merged-duplicate' };
const key = (items) => items.map((item) => `${item.workId} ${item.candidateId}`).sort();
const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
// Review L13/L15: only these journal states let a lane be approved again.
const FINISHED = new Set(['verified', 'abandoned']);
export const AUTOMATED_MERGE_OFF = 'Automated merge is turned off in YallaFlow 1.5.0: its checks cannot yet run on exactly the merged content apart from files the lane\'s agent controls. Merge by hand with the steps shown.';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

class Stop extends Error {
  constructor(state, reason) {
    super(reason);
    this.state = state;
  }
}

async function journalDir(home) {
  await ensureLocalIgnored(home);
  return safeLocalDir(home, '.yallaflow', 'local', 'execution', 'merges');
}
async function saveJournal(home, journal) {
  journal.updatedAt = new Date().toISOString();
  await safeWriteFile(await journalDir(home), `${journal.id}.json`, `${JSON.stringify(journal, null, 1)}\n`);
}
export async function listJournals(home) {
  const dir = path.join(home, '.yallaflow', 'local', 'execution', 'merges');
  let names = [];
  try { names = (await readdir(dir)).filter((name) => /^m-[0-9a-f]{8}\.json$/.test(name)); } catch { return []; }
  const journals = [];
  for (const name of names) {
    try { journals.push(JSON.parse(await readFile(path.join(dir, name), 'utf8'))); } catch { journals.push({ id: name.replace(/\.json$/, ''), state: 'unreadable' }); }
  }
  return journals.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function runCheck(cwd, argv) {
  return new Promise((resolve) => {
    const started = Date.now();
    const env = gitops.gitEnv();
    let out = '';
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, env, shell: false });
    } catch (error) {
      resolve({ exitCode: 127, durationMs: 0, tail: String(error.message) });
      return;
    }
    const timer = setTimeout(() => child.kill('SIGTERM'), CHECK_TIMEOUT_MS);
    const keep = (chunk) => { out = `${out}${chunk}`.slice(-4000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', (error) => { clearTimeout(timer); resolve({ exitCode: 127, durationMs: Date.now() - started, tail: redactSecrets(error.message) }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ exitCode: code ?? (signal ? 128 : 1), durationMs: Date.now() - started, tail: redactSecrets(out.slice(-1500)) }); });
  });
}

export class MergeService {
  // cli(root, args) → { status, stdout, stderr } runs this package's own CLI (doctor, shared check);
  // context(home, laneRecord) → { session, pending, items } for the lane (from the console).
  // `afterStep(name)` is a test seam only: throwing { crash: true } from it simulates the console
  // process dying right after a step's effect (the journal still says the step is running).
  // `automatedMerge`: off in YallaFlow 1.5.0 (owner rule after the final security review,
  // 2026-11-10): the checks cannot yet run on exactly the merged content, apart from files the
  // lane's agent controls (.yallaflow/local/, folders named .git). Review stays available and the
  // manual steps are shown; approve and continue refuse (fail closed). Tests of the merge engine
  // turn it on explicitly.
  constructor({ cli, context, broadcast = () => {}, approverName = () => 'console user', afterStep = null, automatedMerge = false }) {
    this.cli = cli;
    this.automatedMerge = automatedMerge === true;
    this.afterStep = afterStep;
    this.context = context;
    this.broadcast = broadcast;
    this.approverName = approverName;
    this.chains = new Map();
  }

  async lane(home, laneId) {
    const record = (await readLanes(home)).find((entry) => entry.id === laneId && entry.state !== 'removed');
    if (!record) throw fail(404, 'NOT_FOUND', 'Unknown lane.');
    return record;
  }

  async prepare(home, laneId, { exclude = [], include = [], checksInclude = [], message = null } = {}) {
    const record = await this.lane(home, laneId);
    const ctx = await this.context(home, record);
    return prepareReview({ home, laneId, items: ctx.items, session: ctx.session, pending: ctx.pending, exclude, include, checksInclude, message, automatedMerge: this.automatedMerge });
  }

  // Approve & merge: the plan is prepared again and must hash to what the developer saw.
  async approve(home, laneId, { planHash, exclude = [], include = [], checksInclude = [], message = null, consentScripts = false, acceptMinimumVersion = null } = {}) {
    if (!this.automatedMerge) throw fail(409, 'AUTOMATED_MERGE_OFF', AUTOMATED_MERGE_OFF);
    if (consentScripts !== true) throw fail(400, 'CONFIRMATION_REQUIRED', 'Tick the confirmation: it approves the commit, the merge and running the listed checks.');
    const review = await this.prepare(home, laneId, { exclude, include, checksInclude, message });
    if (!review.ok) throw Object.assign(fail(409, 'NOT_READY', review.readiness.filter((entry) => !entry.ok).map((entry) => entry.text).join(' ')), { extra: { review } });
    if (review.planHash !== planHash) throw Object.assign(fail(409, 'PLAN_CHANGED', 'What would be merged changed since you reviewed it. Review it again.'), { extra: { review } });
    const journals = await listJournals(home);
    if (journals.some((entry) => entry.state === 'unreadable')) throw fail(409, 'JOURNAL_UNREADABLE', 'A merge record in .yallaflow/local/execution/merges/ is unreadable; look at it first.');
    if (journals.some((entry) => entry.plan?.lane?.id === laneId && !FINISHED.has(entry.state))) throw fail(409, 'ALREADY_MERGING', 'This lane already has a merge that is not finished. Continue it or abandon it first.');
    const journal = {
      schema: 'yallaflow.merge/1', id: `m-${randomBytes(4).toString('hex')}`, createdAt: new Date().toISOString(), state: 'queued',
      plan: review.plan, planHash, exclude, include, checksInclude, message, approval: { by: this.approverName(home), at: new Date().toISOString(), planHash, consentScripts: true, acceptMinimumVersion },
      steps: STEPS.map((name) => ({ name, state: 'todo' })), results: {}
    };
    await saveJournal(home, journal);
    this.enqueue(home, journal.id);
    return { id: journal.id, state: journal.state };
  }

  enqueue(home, id) {
    const previous = this.chains.get(home) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.execute(home, id)).catch(async (error) => {
      // Review M13: a merge that could not take the lock (or failed before its first step) never
      // stays queued: it becomes interrupted with the reason, so Continue or Abandon work.
      const journal = (await listJournals(home)).find((entry) => entry.id === id);
      if (journal && journal.state === 'queued') {
        journal.state = 'interrupted';
        journal.reason = String(error?.message ?? error).slice(0, 400);
        await saveJournal(home, journal).catch(() => {});
        this.broadcast(home);
      }
      throw error;
    });
    this.chains.set(home, next.catch(() => {}));
    return next;
  }

  async continue(home, id) {
    if (!this.automatedMerge) throw fail(409, 'AUTOMATED_MERGE_OFF', AUTOMATED_MERGE_OFF);
    const journal = (await listJournals(home)).find((entry) => entry.id === id);
    if (!journal) throw fail(404, 'NOT_FOUND', 'Unknown merge.');
    if (!['interrupted', 'failed', 'merged-not-verified'].includes(journal.state) || journal.noContinue) throw fail(409, 'NOT_RESUMABLE', journal.noContinue ? 'This merge stopped on something YallaFlow cannot check again safely; look at the reason, then abandon it.' : `This merge is ${journal.state}.`);
    journal.state = 'queued';
    await saveJournal(home, journal);
    this.enqueue(home, id);
    return { id, state: 'queued' };
  }

  async abandon(home, id) {
    const journal = (await listJournals(home)).find((entry) => entry.id === id);
    if (!journal) throw fail(404, 'NOT_FOUND', 'Unknown merge.');
    if (['merging', 'queued', 'verified', 'unreadable'].includes(journal.state)) throw fail(409, 'NOT_ABANDONABLE', journal.state === 'unreadable' ? 'This merge record is unreadable; look at it in .yallaflow/local/execution/merges/ yourself.' : `This merge is ${journal.state}.`);
    journal.state = 'abandoned';
    journal.reason = 'Abandoned by you; nothing was undone.';
    await saveJournal(home, journal);
    return { id, state: 'abandoned', done: journal.steps.filter((step) => step.state === 'done').map((step) => step.name) };
  }

  // After a console restart: a merge that was running is interrupted; nothing continues by itself.
  // Review M2: never while another console holds the merge lock (it may be merging right now).
  async recover(home) {
    const holder = JSON.parse(await readFile(path.join(home, '.yallaflow', 'local', 'execution', 'merge.lock'), 'utf8').catch(() => 'null'));
    if (holder && !liveness(holder).stale) return;
    for (const journal of await listJournals(home)) {
      if (['merging', 'queued', 'merged'].includes(journal.state)) { // in flight: 'merged' is not yet verified
        journal.state = 'interrupted';
        journal.reason = 'The console stopped during the merge. Continue re-checks everything first.';
        await saveJournal(home, journal);
      }
    }
  }

  async withLock(home, fn) {
    const dir = await safeLocalDir(home, '.yallaflow', 'local', 'execution');
    const file = path.join(dir, 'merge.lock');
    const nonce = randomBytes(8).toString('hex');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await createLockFile(file, lockRecord('yallaflow console merge', nonce));
        try { return await fn(); } finally { await import('node:fs/promises').then(({ rm }) => rm(file, { force: true })); }
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const holder = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'));
        if (!liveness(holder).stale) throw fail(409, 'MERGE_LOCKED', `Another YallaFlow console (pid ${holder.pid}) is merging in this project.`);
        await removeStaleLock(file, holder);
      }
    }
    throw fail(409, 'MERGE_LOCKED', 'The merge lock could not be taken.');
  }

  async execute(home, id) {
    await this.withLock(home, async () => {
      const journal = (await listJournals(home)).find((entry) => entry.id === id);
      if (!journal || journal.state !== 'queued') return;
      journal.state = 'merging';
      journal.reason = null;
      await saveJournal(home, journal);
      this.broadcast(home);
      for (const step of journal.steps) {
        if (step.state === 'done') continue;
        step.state = 'running';
        step.startedAt = new Date().toISOString();
        await saveJournal(home, journal);
        this.broadcast(home);
        try {
          step.detail = await this.step(home, journal, step.name);
          if (this.afterStep) await this.afterStep(step.name);
          step.state = 'done';
          step.endedAt = new Date().toISOString();
          if (step.name === 'target-ff') journal.state = 'merged';
          await saveJournal(home, journal);
        } catch (error) {
          if (error?.crash) throw error; // simulated process death: nothing more is written
          let moved = false;
          try { moved = Boolean(journal.results.merge) && gitops.head(home) === journal.results.merge; } catch { /* unknown: treated as not moved */ }
          const after = AFTER_TARGET.has(step.name) || journal.steps.find((entry) => entry.name === 'target-ff').state === 'done' || moved;
          if (error?.noContinue) journal.noContinue = true;
          step.state = 'stopped';
          step.endedAt = new Date().toISOString();
          step.detail = String(error.message).slice(0, 800);
          journal.state = error instanceof Stop && !(after && ['blocked', 'needs-approval'].includes(error.state)) ? error.state : after ? 'merged-not-verified' : 'failed';
          journal.reason = step.detail;
          if (after) journal.undo = `If you want to undo the merge yourself: git revert -m 1 ${journal.results.merge}`;
          if (step.name === 'knowledge-commit') journal.reason += ' The integration record in your working tree is not committed and the merge is not verified; do not commit it by hand.';
          await saveJournal(home, journal);
          this.broadcast(home);
          return;
        }
      }
      journal.state = 'verified';
      journal.verifiedAt = new Date().toISOString();
      await saveJournal(home, journal);
      this.broadcast(home);
    });
  }

  async step(home, journal, name) {
    const { plan, results } = journal;
    const lane = plan.lane.path;
    switch (name) {
      case 'revalidate': {
        if (results.laneCommit) return 'already past this point';
        const review = await this.prepare(home, plan.lane.id, { exclude: journal.exclude, include: journal.include ?? [], checksInclude: journal.checksInclude ?? [], message: journal.message });
        if (!review.ok) throw new Stop('blocked', review.readiness.filter((entry) => !entry.ok).map((entry) => entry.text).join(' '));
        if (review.planHash !== journal.planHash) throw new Stop('needs-approval', 'What would be merged changed since you approved it (D8). Review it again.');
        return 'plan unchanged';
      }
      case 'lane-commit': {
        const current = gitops.head(lane);
        // Resumed after this step: the recorded lane commit carries the approved tree on top of the
        // reviewed lane head and is still part of the lane (possibly below the merge commit).
        if (results.laneCommit && results.laneCommit !== plan.lane.head && gitops.isAncestor(lane, results.laneCommit, current) && gitops.treeOf(lane, results.laneCommit) === plan.approvedTree && gitops.parentsOf(lane, results.laneCommit).includes(plan.lane.head)) return 'already committed';
        if (current === plan.lane.head && plan.approvedTree === gitops.treeOf(lane, 'HEAD')) { results.laneCommit = current; return 'nothing to commit'; }
        if (current !== plan.lane.head) {
          // Already committed by an earlier run of this step?
          if (gitops.parentsOf(lane, current).includes(plan.lane.head) && gitops.treeOf(lane, current) === plan.approvedTree) { results.laneCommit = current; return 'already committed'; }
          throw new Stop('needs-approval', 'The lane moved since you approved it.');
        }
        const staged = await gitops.stageApproved({ home, cwd: lane, paths: plan.approved.map((entry) => entry.path) });
        if (staged !== plan.approvedTree) throw new Stop('blocked', 'The lane\'s staged content differs from what you approved (something else is staged there); nothing was committed.');
        results.laneCommit = await gitops.commitIndex({ home, cwd: lane, expectedTree: plan.approvedTree, message: plan.laneMessage });
        return results.laneCommit;
      }
      case 'merge-commit': {
        if (results.merge && gitops.treeOf(home, results.merge) === plan.mergedTree) return 'already created';
        const target = gitops.head(home);
        if (target !== plan.target.head) throw new Stop('needs-approval', `${plan.target.branch} moved since you approved (D8). Review it again.`);
        const preview = gitops.previewMerge(home, target, results.laneCommit);
        if (preview.result !== 'no-conflict' || preview.tree !== plan.mergedTree) throw new Stop(preview.result === 'conflict' ? 'blocked' : 'needs-approval', preview.result === 'conflict' ? `Conflicts: ${preview.conflicts.join(', ')}.` : 'The merged result differs from what you approved.');
        results.merge = await gitops.commitTree({ home, cwd: home, tree: plan.mergedTree, parents: [target, results.laneCommit], message: plan.mergeMessage });
        return results.merge;
      }
      case 'lane-ff':
        if (gitops.head(lane) === results.merge) return 'already there';
        await gitops.fastForward({ cwd: lane, to: results.merge, home });
        return results.merge;
      case 'checks': {
        // Review H8: the lane must hold exactly M (no uncommitted, untracked or hidden files),
        // so the checks see exactly what main will get. Ignored files (dependencies) stay.
        await gitops.assertLaneOf(home, lane);
        const extra = gitops.statusEntries(lane).filter((entry) => !entry.path.startsWith('.yallaflow/local/'));
        const hiddenLane = gitops.hiddenEntries(lane);
        const ignoredNow = gitops.statusEntries(lane, { ignored: true }).filter((entry) => entry.code === '!!' && !entry.path.startsWith('.yallaflow/local/')).map((entry) => entry.path).sort();
        if (plan.checks.some((check) => check.source !== 'declared')) throw new Stop('blocked', `Only the project's declared merge checks run; ${plan.target.branch} is unchanged.`);
        // Owner decision: never run checks next to agent-controlled ignored files (fail closed).
        if (ignoredNow.length) throw new Stop('blocked', `Files Git ignores appeared in the lane (${ignoredNow.slice(0, 5).join(', ')}); the checks would run next to them. ${plan.target.branch} is unchanged. Merge by hand instead.`);
        if (plan.laneIgnored && JSON.stringify(ignoredNow) !== JSON.stringify(plan.laneIgnored)) throw new Stop('needs-approval', `The files Git ignores in the lane changed since you approved (${ignoredNow.filter((entry) => !plan.laneIgnored.includes(entry)).concat(plan.laneIgnored.filter((entry) => !ignoredNow.includes(entry))).slice(0, 5).join(', ')}). Review it again.`);
        if (extra.length || hiddenLane.length) throw new Stop('blocked', `The lane has files that are not part of the merge (${[...extra.map((entry) => entry.path), ...hiddenLane].slice(0, 5).join(', ')}); the checks would not run on exactly what is merged. ${plan.target.branch} is unchanged.`);
        if (gitops.head(lane) !== results.merge) throw new Stop('blocked', 'The lane is not at the merge commit.');
        results.checks = [];
        for (const check of plan.checks) {
          const outcome = await runCheck(lane, check.argv);
          results.checks.push({ name: check.name, argv: check.argv, ...outcome });
          if (outcome.exitCode !== 0) throw new Stop('blocked', `The check "${check.name}" failed on the merged result (exit ${outcome.exitCode}); ${plan.target.branch} is unchanged.`);
        }
        return `${plan.checks.length} passed`;
      }
      case 'integration-preview': {
        const dry = await integrateSharedMemory(lane, { dryRun: true }).catch((error) => ({ error }));
        if (dry.error) throw new Stop('blocked', `Knowledge preview failed: ${dry.error.message}`);
        const mine = (items) => items.filter((item) => plan.workIds.includes(item.workId));
        if (mine(dry.blocked).length) throw new Stop('needs-approval', `Knowledge from this lane conflicts with project memory changed in parallel: ${mine(dry.blocked).map((item) => `${item.workId} ${item.candidateId}`).join(', ')}.`);
        const applicable = mine(dry.applicable).filter((item) => item.action !== 'already-applied');
        if (JSON.stringify(key(applicable)) !== JSON.stringify(key(plan.expectedKnowledge))) throw new Stop('needs-approval', 'The knowledge that would integrate differs from what you reviewed.');
        results.knowledgePreview = applicable.map((item) => ({ workId: item.workId, candidateId: item.candidateId, action: PAST[item.action] ?? item.action }));
        return `${applicable.length} item(s)`;
      }
      case 'target-ff': {
        if (gitops.head(home) === results.merge) return 'already there';
        // Resumed later: main already contains M (the knowledge commit sits on top of it).
        if (results.knowledgeCommit && gitops.head(home) === results.knowledgeCommit && gitops.parentsOf(home, results.knowledgeCommit)[0] === results.merge) return 'already there (with the knowledge commit on top)';
        if (gitops.head(home) !== plan.target.head) throw new Stop('needs-approval', `${plan.target.branch} moved since you approved (D8).`);
        if (gitops.currentBranch(home) !== plan.target.branch) throw new Stop('blocked', `The main checkout is no longer on ${plan.target.branch}.`);
        // Review H10: the main checkout's readiness is checked again right before it moves
        // (also on Continue): untracked or ignored files at added paths, overlaps, hidden entries.
        const { blockers } = await homeBlockers({ home, targetHead: plan.target.head, laneChanges: gitops.changedBetween(home, plan.target.head, plan.mergedTree), workIds: plan.workIds });
        if (blockers.length) throw new Stop('blocked', `${blockers.join(' ')} Nothing was changed.`);
        const before = await this.unrelatedHashes(home, plan);
        await gitops.fastForward({ cwd: home, to: results.merge });
        const after = await this.unrelatedHashes(home, plan);
        if (JSON.stringify(before) !== JSON.stringify(after)) throw Object.assign(new Error('Some of your unrelated uncommitted files changed during the fast-forward; stopped. Check them before doing anything else.'), { noContinue: true });
        return results.merge;
      }
      case 'post-merge':
        for (const args of [['doctor'], ['shared', 'check']]) {
          const result = await this.cli(home, args);
          if (result.status !== 0) throw new Error(`yallaflow ${args.join(' ')} did not pass after the merge: ${String(result.stdout || result.stderr).trim().split('\n').slice(-2).join(' ')}`);
        }
        const atMerge = gitops.head(home) === results.merge && gitops.treeOf(home, 'HEAD') === plan.mergedTree;
        const atKnowledge = results.knowledgeCommit && gitops.head(home) === results.knowledgeCommit && gitops.parentsOf(home, results.knowledgeCommit)[0] === results.merge;
        if (!atMerge && !atKnowledge) throw new Error('The main checkout is not at the merged result.');
        return 'doctor and shared check passed';
      case 'knowledge': {
        // Review M12: YallaFlow's own files must be clean before it writes them, so the knowledge
        // commit carries only what YallaFlow wrote.
        const owned = OWNED_AFTER_MERGE(plan.workIds);
        const dirty = gitops.statusEntries(home).map((entry) => entry.path).filter((entry) => owned.some((prefix) => entry === prefix || entry.startsWith(prefix)));
        if (dirty.length && !results.knowledgeStarted) throw new Stop('knowledge-needs-approval', `YallaFlow files changed in your main checkout during the merge (${dirty.slice(0, 5).join(', ')}); the code merge stands. Commit or undo those edits, then continue.`);
        results.knowledgeStarted = true;
        await saveJournal(home, journal);
        // Review M11/M15: only this lane's work items, under the workspace lock every CLI writer holds.
        const applied = await withWorkspaceLock(home, 'yallaflow console merge (knowledge)', () => integrateSharedMemory(home, { onlyWorkIds: plan.workIds }));
        if (applied.blocked.length) throw new Stop('knowledge-needs-approval', 'Knowledge integration found a parallel change; the code merge stands. Revalidate the knowledge.');
        // Review M14: what is integrated is read back from each work item's memory record, so a
        // re-run after a crash reports the same knowledge as the first run.
        const preview = key(results.knowledgePreview ?? []);
        const integrated = [];
        for (const workId of plan.workIds) {
          const { record } = await loadWorkMemory(home, workId).catch(() => ({ record: null }));
          for (const entry of record?.integrations ?? []) if (preview.includes(`${workId} ${entry.candidate}`)) integrated.push({ workId, candidateId: entry.candidate, factId: entry.factId ?? null, action: entry.action ?? null });
        }
        if (JSON.stringify(key(integrated)) !== JSON.stringify(preview)) throw new Stop('knowledge-needs-approval', 'The knowledge integrated differs from the preview; nothing was committed.');
        results.knowledge = integrated;
        return `${integrated.length} item(s)`;
      }
      case 'record':
        await withWorkspaceLock(home, 'yallaflow console merge (record)', async () => { for (const workId of plan.workIds) {
          await recordIntegration(home, workId, {
            merge: results.merge, tree: plan.mergedTree, base: plan.lane.base, target: plan.target.branch, lane: plan.lane.branch, planHash: journal.planHash,
            approvedBy: journal.approval.by, checks: (results.checks ?? []).map((check) => ({ name: check.name, argv: check.argv, exitCode: check.exitCode, durationMs: check.durationMs })),
            postMerge: { doctor: 'pass', sharedCheck: 'pass' }, knowledge: (results.knowledge ?? []).map((item) => ({ candidate: item.candidateId, factId: item.factId ?? null, action: item.action })), state: 'verified'
          }, { acceptMinimumVersion: journal.approval.acceptMinimumVersion });
        } });
        // Review M12: exactly the files YallaFlow wrote, with their content, for the knowledge commit.
        results.written = {};
        for (const entry of gitops.statusEntries(home)) {
          if (!OWNED_AFTER_MERGE(plan.workIds).some((prefix) => entry.path === prefix || entry.path.startsWith(prefix))) continue;
          results.written[entry.path] = await readFile(path.join(home, entry.path)).then(sha256, () => null);
        }
        return 'recorded';
      case 'knowledge-commit': {
        const owned = OWNED_AFTER_MERGE(plan.workIds);
        const paths = gitops.statusEntries(home).map((entry) => entry.path).filter((entry) => owned.some((prefix) => entry === prefix || entry.startsWith(prefix)));
        if (!paths.length) return 'nothing to commit';
        const written = results.written ?? {};
        for (const entry of paths) {
          const now = await readFile(path.join(home, entry)).then(sha256, () => null);
          if (!(entry in written) || written[entry] !== now) throw new Error(`${entry} changed after YallaFlow wrote its records; the knowledge commit was not made. Look at it first.`);
        }
        const expected = await gitops.approvedTree({ home, lane: home, paths });
        const staged = await gitops.stageApproved({ home, cwd: home, paths });
        if (staged !== expected) throw new Error('Something else is staged in your main checkout; the knowledge commit was not made.');
        results.knowledgeCommit = await withWorkspaceLock(home, 'yallaflow console merge (commit)', () => gitops.commitIndex({ home, cwd: home, expectedTree: expected, message: `chore(yallaflow): integrate ${plan.workIds.join(', ')} knowledge\n\nYallaFlow-Work: ${plan.workIds.join(', ')}\n` }));
        const changed = gitops.changedBetween(home, results.merge, results.knowledgeCommit);
        if (changed.some((entry) => !owned.some((prefix) => entry === prefix || entry.startsWith(prefix)))) throw new Error('The knowledge commit touched a file outside YallaFlow\'s own records.');
        return results.knowledgeCommit;
      }
      default:
        throw new Error(`Unknown step ${name}.`);
    }
  }

  // Hashes of the developer's unrelated uncommitted files in the home checkout (AC-025).
  async unrelatedHashes(home, plan) {
    const { createHash } = await import('node:crypto');
    const hashes = {};
    for (const entry of gitops.statusEntries(home)) {
      if (OWNED_AFTER_MERGE(plan.workIds).some((prefix) => entry.path.startsWith(prefix))) continue;
      try { hashes[entry.path] = createHash('sha256').update(await readFile(path.join(home, entry.path))).digest('hex'); } catch { hashes[entry.path] = null; }
    }
    return hashes;
  }
}
