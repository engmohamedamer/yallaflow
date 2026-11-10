// Review (PF-0112 M3, FR20–FR22): everything the developer sees before approving a lane's
// merge, computed read-only or object-only — no ref, index or working tree changes. The plan's
// hash binds the approval to the exact reviewed content (D8): the approved tree A, the merged
// tree T, the merge commit's content, the checks to run on it, and the expected knowledge
// integration. Any difference later needs a fresh approval.
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';
import * as gitops from './git-ops.js';
import { loadMergeChecks } from './integration.js';
import { readLanes } from './lanes.js';
import { containsSecret } from '../security/redact.js';
import { loadWorkMemory } from '../shared/memory.js';

const SECRET_NAME = /(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|id_rsa.*|id_ed25519.*|.*\.p12|.*\.pfx)$/i;
const LARGE = 5 * 1024 * 1024;
// Paths YallaFlow itself writes on the integration branch after a merge (knowledge integration
// and the integration record). They must be clean in the home checkout beforehand.
export const OWNED_AFTER_MERGE = (workIds) => ['.yallaflow/context/', '.yallaflow/PROJECT.md', '.yallaflow/config.yaml', ...workIds.map((id) => `.yallaflow/work/${id}/`)];

const blobId = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
export function planHash(plan) {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

async function describe(lane, relative) {
  const full = path.join(lane, relative);
  let info;
  try { info = await lstat(full); } catch { return { path: relative, status: 'deleted', blob: null, size: 0 }; }
  if (info.isSymbolicLink()) {
    const target = await readlink(full);
    const resolved = path.resolve(path.dirname(full), target);
    return { path: relative, status: 'symlink', blob: blobId(Buffer.from(target)), size: target.length, outside: !resolved.startsWith(lane + path.sep) };
  }
  if (info.isDirectory()) return { path: relative, status: 'directory', blob: null, size: 0, submodule: await lstat(path.join(full, '.git')).then(() => true, () => false) };
  const bytes = await readFile(full);
  const binary = bytes.subarray(0, 8000).includes(0);
  // The same check as for the lane's history: the first 1 MB, NUL bytes read as spaces.
  const secret = SECRET_NAME.test(relative) || containsSecret(bytes.subarray(0, 1024 * 1024).toString('utf8').replace(/\u0000/g, ' '));
  return { path: relative, status: 'file', blob: blobId(bytes), size: bytes.length, binary, secret, large: bytes.length > LARGE, mode: info.mode & 0o111 ? 'executable' : 'regular' };
}

async function detectHooksAndCi(home) {
  const found = [];
  const has = (file) => lstat(path.join(home, file)).then(() => true, () => false);
  for (const file of ['.husky', '.pre-commit-config.yaml', 'lefthook.yml', '.lefthook.yml', '.gitlab-ci.yml']) if (await has(file)) found.push(file);
  try { for (const name of await readdir(path.join(home, '.github', 'workflows'))) if (/\.ya?ml$/.test(name)) found.push(`.github/workflows/${name}`); } catch { /* none */ }
  try {
    const hooks = path.join(home, '.git', 'hooks');
    for (const name of await readdir(hooks)) if (!name.endsWith('.sample')) found.push(`.git/hooks/${name}`);
  } catch { /* a worktree's .git is a file; the common hooks are checked from the home checkout */ }
  return found;
}

async function argvChecks(lane, workIds) {
  const checks = [];
  for (const workId of workIds) {
    try {
      const ledger = JSON.parse(await readFile(path.join(lane, '.yallaflow', 'work', workId, 'evidence', 'verification.json'), 'utf8'));
      const passing = (ledger.runs ?? []).filter((run) => run.success && run.executionMode === 'argv' && run.executable).at(-1);
      if (passing) checks.push({ name: `${workId} ${passing.id}`, argv: [passing.executable, ...(passing.args ?? [])], source: 'verification' });
    } catch { /* no ledger */ }
  }
  return checks;
}

// → { ok, readiness[], changes[], plan, planHash }. `context` comes from the console:
// { session, pending } for the lane, the lane's work items with their snapshot entries.
// `exclude`: uncommitted files the developer unticked; `include`: secret-looking files the developer
// explicitly ticked (they are left out by default).
// The main checkout's readiness for a fast-forward that changes `laneChanges` (FR20.6). Used by
// the review and again immediately before the target moves (review H10): staged changes,
// overlapping uncommitted files, hidden entries, files (ignored or untracked) at paths the merge
// adds, and dirty YallaFlow-owned files.
export async function homeBlockers({ home, targetHead, laneChanges, workIds }) {
  const blockers = [];
  if (gitops.stagedChanges(home)) blockers.push('Your main checkout has staged changes. Commit or unstage them first; YallaFlow never commits them.');
  const local = new Map(gitops.statusEntries(home).map((entry) => [entry.path, entry.code]));
  const overlap = laneChanges.filter((entry) => local.has(entry));
  if (overlap.length) blockers.push(`Your uncommitted files would be changed by the merge: ${overlap.join(', ')}.`);
  const hidden = gitops.hiddenEntries(home).filter((entry) => laneChanges.includes(entry));
  if (hidden.length) blockers.push(`assume-unchanged or skip-worktree files would be changed: ${hidden.join(', ')}.`);
  for (const entry of laneChanges) {
    if (local.has(entry)) continue;
    const inTarget = gitops.showFile(home, targetHead, entry) !== null;
    if (!inTarget && await lstat(path.join(home, entry)).then(() => true, () => false)) blockers.push(`${entry} exists in your main checkout (ignored or untracked) and the merge adds it; it would be overwritten.`);
  }
  const owned = OWNED_AFTER_MERGE(workIds);
  const dirtyOwned = [...local.keys()].filter((entry) => owned.some((prefix) => entry === prefix || entry.startsWith(prefix)));
  if (dirtyOwned.length) blockers.push(`YallaFlow files it will update after the merge are not clean: ${dirtyOwned.join(', ')}.`);
  return { blockers, unrelated: local.size };
}

// The manual fallback when Automated Merge is off: ordinary Git commands the developer runs and
// checks themselves. YallaFlow runs none of them.
export function manualSteps({ lane, home, branch, target }) {
  const q = (value) => (/^[A-Za-z0-9_./=:@%+,-]+$/.test(value) ? value : JSON.stringify(value));
  return [
    `cd ${q(lane)}`,
    'git status   # review every change, including untracked files',
    'git add <the files you reviewed> && git commit',
    `cd ${q(home)}`,
    `git switch ${q(target)} && git merge --no-ff ${q(branch)}`,
    '# run your project\'s checks yourself, then record and finish the work as usual'
  ];
}

// A check as the developer sees it: the full argument list, quoted (review H1).
export function showArgv(argv) {
  return argv.map((part) => (/^[A-Za-z0-9_./=:@%+,-]+$/.test(part) ? part : JSON.stringify(part))).join(' ');
}

export async function prepareReview({ home, laneId, items, session = null, pending = 0, message = null, mergeMessage = null, exclude = [], include = [], checksInclude = [], automatedMerge = true }) {
  const readiness = [];
  const block = (id, text) => readiness.push({ id, ok: false, level: 'block', text });
  const pass = (id, text) => readiness.push({ id, ok: true, level: 'ok', text });
  const warn = (id, text) => readiness.push({ id, ok: true, level: 'warn', text });
  const record = (await readLanes(home)).find((entry) => entry.id === laneId && entry.state !== 'removed');
  if (!record) throw Object.assign(new Error('Unknown lane.'), { status: 404, code: 'NOT_FOUND' });
  const lane = record.path;
  // Review H2: the lane must still be a worktree of this repository before any Git runs in it.
  await gitops.assertLaneOf(home, lane);
  const workIds = items.map((item) => item.id);
  // 1. task
  const notDone = items.filter((item) => item.stage !== 'DONE');
  if (!items.length) block('task', 'This lane has no work item to integrate.');
  else if (notDone.length) block('task', `Not DONE yet: ${notDone.map((item) => item.id).join(', ')}.`);
  else if (items.some((item) => item.latestVerification && !item.latestVerification.success)) block('task', 'The latest verification of a work item failed.');
  else pass('task', `DONE: ${workIds.join(', ')}.`);
  if (!automatedMerge) block('checks-safety', 'Automated merge is turned off in YallaFlow 1.5.0: its checks cannot yet run on exactly the merged content apart from files the lane\'s agent controls. Merge by hand with the steps shown.');
  // 2. session
  if (session || pending) block('session', 'An agent session is running or waiting in this lane. End it first; the lane is then locked for review.');
  else pass('session', 'No agent is working in the lane.');
  // 4. repository integrity (before Git work)
  const platform = gitops.platformCheck();
  if (!platform.ok) block('platform', `${platform.reason} Integrate by hand.`);
  try { gitops.assertSigningAllowed(home); } catch (error) { block('signing', error.message); }
  const laneHeadEarly = gitops.head(lane);
  const homeHeadEarly = gitops.head(home);
  const drivers = await gitops.externalDrivers(home, { commits: [laneHeadEarly, homeHeadEarly] });
  const laneDrivers = await gitops.externalDrivers(lane, { commits: [laneHeadEarly] });
  if (drivers.filters.length || drivers.mergeDrivers.length || laneDrivers.filters.length || laneDrivers.mergeDrivers.length) block('drivers', 'This repository uses Git filters or merge drivers; YallaFlow 1.5.0 does not run them. Integrate by hand.');
  const links = gitops.gitlinks(lane, { commits: [laneHeadEarly, homeHeadEarly] });
  if (links.length) {
    // Stop before any Git command reads the lane's work tree (re-verification round 2).
    block('drivers', `This repository has submodules (${links.slice(0, 3).join(', ')}); YallaFlow 1.5.0 does not automate merges with submodules. Integrate by hand.`);
    const plan = { schema: 'yallaflow.merge-plan/1', lane: { id: record.id, path: lane, branch: record.branch, base: record.base, head: laneHeadEarly }, approved: [], approvedTree: null, laneMessage: '', target: { branch: record.integrationBranch, head: homeHeadEarly }, mergedTree: null, mergeMessage: '', checks: [], secretsAccepted: [], expectedKnowledge: [], laneIgnored: [], workIds, hooks: [] };
    return { ok: false, readiness, manual: manualSteps({ lane, home, branch: record.branch, target: record.integrationBranch }), changes: [], conflicts: [], historySecrets: [], agentChecks: [], plan, planHash: null };
  }
  // Review H4: no Git object work (staging into a private index, merge preview) once the
  // platform or the drivers check has blocked.
  const gitBlocked = () => readiness.some((entry) => !entry.ok && ['platform', 'drivers'].includes(entry.id));
  if ((await gitops.configFingerprint(home)) !== record.configFingerprint) block('config', 'The repository Git configuration changed since this lane was created. Review it; then integrate by hand.');
  for (const [where, cwd] of [['main checkout', home], ['lane', lane]]) {
    const busy = await gitops.inProgress(cwd).catch(() => []);
    if (busy.length) block('busy', `Git is busy in the ${where} (${busy.join(', ')}).`);
  }
  const target = record.integrationBranch;
  const onTarget = gitops.currentBranch(home) === target;
  if (!onTarget) block('target', `The main checkout must be on ${target}.`);
  // 3. changes
  // A tracked file under .yallaflow/local/ (personal state that is never committed) would escape
  // both the approval and the checks' clean-lane test.
  const trackedLocal = gitops.statusEntries(lane).filter((entry) => entry.path.startsWith('.yallaflow/local/') && entry.code !== '??');
  if (trackedLocal.length) block('changes', `Files under .yallaflow/local/ are tracked by Git in the lane (${trackedLocal.slice(0, 3).map((entry) => entry.path).join(', ')}); that folder is personal state. Remove them from Git by hand, then review again.`);
  const uncommitted = [...new Set(gitops.statusEntries(lane).flatMap((entry) => (entry.from ? [entry.path, entry.from] : [entry.path])))].filter((entry) => !entry.startsWith('.yallaflow/local/'));
  const laneHead = gitops.head(lane);
  const committed = gitops.changedBetween(lane, record.base, laneHead);
  const changes = [];
  for (const entry of [...new Set([...uncommitted, ...committed])].sort()) {
    const info = await describe(lane, entry.replace(/\/$/, ''));
    changes.push({ ...info, committed: committed.includes(entry) && !uncommitted.includes(entry), approved: uncommitted.includes(entry) && (!info.secret || include.includes(entry)) && !exclude.includes(entry) });
  }
  for (const change of changes) {
    // A name with invisible direction or line characters can make a review read differently.
    if (gitops.INVISIBLE.test(change.path)) block('changes', `${JSON.stringify(change.path)} has invisible control or direction characters in its name; rename it, or integrate by hand.`);
    if (change.submodule) block('changes', `${change.path} is a submodule change; integrate by hand.`);
    if (change.outside) block('changes', `${change.path} is a symbolic link pointing outside the repository.`);
  }
  const secrets = changes.filter((change) => change.secret && !change.committed && !change.approved);
  if (secrets.length) warn('secrets', `Not included unless you tick them: ${secrets.map((change) => change.path).join(', ')} (they look like secrets).`);
  // Review H9: a secret-looking file the agent already committed in the lane is merged only when
  // you tick it too; otherwise remove it from the lane's history yourself.
  // Every version the lane adds to the target's history is checked, from Git itself: versions
  // removed or replaced later, brought in by a merge commit, binary or large (the first 1 MB is
  // read). A path whose committed versions look like a secret needs your tick, whatever its
  // state in the work tree (re-verification round 2).
  const historySecrets = new Set();
  for (const { path: file, blob } of gitops.blobsIntroduced(lane, record.base, laneHead, { exclude: [homeHeadEarly] })) {
    if (SECRET_NAME.test(file)) { historySecrets.add(file); continue; }
    const bytes = gitops.blobBytes(lane, blob);
    if (bytes && containsSecret(bytes.subarray(0, 1024 * 1024).toString('utf8').replace(/\u0000/g, ' '))) historySecrets.add(file);
  }
  for (const file of gitops.pathsTouched(lane, record.base, laneHead, { exclude: [homeHeadEarly] })) if (SECRET_NAME.test(file)) historySecrets.add(file);
  for (const change of changes) if (change.secret && change.committed) historySecrets.add(change.path);
  for (const change of changes) if (historySecrets.has(change.path)) { change.secret = true; change.committed = change.committed || !uncommitted.includes(change.path); }
  const changedPaths = new Set(changes.map((change) => change.path));
  for (const file of historySecrets) if (gitops.INVISIBLE.test(file) && !changes.some((change) => change.path === file)) block('changes', `${JSON.stringify(file)} has invisible control or direction characters in its name; rename it, or integrate by hand.`);
  // Commit messages and author fields go into the target's history too.
  const secretTexts = gitops.commitTexts(lane, record.base, laneHead, { exclude: [homeHeadEarly] }).filter((text) => containsSecret(text));
  if (secretTexts.length) block('secrets', `${secretTexts.length} of the lane's commit messages or author fields look like they hold a secret. Rewrite the lane's commits yourself, or integrate by hand.`);
  const secretsUnticked = [...historySecrets].filter((file) => !include.includes(file));
  if (secretsUnticked.length) block('secrets', `The lane's commits add something that looks like a secret: ${secretsUnticked.join(', ')}. It would be in ${record.integrationBranch}'s history even if the file changed later. Tick it to merge anyway, or rewrite the lane's commits yourself.`);
  for (const change of changes) if (historySecrets.has(change.path)) change.secretAccepted = include.includes(change.path);
  const approvedPaths = changes.filter((change) => change.approved).map((change) => change.path);
  const unticked = uncommitted.filter((entry) => !approvedPaths.includes(entry));
  // Review H8: the checks run in the lane on the merge commit; a file left out would still be
  // there and the checks would not see exactly what is merged.
  if (unticked.length) block('unticked', `Files you leave out stay in the lane, so the checks would not run on exactly what is merged: ${unticked.join(', ')}. Tick them, or move them out of the lane (or add them to .gitignore) first.`);
  // 5. conflicts (object-only)
  let approvedTree = null;
  let mergedTree = null;
  let targetHead = null;
  let laneChanges = [];
  let conflicts = [];
  if (!gitBlocked()) try {
    targetHead = gitops.head(home);
    approvedTree = await gitops.approvedTree({ home, lane, paths: approvedPaths });
    const candidate = approvedTree === gitops.treeOf(lane, 'HEAD') ? laneHead : await gitops.commitTree({ home, cwd: lane, tree: approvedTree, parents: [laneHead], message: 'preview', sign: false });
    const preview = gitops.previewMerge(home, targetHead, candidate);
    if (preview.result === 'error') block('conflicts', `The merge preview failed: ${preview.message}`);
    else if (preview.result === 'conflict') { conflicts = preview.conflicts; block('conflicts', `Conflicts with ${target}: ${preview.conflicts.join(', ')}.`); }
    else { mergedTree = preview.tree; pass('conflicts', `No conflicts with ${target} @ ${targetHead.slice(0, 7)}.`); }
    if (mergedTree) laneChanges = gitops.changedBetween(home, targetHead, mergedTree);
  } catch (error) {
    block('conflicts', error.message);
  }
  // 6. the main checkout (FR20.6): staged, overlapping, hidden and ignored-at-added-path
  if (onTarget && targetHead) {
    const { blockers, unrelated } = await homeBlockers({ home, targetHead, laneChanges, workIds });
    for (const text of blockers) block('home', text);
    if (!blockers.length) pass('home', unrelated ? `Your ${unrelated} unrelated uncommitted file(s) stay untouched.` : 'The main checkout is clean.');
  }
  // 7. Shared Project integrity: the expected knowledge integration (confirmed on M before main moves)
  const expectedKnowledge = [];
  for (const workId of workIds) {
    const memory = await loadWorkMemory(lane, workId).catch(() => ({ exists: false }));
    for (const staged of memory.record?.staged ?? []) expectedKnowledge.push({ workId, candidateId: staged.candidate?.id ?? staged.candidate });
  }
  // 8. checks (D9)
  const declared = (await loadMergeChecks(home)) ?? [];
  const hooks = await detectHooksAndCi(home);
  if (hooks.length && !declared.length) block('checks', `This project has Git hooks or CI (${hooks.join(', ')}). Declare the required merge checks first (yallaflow execution checks set); YallaFlow does not assume task tests replace them.`);
  // Review re-verification: the checks run in the lane, where files Git ignores (dependencies,
  // build output, local settings) are present too. They are not part of the merge and their
  // content is not reviewed; their names are listed and bound to the approval.
  const laneIgnored = gitops.statusEntries(lane, { ignored: true }).filter((entry) => entry.code === '!!' && !entry.path.startsWith('.yallaflow/local/')).map((entry) => entry.path).sort();
  for (const file of laneIgnored) if (gitops.INVISIBLE.test(file)) block('changes', `${JSON.stringify(file)} has invisible control or direction characters in its name; rename it, or integrate by hand.`);
  // Owner decision (Checkpoint D follow-up, 2026-11-10): YallaFlow never runs agent-controlled
  // files with the developer's permissions. Files Git ignores in the lane (dependencies, build
  // output, tools) are written by the lane's agent and not reviewed, and the checks would run next
  // to them: Automated Merge is off for this task, with the manual steps instead (fail closed).
  if (laneIgnored.length) block('checks-safety', `Automated merge is off for this task: the checks would run next to files Git ignores in the lane (${laneIgnored.slice(0, 8).join(', ')}${laneIgnored.length > 8 ? `, and ${laneIgnored.length - 8} more` : ''}), which the lane's agent controls and this review does not show. YallaFlow never runs them with your permissions. Merge by hand instead, or remove those files from the lane and review again.`);
  // Review H1: commands the lane's agent recorded (its verification ledger lives in the lane,
  // where the agent can write) run only when you tick each one, shown in full; the project's
  // declared merge checks come from the main checkout.
  // Owner decision: commands the lane's agent recorded are agent-controlled and are never run by
  // YallaFlow; they are listed for information only. Only the project's declared merge checks run.
  void checksInclude;
  const agentChecks = (await argvChecks(lane, workIds)).map((check) => ({ ...check, shown: showArgv(check.argv), included: false }));
  const checks = declared.filter((check) => check.required !== false).map((check) => ({ name: check.name, argv: check.argv, source: 'declared' }));
  if (!checks.length) block('checks', 'No check can run on the merged result: declare a merge check (yallaflow execution checks set). Commands the agent ran in its own session are not run by YallaFlow.');
  else pass('checks', `Will run on the merged result before ${target} moves: ${checks.map((check) => showArgv(check.argv)).join('; ')}.`);
  const laneMessage = message ?? `${workIds.join(', ')}: ${items.map((item) => item.title).join('; ')}`.slice(0, 200) + `\n\nYallaFlow-Work: ${workIds.join(', ')}\n`;
  // The lane commit's message comes from work titles the agent can edit: no invisible characters
  // and nothing that looks like a secret.
  if (gitops.INVISIBLE.test(laneMessage.replace(/\n/g, ' ')) || containsSecret(laneMessage)) block('changes', 'The lane commit message (from the work titles) has invisible characters or looks like it holds a secret. Fix the work title, then review again.');
  const mergeMsg = mergeMessage ?? `Merge ${record.branch} (${workIds.join(', ')})\n\nYallaFlow-Work: ${workIds.join(', ')}\n`;
  const plan = {
    schema: 'yallaflow.merge-plan/1',
    lane: { id: record.id, path: lane, branch: record.branch, base: record.base, head: laneHead },
    approved: changes.filter((change) => change.approved).map((change) => ({ path: change.path, blob: change.blob })),
    approvedTree,
    laneMessage,
    target: { branch: target, head: targetHead },
    mergedTree,
    mergeMessage: mergeMsg,
    checks: checks.map((check) => ({ name: check.name, argv: check.argv, source: check.source })),
    secretsAccepted: [...historySecrets].filter((file) => include.includes(file)).sort(),
    expectedKnowledge,
    laneIgnored,
    workIds,
    hooks
  };
  return { ok: !readiness.some((entry) => !entry.ok), readiness, manual: manualSteps({ lane, home, branch: record.branch, target }), changes, conflicts, historySecrets: [...historySecrets].filter((file) => !changedPaths.has(file)).map((file) => ({ path: file, accepted: include.includes(file) })), agentChecks: agentChecks.map((check) => ({ name: check.name, argv: check.argv, shown: check.shown, included: check.included })), plan, planHash: planHash(plan) };
}
