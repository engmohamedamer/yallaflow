// v0.3.10 Shared Project Intelligence: explicit one-time sharing, branch-safe IDs,
// memory base, work-local memory deltas, the one canonical integration boundary,
// conflict handling, CI check, developer-facing UX, and single-user compatibility.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, nextWorkId, workspacePath } from '../src/core/workspace.js';
import { CLONE_TAG_ALPHABET, CLONE_TAG_LENGTH, nextScopedId, parseScopedId } from '../src/core/ids.js';
import { exists } from '../src/utils/fs.js';
import { contextLedgerPath, loadContextLedger, mutateContextLedger } from '../src/context/ledger.js';
import { captureContextBase, diffAgainstBase, loadWorkMemory, planIntegration } from '../src/shared/memory.js';
import { ledgerFingerprint, factFingerprint } from '../src/shared/fingerprint.js';
import { compareVersions } from '../src/shared/config.js';
import { normalizeEvidenceRefs } from '../src/context/evidence.js';
import { allocateCheckoutId, readLocalIdentity, ensureLocalIdentity, generateCloneTag, writeLocalIdentity } from '../src/shared/identity.js';
import { proposeKnowledge, rejectKnowledge } from '../src/knowledge/store.js';
import { promoteKnowledge } from '../src/knowledge/promotion.js';
import {
  cli, commitAll, complete, developer, git, investigation, learn, mergeBranch, sharedTeam, approveTeamBaseline, writeTeamApp
} from '../test-support/shared.js';

const read = async (root, relative) => readFile(path.join(workspacePath(root), relative), 'utf8');
const json = async (root, relative) => JSON.parse(await read(root, relative));

async function treeHash(root, { skipGit = true } = {}) {
  const hash = createHash('sha256');
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (skipGit && entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      hash.update(path.relative(root, full));
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) hash.update(await readFile(full));
    }
  }
  await walk(root);
  return hash.digest('hex');
}

function head(root, ref = 'HEAD') {
  return git(root, ['rev-parse', ref]).stdout.trim();
}

// ---------------------------------------------------------------------------
// Shared setup

test('8/9/11. shared enable is explicit, records policy and version, never commits or pushes', async () => {
  const team = await sharedTeam();
  const config = await json(team.maintainer, 'config.yaml');
  assert.equal(config.schemaVersion, 2);
  assert.deepEqual(config.yallaflow, { minimumVersion: '0.3.10-internal.1' });
  assert.equal(config.shared.enabled, true);
  assert.equal(config.shared.integrationBranch, 'main');
  assert.equal(config.shared.sources.storage, 'git');
  assert.equal(await read(team.maintainer, '.gitignore'), '# YallaFlow Shared Project: personal runtime state (identity, active work) is never shared.\nlocal/\n');
  assert.equal(await exists(path.join(workspacePath(team.maintainer), 'state', 'current.yaml')), false, 'personal focus moved out of tracked state');

  // A fresh project: enabling writes files but creates no commit and pushes nothing.
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-enable-'));
  git(root, ['init', '-q', '-b', 'trunk']);
  git(root, ['config', 'user.name', 'M']);
  git(root, ['config', 'user.email', 'm@example.com']);
  git(root, ['config', 'init.defaultBranch', 'trunk']);
  await writeTeamApp(root);
  await initWorkspace(root, 'X', 'brownfield');
  commitAll(root, 'init');
  const commit = head(root);
  const preview = cli(root, ['shared', 'enable', '--dry-run']).stdout;
  assert.match(preview, /Integration branch: trunk \(from git config init\.defaultBranch\)/, 'the integration branch is never assumed to be main');
  assert.match(preview, /Project understanding: an existing project with no approved project understanding yet[\s\S]*Recommended: approve the Brownfield baseline before sharing/);
  assert.match(preview, /No files were changed/);
  assert.equal((await json(root, 'config.yaml')).schemaVersion, 1);
  const enabled = cli(root, ['shared', 'enable']).stdout;
  assert.match(enabled, /Nothing was committed or pushed/);
  assert.match(enabled, /No join command, no re-baseline/);
  assert.equal(head(root), commit, 'no commit was created');
  assert.ok(git(root, ['status', '--porcelain']).stdout.includes('.yallaflow/config.yaml'), 'changes are left for the human to commit');
  assert.equal((await json(root, 'config.yaml')).shared.integrationBranch, 'trunk');
  assert.match(cli(root, ['shared', 'enable']).stdout, /Already a Shared Project/);
});

test('10. an unhealthy or non-Git workspace cannot enable sharing, and nothing changes', async () => {
  const noGit = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-nogit-'));
  await initWorkspace(noGit, 'X', 'greenfield');
  const before = await treeHash(noGit);
  assert.match(cli(noGit, ['shared', 'enable', '--integration-branch', 'main'], false).stderr, /not inside a Git work tree[\s\S]*Nothing was changed/);
  assert.equal(await treeHash(noGit), before);

  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-unhealthy-'));
  git(root, ['init', '-q', '-b', 'main']);
  await initWorkspace(root, 'X', 'greenfield');
  await writeFile(path.join(workspacePath(root), 'state', 'current.yaml'), '{ "schemaVersion": 1, "activeWork": "PF-0099", "stage": null }\n');
  await mkdir(path.join(workspacePath(root), 'work', 'PF-0001'), { recursive: true });
  await writeFile(path.join(workspacePath(root), 'work', 'PF-0001', 'meta.yaml'), '{ "id": "PF-0001", "routingStatus": "routed", "status": "DONE", "type": "bug", "workflow": "bug", "behaviorContract": { "registryVersion": 5, "skills": ["implementation", "verification"] } }\n');
  const snapshot = await treeHash(root);
  assert.match(cli(root, ['shared', 'enable', '--integration-branch', 'main'], false).stderr, /structurally unhealthy[\s\S]*Nothing was changed/);
  assert.equal(await treeHash(root), snapshot);

  // No integration branch can be determined mechanically → refuse, never guess.
  const bare = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-nobranch-'));
  git(bare, ['init', '-q']);
  await initWorkspace(bare, 'X', 'greenfield');
  const noDefault = cli(bare, ['shared', 'enable'], false);
  if (noDefault.status !== 0) assert.match(noDefault.stderr, /integration branch could not be determined[\s\S]*--integration-branch/);
});

test('11. an incompatible YallaFlow stops before any project-state mutation; read-only orientation still explains why', async () => {
  const team = await sharedTeam();
  const config = await json(team.maintainer, 'config.yaml');
  config.yallaflow.minimumVersion = '9.0.0';
  await writeFile(path.join(workspacePath(team.maintainer), 'config.yaml'), `${JSON.stringify(config, null, 2)}\n`);
  const before = await treeHash(team.maintainer);
  for (const args of [['start', 'Fix invoice totals'], ['bug', 'Totals', '--scope', 'bounded'], ['shared', 'integrate'], ['knowledge', 'review', 'PF-0001', '--none'], ['context', 'render']]) {
    const result = cli(team.maintainer, args, false);
    assert.notEqual(result.status, 0, args.join(' '));
    assert.match(result.stderr, /Installed: 0\.3\.10-internal\.4 · Project requires: >= 9\.0\.0 — INCOMPATIBLE[\s\S]*No files were changed/);
  }
  assert.equal(await treeHash(team.maintainer), before);
  const brief = cli(team.maintainer, ['brief']).stdout;
  assert.match(brief, /Primary next concern: this project requires a different YallaFlow/);
  assert.match(cli(team.maintainer, ['doctor'], false).stdout, /FAIL YallaFlow version: Installed: 0\.3\.10-internal\.4 · Project requires: >= 9\.0\.0/);
  assert.equal(cli(team.maintainer, ['shared', 'check'], false).status, 1);
  assert.equal(compareVersions('0.3.10-internal.1', '0.3.9-internal.1'), 1);
  assert.equal(compareVersions('0.3.10-internal.1', '0.3.10'), -1);
  assert.equal(compareVersions('0.3.10-internal.2', '0.3.10-internal.10'), -1);
});

test('12/52. a single-user workspace is unchanged until sharing is enabled: same IDs, no memory records, reads write nothing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-single-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'Solo']);
  git(root, ['config', 'user.email', 'solo@example.com']);
  await writeTeamApp(root);
  await initWorkspace(root, 'Solo', 'brownfield');
  await approveTeamBaseline(root);
  const workId = await investigation(root, 'Refund window');
  assert.equal(workId, 'PF-0002');
  const promoted = await learn(root, workId, { kind: 'business-rule', summary: 'Refund window is 30 days.', evidence: ['backend/refunds/policy.js'], reconfirms: 'CTX-0004' });
  assert.equal(promoted.candidate.status, 'promoted', 'single-user promotion writes canonical memory directly');
  assert.equal(promoted.candidate.relation.factFingerprint, undefined, 'no shared-only field in single-user knowledge');
  assert.equal(await exists(path.join(workspacePath(root), 'work', workId, 'memory.yaml')), false);
  assert.equal((await json(root, 'config.yaml')).schemaVersion, 1);
  assert.equal(await nextWorkId(root), 'PF-0003');
  const before = await treeHash(root);
  for (const args of [['brief'], ['status'], ['doctor'], ['shared', 'status'], ['shared', 'check'], ['finish', workId], ['context', 'status'], ['resume', workId], ['handoff', workId]]) cli(root, args, false);
  assert.equal(await treeHash(root), before, 'read commands write nothing');
  assert.match(cli(root, ['shared', 'status']).stdout, /Mode: single-user \(not shared\)/);
  assert.equal(cli(root, ['shared', 'check']).status, 0);
  assert.match(cli(root, ['shared', 'integrate'], false).stderr, /not a Shared Project/);
});

// ---------------------------------------------------------------------------
// Branch-safe identifiers

test('13/14/16. two branches from the same base create work and sources without ID or path collision, and merge cleanly', async () => {
  const team = await sharedTeam();
  const a = await developer(team, 'Dev A', 'AAAAAAAAAA', 'feature/refunds');
  const b = await developer(team, 'Dev B', 'BBBBBBBBBB', 'fix/invoice-total');
  for (const [root, name] of [[a, 'refund'], [b, 'invoice']]) {
    cli(root, ['start', `Work on ${name}`]);
    await writeFile(path.join(root, `${name}-notes.md`), `# ${name} notes\n`);
    cli(root, ['intake', `${name}-notes.md`, '--title', `${name} spec`]);
  }
  assert.deepEqual((await readdir(path.join(workspacePath(a), 'work'))).sort(), ['PF-0001', 'PF-AAAAAAAAAA-0001', 'PF-AAAAAAAAAA-0002']);
  assert.deepEqual((await readdir(path.join(workspacePath(b), 'work'))).sort(), ['PF-0001', 'PF-BBBBBBBBBB-0001', 'PF-BBBBBBBBBB-0002']);
  assert.deepEqual(await readdir(path.join(workspacePath(a), 'sources')), ['SRC-AAAAAAAAAA-0001']);
  assert.deepEqual(await readdir(path.join(workspacePath(b), 'sources')), ['SRC-BBBBBBBBBB-0001']);
  for (const [root, branch] of [[a, 'feature/refunds'], [b, 'fix/invoice-total']]) {
    commitAll(root, branch);
    git(root, ['push', '-q', 'origin', branch]);
  }
  assert.equal(mergeBranch(team.maintainer, 'feature/refunds').status, 0);
  assert.equal(mergeBranch(team.maintainer, 'fix/invoice-total').status, 0, 'no merge conflict');
  assert.deepEqual((await readdir(path.join(workspacePath(team.maintainer), 'work'))).sort(), ['PF-0001', 'PF-AAAAAAAAAA-0001', 'PF-AAAAAAAAAA-0002', 'PF-BBBBBBBBBB-0001', 'PF-BBBBBBBBBB-0002']);
  assert.deepEqual((await readdir(path.join(workspacePath(team.maintainer), 'sources'))).sort(), ['SRC-AAAAAAAAAA-0001', 'SRC-BBBBBBBBBB-0001']);
  assert.match(cli(team.maintainer, ['doctor']).stdout, /Workspace healthy/);
  assert.match(cli(team.maintainer, ['source', 'show', 'SRC-BBBBBBBBBB-0001']).stdout, /invoice-notes\.md/);
});

test('15. legacy PF-#### and SRC-#### stay readable and keep allocating in single-user mode; both forms coexist', async () => {
  assert.deepEqual(parseScopedId('PF', 'PF-0042'), { form: 'legacy', number: 42 });
  assert.deepEqual(parseScopedId('PF', 'PF-K7M2QX4N8P-0003'), { form: 'shared', tag: 'K7M2QX4N8P', number: 3 });
  assert.equal(parseScopedId('PF', 'PF-k7m2q-0003'), null);
  assert.equal(nextScopedId('PF', ['PF-0007', 'PF-K7M2QX4N8P-0003']), 'PF-0008');
  assert.equal(nextScopedId('PF', ['PF-0007', 'PF-K7M2QX4N8P-0003', 'PF-ZZZZZZZZZZ-0009'], 'K7M2QX4N8P'), 'PF-K7M2QX4N8P-0004');
  assert.equal(nextScopedId('SRC', ['SRC-0002'], 'K7M2QX4N8P'), 'SRC-K7M2QX4N8P-0001');
  const team = await sharedTeam();
  assert.match(cli(team.maintainer, ['resume', 'PF-0001']).stdout, /PF-0001/, 'the legacy baseline work remains readable after sharing');
});

test('checkout tags: 10 Crockford-base32 characters, an unbiased byte mapping, drawn from crypto.randomBytes', async () => {
  const source = await readFile(fileURLToPath(new URL('../src/shared/identity.js', import.meta.url)), 'utf8');
  assert.match(source, /export function generateCloneTag\(bytes = randomBytes\(CLONE_TAG_LENGTH\)\)/, 'default entropy is the CSPRNG');
  assert.equal(CLONE_TAG_LENGTH, 10);
  assert.equal(CLONE_TAG_ALPHABET.length, 32);
  assert.equal(256 % CLONE_TAG_ALPHABET.length, 0, 'byte % 32 is unbiased');
  assert.doesNotMatch(CLONE_TAG_ALPHABET, /[ILOU]/);
  assert.equal(generateCloneTag(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 31])), '012345678Z');
  assert.equal(generateCloneTag(Buffer.from([32, 33, 34, 35, 36, 37, 38, 39, 40, 63])), '012345678Z', 'only the low 5 bits of each byte are used');
  for (let i = 0; i < 200; i += 1) assert.match(generateCloneTag(), /^[0-9A-HJKMNP-TV-Z]{10}$/);
  // Format: both ID forms parse; 5-character (pre-release) tags are not a valid shared form.
  assert.deepEqual(parseScopedId('PF', 'PF-K7M2QX4N8P-0012'), { form: 'shared', tag: 'K7M2QX4N8P', number: 12 });
  assert.equal(parseScopedId('PF', 'PF-K7M2Q-0012'), null);
  assert.deepEqual(parseScopedId('SRC', 'SRC-0003'), { form: 'legacy', number: 3 });
});

test('high-volume deterministic non-reuse: one checkout allocating thousands of IDs across branch switches never repeats a number', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-alloc-'));
  await writeLocalIdentity(root, 'K7M2QX4N8P');
  const seen = new Set();
  // Branches see different subsets of what this checkout created (or none of it).
  const branches = [[], ['PF-0001', 'PF-0002'], []];
  for (let i = 0; i < 3000; i += 1) {
    const visible = branches[i % branches.length];
    const id = await allocateCheckoutId(root, 'PF', visible, nextScopedId);
    assert.ok(!seen.has(id), `${id} reused`);
    seen.add(id);
    if (i % 7 === 0) visible.push(id);
  }
  assert.equal(seen.size, 3000);
  assert.ok(seen.has('PF-K7M2QX4N8P-3000'), 'the sequence is dense and deterministic');
  // Sources keep an independent sequence in the same identity.
  assert.equal(await allocateCheckoutId(root, 'SRC', [], nextScopedId), 'SRC-K7M2QX4N8P-0001');
  const identity = await readLocalIdentity(root);
  assert.deepEqual(identity.sequences, { PF: 3000, SRC: 1 }, 'persisted across invocations');
  // IDs from different checkouts can never be equal: the tag is part of the ID.
  await writeLocalIdentity(root, 'ZZZZZZZZZZ');
  assert.equal(await allocateCheckoutId(root, 'PF', [...seen], nextScopedId), 'PF-ZZZZZZZZZZ-0001');
});

test('a copied checkout gets a fresh clone tag; the identity is local, gitignored, and needs no join command', async () => {
  const team = await sharedTeam();
  const fresh = path.join(team.dir, 'newcomer');
  git(team.dir, ['clone', '-q', team.origin, fresh]);
  git(fresh, ['config', 'user.name', 'Newcomer']);
  git(fresh, ['config', 'user.email', 'new@example.com']);
  git(fresh, ['checkout', '-q', '-b', 'feature/x']);
  // 46: no join/registration — the first command just works.
  assert.match(cli(fresh, ['team', 'join'], false).stderr, /Unknown command: team/);
  const created = cli(fresh, ['start', 'Adjust refund email']).stdout;
  const id = /Created (PF-[0-9A-Z]{10}-0001)/.exec(created)?.[1];
  assert.ok(id, created);
  const identity = await readLocalIdentity(fresh);
  assert.equal(id, `PF-${identity.cloneTag}-0001`);
  assert.equal(git(fresh, ['status', '--porcelain', '--', '.yallaflow/local']).stdout, '', 'local state is gitignored');
  const copy = path.join(team.dir, 'copied');
  await cp(fresh, copy, { recursive: true });
  const copied = await ensureLocalIdentity(copy);
  assert.notEqual(copied.cloneTag, identity.cloneTag, 'a copied checkout never reuses the original sequence');
  assert.match(cli(copy, ['start', 'Copy work']).stdout, new RegExp(`Created PF-${copied.cloneTag}-0001`));
  // Persistence: the same checkout keeps its tag and continues its sequence.
  assert.match(cli(fresh, ['start', 'Second request']).stdout, new RegExp(`Created PF-${identity.cloneTag}-0002`));
  assert.equal((await readLocalIdentity(fresh)).cloneTag, identity.cloneTag);
  // A second clone of the same origin draws its own tag.
  const other = path.join(team.dir, 'other');
  git(team.dir, ['clone', '-q', team.origin, other]);
  assert.match(cli(other, ['start', 'Other request']).stdout, /Created PF-[0-9A-Z]{10}-0001/);
  assert.notEqual((await readLocalIdentity(other)).cloneTag, identity.cloneTag);
  // Losing local/ (git clean -fdx) never resumes an old sequence: a new tag is drawn.
  git(fresh, ['clean', '-fdxq', '--', '.yallaflow/local']);
  cli(fresh, ['start', 'After clean']);
  assert.notEqual((await readLocalIdentity(fresh)).cloneTag, identity.cloneTag);
});

test('one checkout never reuses an ID across branch switches or stashes', async () => {
  const team = await sharedTeam();
  const a = await developer(team, 'Dev A', 'AAAAAAAAAA', 'feature/one');
  const first = await investigation(a, 'First');
  commitAll(a, 'one');
  git(a, ['checkout', '-q', 'main']);
  git(a, ['checkout', '-q', '-b', 'feature/two']);
  assert.equal(await exists(path.join(workspacePath(a), 'work', first)), false, 'the other branch does not contain the first work');
  const second = await investigation(a, 'Second');
  await writeFile(path.join(a, 'spec.md'), '# spec\n');
  cli(a, ['intake', 'spec.md']);
  git(a, ['stash', '-u', '-q']);
  const third = await investigation(a, 'Third');
  assert.deepEqual([first, second, third], ['PF-AAAAAAAAAA-0001', 'PF-AAAAAAAAAA-0002', 'PF-AAAAAAAAAA-0004'], 'PF-AAAAAAAAAA-0003 was the stashed intake work');
  assert.equal((await readLocalIdentity(a)).sequences.SRC, 1);
});

test('17. every global namespace is branch-safe after a multi-branch merge; work-scoped IDs are safe by scope', async () => {
  const team = await sharedTeam();
  const a = await developer(team, 'Dev A', 'AAAAAAAAAA', 'feature/a');
  const b = await developer(team, 'Dev B', 'BBBBBBBBBB', 'feature/b');
  for (const [root, branch] of [[a, 'feature/a'], [b, 'feature/b']]) {
    const workId = await investigation(root, `Study ${branch}`);
    await learn(root, workId, { kind: 'architecture', summary: `Note from ${branch}.`, evidence: ['src/server.js'] });
    await proposeKnowledge(root, workId, { kind: 'decision', source: 'implementation-runtime', summary: `Decision on ${branch}`, evidence: ['src/server.js'], context: 'c', decision: 'd', reason: 'r', costIfWrong: 'x' });
    await promoteKnowledge(root, workId, 'K-002');
    await complete(root, workId);
    commitAll(root, branch);
    git(root, ['push', '-q', 'origin', branch]);
  }
  assert.equal(mergeBranch(team.maintainer, 'feature/a').status, 0);
  assert.equal(mergeBranch(team.maintainer, 'feature/b').status, 0);
  cli(team.maintainer, ['shared', 'integrate']);
  const base = workspacePath(team.maintainer);
  const decisions = await readdir(path.join(base, 'decisions'));
  assert.deepEqual(decisions.sort(), ['ADR-PF-AAAAAAAAAA-0001-K-002.md', 'ADR-PF-BBBBBBBBBB-0001-K-002.md'], 'ADR paths are scoped by work ID');
  const { ledger } = await loadContextLedger(team.maintainer);
  const ids = ledger.facts.map((fact) => fact.id);
  assert.equal(new Set(ids).size, ids.length, 'CTX identity is allocated once, at integration');
  assert.deepEqual(ids.slice(-2), ['CTX-0007', 'CTX-0008']);
  // K-001 exists in both works — unique within its work, never global.
  for (const workId of ['PF-AAAAAAAAAA-0001', 'PF-BBBBBBBBBB-0001']) assert.equal((await json(team.maintainer, `work/${workId}/knowledge.yaml`)).candidates[0].id, 'K-001');
  assert.match(cli(team.maintainer, ['doctor']).stdout, /Workspace healthy/);
});

// ---------------------------------------------------------------------------
// Memory base

test('18/19/20/21. work captures its memory base; unchanged, unrelated, and referenced changes are told apart', async () => {
  const team = await sharedTeam();
  const a = await developer(team, 'Dev A', 'AAAAAAAAAA', 'feature/a');
  const workId = await investigation(a, 'Refund window');
  const { record } = await loadWorkMemory(a, workId);
  const { ledger } = await loadContextLedger(a);
  assert.equal(record.contextBase.ledgerFingerprint, ledgerFingerprint(ledger));
  assert.equal(record.contextBase.factCount, 6);
  assert.equal(record.contextBase.contextSchemaVersion, ledger.schemaVersion);
  assert.match(record.contextBase.gitCommit, /^[0-9a-f]{40}$/);
  assert.equal(record.contextBase.branch, 'feature/a');
  assert.deepEqual(record.createdBy, { actor: { name: 'Dev A', email: 'dev.a@example.com' }, cloneTag: 'AAAAAAAAAA', branch: 'feature/a' });
  assert.equal(diffAgainstBase(record.contextBase, ledger).unchanged, true, '19: unchanged memory is detected');

  // The work relates to CTX-0004 only.
  const proposed = await proposeKnowledge(a, workId, { kind: 'business-rule', source: 'implementation-runtime', summary: 'Refunds are allowed within 14 days.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' });
  assert.equal(proposed.candidate.relation.factFingerprint, factFingerprint(ledger.facts[3]));
  await promoteKnowledge(a, workId, 'K-001');

  // Meanwhile on main: an unrelated fact (CTX-0006) changes, then CTX-0004 changes.
  const m = team.maintainer;
  const other = await investigation(m, 'Conventions');
  await learn(m, other, { kind: 'convention', summary: 'UI components are function components in frontend/ui.', evidence: ['frontend/ui/InvoiceView.jsx'], reconfirms: 'CTX-0006' });
  let plan = planIntegration((await loadContextLedger(m)).ledger, [{ meta: { id: workId }, candidate: (await json(a, `work/${workId}/knowledge.yaml`)).candidates[0], staging: (await loadWorkMemory(a, workId)).record.staged[0] }]);
  assert.deepEqual(plan.blocked, [], '20: a change to an unrelated fact does not block');
  const diff = diffAgainstBase(record.contextBase, (await loadContextLedger(m)).ledger);
  assert.deepEqual(diff.changed.map((entry) => entry.id), ['CTX-0006']);

  const rule = await investigation(m, 'Refund policy');
  await learn(m, rule, { kind: 'business-rule', summary: 'Refunds are allowed within 30 days (confirmed).', evidence: ['backend/refunds/policy.js'], reconfirms: 'CTX-0004' });
  plan = planIntegration((await loadContextLedger(m)).ledger, [{ meta: { id: workId }, candidate: (await json(a, `work/${workId}/knowledge.yaml`)).candidates[0], staging: (await loadWorkMemory(a, workId)).record.staged[0] }]);
  assert.equal(plan.blocked.length, 1, '21: a change to the referenced fact is detected');
  assert.equal(plan.blocked[0].blockers[0].code, 'changed-since-base');
  assert.match(plan.blocked[0].blockers[0].message, /CTX-0004 changed after this work related to it — updated/);
});

test('22. without Git the memory base is still a deterministic content fingerprint', async () => {
  const first = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-nogit-a-'));
  const second = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-nogit-b-'));
  for (const root of [first, second]) {
    await initWorkspace(root, 'X', 'greenfield');
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src', 'app.js'), 'export {};\n');
    const evidence = await normalizeEvidenceRefs(root, ['src/app.js']);
    await mutateContextLedger(root, (ops) => ops.introduce({ area: 'architecture', summary: 'Single module app.', evidence, origin: { workId: 'PF-0001', candidateId: 'K-001' } }), '2026-01-01T00:00:00.000Z');
  }
  const a = await captureContextBase(first, '2026-02-01T00:00:00.000Z');
  const b = await captureContextBase(second, '2026-02-01T00:00:00.000Z');
  assert.equal(a.gitCommit, null);
  assert.equal(a.ledgerFingerprint, b.ledgerFingerprint, 'same content → same fingerprint, in any directory');
  assert.deepEqual(a.facts, b.facts);
  assert.deepEqual(await captureContextBase(first, '2026-02-01T00:00:00.000Z'), a, 'stable across repeated captures');
});

// ---------------------------------------------------------------------------
// Work-local memory delta

test('23/24/25/26. on a feature branch knowledge is staged work-locally; canonical memory is untouched; DONE and handoff stay coherent', async () => {
  const team = await sharedTeam();
  const a = await developer(team, 'Dev A', 'AAAAAAAAAA', 'feature/refunds');
  const ledgerBefore = await readFile(contextLedgerPath(a), 'utf8');
  const projectBefore = await read(a, 'context/business-rules.md');
  const workId = await investigation(a, 'Refund window');
  const result = await learn(a, workId, { kind: 'business-rule', summary: 'Refunds are allowed within 14 days.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' });
  assert.equal(result.staged, true);
  assert.equal(result.candidate.status, 'staged');
  assert.equal(await readFile(contextLedgerPath(a), 'utf8'), ledgerBefore, '24: the canonical ledger is not mutated on a feature branch');
  assert.equal(await read(a, 'context/business-rules.md'), projectBefore);
  const memory = (await loadWorkMemory(a, workId)).record;
  assert.equal(memory.staged.length, 1);
  assert.equal(memory.staged[0].relation.factId, 'CTX-0004');
  assert.equal(memory.staged[0].branch, 'feature/refunds');

  // Direct canonical writes are refused off the integration branch.
  await assert.rejects(mutateContextLedger(a, (ops) => ops.touch('architecture')), /written only on the integration branch \(main\); this checkout is on feature\/refunds/);
  assert.match(cli(a, ['shared', 'integrate', '--dry-run']).stdout, /Preview — nothing written\. On main, integration would apply 1 update/);
  const refused = cli(a, ['shared', 'integrate'], false);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /integrated only on the integration branch \(main\); this checkout is on feature\/refunds[\s\S]*Nothing was changed/);
  assert.equal(await readFile(contextLedgerPath(a), 'utf8'), ledgerBefore);

  // 26: the staged delta is a completed disposition — DONE does not wait for integration.
  await complete(a, workId);
  assert.equal((await json(a, `work/${workId}/meta.yaml`)).status, 'DONE');
  assert.match(cli(a, ['doctor']).stdout, /Workspace healthy/);

  // 25: a fresh agent session sees where the delta stands from durable state only.
  const handoff = cli(a, ['handoff', workId]).stdout;
  assert.match(handoff, /Shared memory base: unchanged since this work began/);
  assert.match(handoff, /Staged knowledge K-001: reviewed; integrates into shared memory on the integration branch \(supersede\)/);
  assert.match(cli(a, ['resume', workId]).stdout, /Staged knowledge K-001/);
  assert.match(cli(a, ['knowledge', 'list', workId]).stdout, /K-001 \[staged\] business-rule/);
});

test('a relation proposed against a fact that changes before promotion is refused at staging (revalidate first)', async () => {
  const team = await sharedTeam();
  const m = team.maintainer;
  git(m, ['checkout', '-q', '-b', 'feature/x']);
  const workId = await investigation(m, 'Refund window');
  await proposeKnowledge(m, workId, { kind: 'business-rule', source: 'implementation-runtime', summary: 'Refunds allowed within 14 days.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' });
  // Main moves on: CTX-0004 is reconfirmed, then merged into this branch.
  git(m, ['stash', '-u', '-q']);
  git(m, ['checkout', '-q', 'main']);
  const other = await investigation(m, 'Policy');
  await learn(m, other, { kind: 'business-rule', summary: 'Refunds are allowed within 30 days.', evidence: ['backend/refunds/policy.js'], reconfirms: 'CTX-0004' });
  commitAll(m, 'reconfirm');
  git(m, ['checkout', '-q', 'feature/x']);
  git(m, ['merge', '-q', 'main']);
  git(m, ['stash', 'pop', '-q']);
  await assert.rejects(promoteKnowledge(m, workId, 'K-001'), /CTX-0004 changed after K-001 was proposed[\s\S]*reject K-001[\s\S]*Nothing was changed/);
  assert.equal((await json(m, `work/${workId}/knowledge.yaml`)).candidates[0].status, 'proposed');
});

// ---------------------------------------------------------------------------
// Integration

async function stagedOnBranch(team, name, tag, branch, input) {
  const root = await developer(team, name, tag, branch);
  const workId = await investigation(root, `${name} work`);
  await learn(root, workId, input);
  await complete(root, workId);
  commitAll(root, branch);
  git(root, ['push', '-q', 'origin', branch]);
  return { root, workId };
}

test('27/28/29/30/35. safe new facts, reconfirmations, supersessions, and exact duplicates integrate with full provenance', async () => {
  const team = await sharedTeam();
  const m = team.maintainer;
  const fresh = await stagedOnBranch(team, 'Dev A', 'AAAAAAAAAA', 'feature/a', { kind: 'integration', summary: 'Payments go through the Stripe API.', evidence: ['src/server.js'] });
  const reconfirm = await stagedOnBranch(team, 'Dev B', 'BBBBBBBBBB', 'feature/b', { kind: 'tech-stack', summary: 'Backend is Express on Node.js; frontend is React 18.', evidence: ['package.json'], reconfirms: 'CTX-0002' });
  const supersede = await stagedOnBranch(team, 'Dev C', 'CCCCCCCCCC', 'feature/c', { kind: 'business-rule', summary: 'Refunds are allowed within 14 days.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' });
  const duplicate = await stagedOnBranch(team, 'Dev D', 'DDDDDDDDDD', 'feature/d', { kind: 'convention', summary: 'UI components are function components in frontend/ui.', evidence: ['frontend/ui/InvoiceView.jsx'] });
  for (const branch of ['feature/a', 'feature/b', 'feature/c', 'feature/d']) assert.equal(mergeBranch(m, branch).status, 0);
  const preview = cli(m, ['shared', 'integrate', '--dry-run']).stdout;
  assert.match(preview, /Preview — nothing written\. On main, integration would apply 4 update\(s\)/);
  assert.match(preview, /\[duplicate of CTX-0006\]/);
  const ledgerBefore = await readFile(contextLedgerPath(m), 'utf8');
  cli(m, ['shared', 'status']);
  assert.equal(await readFile(contextLedgerPath(m), 'utf8'), ledgerBefore, 'preview and status write nothing');

  const out = cli(m, ['shared', 'integrate', '--verbose']).stdout;
  assert.match(out, /Integrated 4 project-knowledge update\(s\) from merged work/);
  assert.match(out, /Nothing was committed/);
  const { ledger } = await loadContextLedger(m);
  const byId = Object.fromEntries(ledger.facts.map((fact) => [fact.id, fact]));
  assert.equal(byId['CTX-0007'].summary, 'Payments go through the Stripe API.', '27: new fact');
  assert.equal(byId['CTX-0002'].history.at(-1).action, 'reconfirmed', '28: reconfirmation');
  assert.equal(byId['CTX-0004'].state, 'superseded', '29: supersession');
  assert.equal(byId['CTX-0004'].supersededBy, 'CTX-0008');
  assert.equal(ledger.facts.length, 8, '30: the exact duplicate created no new fact');
  assert.deepEqual(byId['CTX-0006'].origins.map((origin) => origin.workId), ['PF-0001', duplicate.workId], '30: recorded as an additional origin');

  // 35: provenance — fact → originating work + candidate → actor, base, integration record.
  assert.deepEqual(byId['CTX-0007'].origins, [{ workId: fresh.workId, candidateId: 'K-001' }]);
  const memory = (await loadWorkMemory(m, fresh.workId)).record;
  assert.equal(memory.createdBy.actor.name, 'Dev A');
  assert.match(memory.contextBase.ledgerFingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(memory.integrations.map(({ candidate, factId, action, branch }) => ({ candidate, factId, action, branch })), [{ candidate: 'K-001', factId: 'CTX-0007', action: 'introduced', branch: 'main' }]);
  assert.equal((await json(m, `work/${supersede.workId}/knowledge.yaml`)).candidates[0].factId, 'CTX-0008');
  assert.equal((await loadWorkMemory(m, reconfirm.workId)).record.integrations[0].action, 'reconfirmed');
  assert.match(await read(m, 'context/business-rules.md'), /14 days/);
  assert.match(cli(m, ['doctor']).stdout, /Workspace healthy/);
  assert.match(cli(m, ['shared', 'status']).stdout, /Pending memory integrations: none/);
});

test('31/40. conflicting parallel supersessions block, never overwrite, and memory stays healthy until reconciled', async () => {
  const team = await sharedTeam();
  const m = team.maintainer;
  const a = await stagedOnBranch(team, 'Dev A', 'AAAAAAAAAA', 'feature/a', { kind: 'business-rule', summary: 'Refunds are allowed within 14 days.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' });
  const b = await stagedOnBranch(team, 'Dev B', 'BBBBBBBBBB', 'feature/b', { kind: 'business-rule', summary: 'Refunds are allowed within 60 days.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' });
  const c = await stagedOnBranch(team, 'Dev C', 'CCCCCCCCCC', 'feature/c', { kind: 'architecture', summary: 'Invoice UI lives in frontend/ui.', evidence: ['frontend/ui/InvoiceView.jsx'] });
  for (const branch of ['feature/a', 'feature/b', 'feature/c']) assert.equal(mergeBranch(m, branch).status, 0);
  const check = cli(m, ['shared', 'check'], false);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /FAIL pending memory deltas integrate safely/);
  assert.match(check.stdout, /CTX-0004 is also changed by PF-BBBBBBBBBB-0001 K-001 \(supersedes\)/);

  const integrate = cli(m, ['shared', 'integrate'], false);
  assert.equal(integrate.status, 1);
  assert.match(integrate.stdout, /Integrated 1 project-knowledge update/, 'the independent update still integrates');
  assert.match(integrate.stdout, /2 update\(s\) need reconciliation and were not applied/);
  const { ledger } = await loadContextLedger(m);
  assert.equal(ledger.facts.find((fact) => fact.id === 'CTX-0004').state, 'current', 'no silent overwrite');
  assert.equal(ledger.facts.length, 7);
  const doctor = cli(m, ['doctor']).stdout;
  assert.match(doctor, /Workspace healthy/);
  assert.match(doctor, /WARN pending memory delta PF-AAAAAAAAAA-0001 K-001 needs reconciliation/);
  assert.match(cli(m, ['brief']).stdout, /Primary next concern: 2 pending shared knowledge update\(s\) changed in parallel and need reconciliation/);

  // Reconciliation through existing primitives: B's claim is withdrawn after a human
  // decision; A's then integrates.
  await rejectKnowledge(m, b.workId, 'K-001', 'Product owner confirmed the 14-day window (A).');
  const retry = cli(m, ['shared', 'integrate']).stdout;
  assert.match(retry, /Integrated 1 project-knowledge update/);
  const after = (await loadContextLedger(m)).ledger;
  assert.equal(after.facts.find((fact) => fact.id === 'CTX-0004').supersededBy, 'CTX-0008');
  assert.match(cli(m, ['shared', 'check']).stdout, /Result: PASS/);
  assert.ok(c.workId);
  assert.equal(a.workId, 'PF-AAAAAAAAAA-0001');
});

test('32. a stale base on a feature branch is detected before push, with developer-facing guidance', async () => {
  const team = await sharedTeam();
  const m = team.maintainer;
  await stagedOnBranch(team, 'Dev A', 'AAAAAAAAAA', 'feature/a', { kind: 'business-rule', summary: 'Refunds are allowed within 14 days.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' });
  const b = await developer(team, 'Dev B', 'BBBBBBBBBB', 'feature/b');
  const workId = await investigation(b, 'Refund policy B');
  await learn(b, workId, { kind: 'business-rule', summary: 'Refunds are allowed within 60 days.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' });
  await complete(b, workId);
  commitAll(b, 'B');
  assert.match(cli(b, ['finish', workId]).stdout, /Ready to push\./, 'nothing changed yet from this checkout\'s point of view');

  // A lands on main and is integrated; B updates the branch with main.
  assert.equal(mergeBranch(m, 'feature/a').status, 0);
  cli(m, ['shared', 'integrate']);
  commitAll(m, 'integrate shared memory');
  git(m, ['push', '-q', 'origin', 'main']);
  git(b, ['pull', '-q', '--no-rebase', 'origin', 'main']);

  const finish = cli(b, ['finish', workId], false);
  assert.equal(finish.status, 1);
  assert.match(finish.stdout, /Shared project knowledge changed while this task was in progress\. I need to revalidate it/);
  assert.match(finish.stdout, /For the agent:\n  - revalidate K-001/);
  const check = cli(b, ['shared', 'check'], false);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /CTX-0004 changed after this work related to it — superseded by CTX-0007/);
  assert.match(check.stdout, /Update the branch with main, then ask the coding agent to continue/);
});

test('33/34. integration retry is idempotent and an interrupted or failed integration is never half-applied', async () => {
  const team = await sharedTeam();
  const m = team.maintainer;
  await stagedOnBranch(team, 'Dev A', 'AAAAAAAAAA', 'feature/a', { kind: 'integration', summary: 'Emails go through SMTP.', evidence: ['src/server.js'] });
  await stagedOnBranch(team, 'Dev B', 'BBBBBBBBBB', 'feature/b', { kind: 'business-rule', summary: 'Refunds are allowed within 14 days.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' });
  for (const branch of ['feature/a', 'feature/b']) assert.equal(mergeBranch(m, branch).status, 0);

  // 34: the canonical write fails → nothing changes, nothing is marked promoted.
  const contextDir = path.join(workspacePath(m), 'context');
  const before = await treeHash(m);
  await chmod(contextDir, 0o555);
  try {
    const failed = cli(m, ['shared', 'integrate'], false);
    assert.notEqual(failed.status, 0);
  } finally {
    await chmod(contextDir, 0o755);
  }
  assert.equal(await treeHash(m), before, 'no half-applied integration');

  cli(m, ['shared', 'integrate']);
  const integrated = await treeHash(m);
  // 33: re-running is a no-op.
  assert.match(cli(m, ['shared', 'integrate']).stdout, /up to date/);
  assert.equal(await treeHash(m), integrated);

  // Interrupted after the ledger write, before bookkeeping: retry finishes it without
  // re-applying anything.
  const ledgerAfter = await readFile(contextLedgerPath(m), 'utf8');
  commitAll(m, 'integrated');
  git(m, ['checkout', '-q', 'HEAD~1', '--', '.yallaflow/work']);
  assert.match(cli(m, ['doctor']).stdout, /integration bookkeeping is incomplete; re-run `yallaflow shared integrate`/);
  cli(m, ['shared', 'integrate']);
  assert.equal(await readFile(contextLedgerPath(m), 'utf8'), ledgerAfter, 'no fact applied twice');
  assert.equal(git(m, ['diff', '--name-only', 'HEAD']).stdout, '', 'bookkeeping restored byte-for-byte');
});

test('integration is deterministic: two maintainers integrating the same merge produce identical files', async () => {
  const team = await sharedTeam();
  const m = team.maintainer;
  await stagedOnBranch(team, 'Dev A', 'AAAAAAAAAA', 'feature/a', { kind: 'integration', summary: 'Emails go through SMTP.', evidence: ['src/server.js'] });
  assert.equal(mergeBranch(m, 'feature/a').status, 0);
  git(m, ['push', '-q', 'origin', 'main']);
  const second = await developer(team, 'Second Maintainer', 'SSSSSSSSSS');
  cli(m, ['shared', 'integrate']);
  cli(second, ['shared', 'integrate']);
  for (const relative of ['context/index.yaml', 'context/integrations.md', 'work/PF-AAAAAAAAAA-0001/knowledge.yaml', 'work/PF-AAAAAAAAAA-0001/memory.yaml']) {
    assert.equal(await read(second, relative), await read(m, relative), relative);
  }
});

// ---------------------------------------------------------------------------
// Doctor / shared integrity

test('doctor detects unsafe shared state: legacy IDs after sharing, local state committed or misplaced, bad metadata, missing CTX, missing provenance', async () => {
  const team = await sharedTeam();
  const a = await developer(team, 'Dev A', 'AAAAAAAAAA', 'feature/a');
  const workId = await investigation(a, 'Refunds');
  await learn(a, workId, { kind: 'business-rule', summary: 'Refunds are allowed within 14 days.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' });
  assert.match(cli(a, ['doctor']).stdout, /Workspace healthy/);
  const base = workspacePath(a);
  const memoryFile = path.join(base, 'work', workId, 'memory.yaml');
  const original = await readFile(memoryFile, 'utf8');

  const record = JSON.parse(original);
  record.createdBy.actor.email = 'not an email';
  record.contextBase.facts['CTX-0999'] = '0123456789abcdef';
  record.contextBase.factCount += 1;
  record.staged[0].relation.factId = 'CTX-0998';
  await writeFile(memoryFile, JSON.stringify(record));
  const broken = cli(a, ['doctor'], false).stdout;
  assert.match(broken, /FAIL .*createdBy actor email is malformed/);
  assert.match(broken, /FAIL .*memory base references CTX-0999, which does not exist in project memory \(impossible memory base/);
  assert.match(broken, /FAIL .*pending memory delta K-001 refers to CTX-0998, which does not exist/);
  await writeFile(memoryFile, original);

  // A hand edit to canonical memory claiming provenance that was never approved.
  const ledgerFile = contextLedgerPath(a);
  const ledgerText = await readFile(ledgerFile, 'utf8');
  const forged = JSON.parse(ledgerText);
  const fake = structuredClone(forged.facts[0]);
  Object.assign(fake, { id: 'CTX-0007', area: 'architecture', summary: 'Forged.', supersedes: [], supersededBy: null });
  if (fake.origins) fake.origins = [{ workId, candidateId: 'K-009' }]; else fake.origin = { workId, candidateId: 'K-009' };
  fake.history = [{ action: 'introduced', at: fake.createdAt, workId, candidateId: 'K-009' }];
  forged.facts.push(fake);
  await writeFile(ledgerFile, JSON.stringify(forged, null, 2));
  assert.match(cli(a, ['doctor'], false).stdout, /FAIL CTX-0007 claims provenance from PF-AAAAAAAAAA-0001 K-009, which was never approved for project memory/);
  await writeFile(ledgerFile, ledgerText);


  // A Shared-unaware CLI writing canonical memory and sequential IDs on a branch.
  const configFile = path.join(base, 'config.yaml');
  const sharedConfig = await readFile(configFile, 'utf8');
  const single = JSON.parse(sharedConfig);
  delete single.shared;
  delete single.yallaflow;
  single.schemaVersion = 1;
  await writeFile(configFile, JSON.stringify(single));
  const legacyWork = await investigation(a, 'Old CLI work');
  await learn(a, legacyWork, { kind: 'architecture', summary: 'Written by an old CLI.', evidence: ['src/server.js'] });
  await writeFile(configFile, sharedConfig);
  const unsafe = cli(a, ['doctor'], false).stdout;
  assert.equal(legacyWork, 'PF-0002');
  assert.match(unsafe, /FAIL PF-0002 was created after this project became shared .* sequential ID that can collide across branches/);
  assert.match(unsafe, /FAIL PF-0002 K-001 was written into canonical project memory \(CTX-0007\) without a shared integration record/);
  git(a, ['checkout', '-q', '--', '.yallaflow']);
  git(a, ['clean', '-fdq', '--', '.yallaflow/work', '.yallaflow/decisions']);

  // Local-only state committed, or shared state hidden under local/.
  git(a, ['add', '-f', '.yallaflow/local/identity.yaml']);
  await mkdir(path.join(base, 'local', 'work'), { recursive: true });
  const leaked = cli(a, ['shared', 'check'], false);
  assert.equal(leaked.status, 1);
  assert.match(leaked.stdout, /local-only state is committed: \.yallaflow\/local\/identity\.yaml/);
  assert.match(leaked.stdout, /\.yallaflow\/local\/work exists — shared project state stored under the local-only directory/);
});

// ---------------------------------------------------------------------------
// CI

test('47/48/49/50/51. shared check is read-only, provider-neutral, passes a safe branch, and fails a stale one with actionable output', async () => {
  const team = await sharedTeam();
  const a = await developer(team, 'Dev A', 'AAAAAAAAAA', 'feature/a');
  const workId = await investigation(a, 'Refund window');
  await learn(a, workId, { kind: 'business-rule', summary: 'Refunds are allowed within 14 days.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' });
  await complete(a, workId);
  commitAll(a, 'A');
  // CI checks out a detached commit with no provider-specific environment.
  git(a, ['checkout', '-q', '--detach']);
  const before = await treeHash(a);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(CI|GITHUB_|GITLAB_|TF_BUILD|SYSTEM_|BUILD_)/.test(key)));
  const { spawnSync } = await import('node:child_process');
  const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)), 'shared', 'check'], { cwd: a, encoding: 'utf8', env });
  const pass = run();
  assert.equal(pass.status, 0, pass.stdout + pass.stderr);
  assert.match(pass.stdout, /checked commit: detached HEAD/);
  assert.match(pass.stdout, /Result: PASS/);
  assert.equal(await treeHash(a), before, '47: read-only');

  // The same branch after a parallel change to the fact it supersedes (the PR merge ref).
  const m = team.maintainer;
  const other = await investigation(m, 'Refunds policy');
  await learn(m, other, { kind: 'business-rule', summary: 'Refunds are allowed within 30 days, per finance.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' });
  commitAll(m, 'main moved');
  git(m, ['push', '-q', 'origin', 'main']);
  git(a, ['fetch', '-q', 'origin']);
  git(a, ['merge', '-q', '--no-edit', 'origin/main']);
  const fail = run();
  assert.equal(fail.status, 1);
  assert.match(fail.stdout, /FAIL pending memory deltas integrate safely\n  - PF-AAAAAAAAAA-0001 K-001: CTX-0004 changed after this work related to it — superseded by CTX-0007/);
  assert.match(fail.stdout, /Result: FAIL/);
});

test('51/no-network: YallaFlow source never invokes mutating or network Git subcommands and calls no LLM provider', async () => {
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
  const offenders = [];
  const allowed = new Set(['status', 'rev-parse', 'diff', 'ls-files', 'ls-tree', 'check-ignore', 'symbolic-ref', 'config']);
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.js')) {
        const text = await readFile(full, 'utf8');
        for (const match of text.matchAll(/spawnSync\('git', \[\s*'([a-z-]+)'/g)) if (!allowed.has(match[1])) offenders.push(`${entry.name}: git ${match[1]}`);
        for (const match of text.matchAll(/git\(root, \['([a-z-]+)'/g)) if (!allowed.has(match[1])) offenders.push(`${entry.name}: git ${match[1]}`);
        if (/\bfetch\(|https?:\/\/(?!claude\.com)|node:https?['"]|node:net['"]|anthropic|openai/i.test(text)) offenders.push(`${entry.name}: network/provider reference`);
      }
    }
  }
  await walk(srcDir);
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// UX

test('42/43/44/45. the adapter orients automatically; finish speaks outcome language and keeps the audit in --verbose', async () => {
  const team = await sharedTeam();
  const claude = await readFile(path.join(team.maintainer, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /@\.yallaflow\/AGENT\.md/);
  assert.match(claude, /automatically, before handling the first request; the developer does not need to say "use YallaFlow"/);
  const a = await developer(team, 'Dev A', 'AAAAAAAAAA', 'feature/a');
  const workId = await investigation(a, 'Refund window');
  await learn(a, workId, { kind: 'business-rule', summary: 'Refunds are allowed within 14 days.', evidence: ['backend/refunds/policy.js'], supersedes: 'CTX-0004' });
  await complete(a, workId);
  commitAll(a, 'done');
  const finish = cli(a, ['finish', workId]).stdout;
  assert.equal(finish, 'Completed and verified. New project knowledge from this task will join the shared project memory after it is merged.\nReady to push.\n');
  assert.doesNotMatch(finish, /PF-|CTX-|K-\d|SRC-|checkpoint|FRESH|promot/, '44: no internal mechanics on the normal path');
  const verbose = cli(a, ['finish', workId, '--verbose']).stdout;
  assert.match(verbose, new RegExp(`work: ${workId} \\(investigation / bounded\\) at DONE`));
  assert.match(verbose, /verification: V-001 passed/);
  assert.match(verbose, /memory base: [0-9a-f]{12} → current [0-9a-f]{12} \(unchanged\)/);
  assert.match(verbose, /staged K-001: supersede/);
  // Not finished yet → plain reason for the developer, exact step for the agent.
  const open = await investigation(a, 'Another question');
  const notReady = cli(a, ['finish', open], false);
  assert.equal(notReady.status, 1);
  assert.match(notReady.stdout, /^Not finished yet — the task is still in progress\.\n\nFor the agent:\n  - yallaflow guide PF-AAAAAAAAAA-0002/);
});

// ---------------------------------------------------------------------------
// Compatibility

test('53/54. single-user baseline, freshness, reconciliation helpers and durable sources behave as before', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-compat-'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'Solo']);
  git(root, ['config', 'user.email', 'solo@example.com']);
  await writeTeamApp(root);
  await initWorkspace(root, 'Solo', 'brownfield');
  await approveTeamBaseline(root);
  await writeFile(path.join(root, 'notes.md'), '# notes\n');
  cli(root, ['intake', 'notes.md']);
  assert.deepEqual(await readdir(path.join(workspacePath(root), 'sources')), ['SRC-0001']);
  assert.match(cli(root, ['source', 'show', 'SRC-0001']).stdout, /notes\.md/);
  await writeFile(path.join(root, 'backend', 'refunds', 'policy.js'), 'export const REFUND_WINDOW_DAYS = 14;\n');
  assert.match(cli(root, ['context', 'status']).stdout, /MAY_BE_STALE/);
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy/);
  assert.equal(await exists(path.join(workspacePath(root), 'local')), false, 'no local/ directory outside Shared Projects');
});

test('read commands never write in a Shared Project — not even a fresh clone\'s local identity', async () => {
  const team = await sharedTeam();
  const a = await developer(team, 'Dev A', 'AAAAAAAAAA', 'feature/a');
  const workId = await investigation(a, 'Refund window');
  await learn(a, workId, { kind: 'architecture', summary: 'Refunds live in backend/refunds.', evidence: ['backend/refunds/refunds.js'] });
  const fresh = path.join(team.dir, 'fresh');
  git(team.dir, ['clone', '-q', team.origin, fresh]);
  for (const [root, id] of [[a, workId], [fresh, 'PF-0001']]) {
    const before = await treeHash(root);
    for (const args of [['brief'], ['status'], ['doctor'], ['finish'], ['handoff', id], ['resume', id], ['guide', id], ['shared', 'status', '--verbose'], ['shared', 'check'],
      ['shared', 'integrate', '--dry-run'], ['context', 'status'], ['upgrade', 'status'], ['upgrade', 'plan'], ['inspect'], ['knowledge', 'list', id], ['purpose', 'show', id], ['baseline', 'status'], ['agent', 'status']]) {
      cli(root, args, false);
    }
    assert.equal(await treeHash(root), before, `${path.basename(root)}: read commands wrote nothing`);
  }
  assert.equal(await exists(path.join(workspacePath(fresh), 'local')), false);
});
