// v1.0.1 work routing before editing (Agent Contract v9, bootstrap v3). A field report
// (Sekaya, v1.0.0) showed an agent that oriented correctly, then edited application code
// without a work item and offered YallaFlow tracking afterwards as optional. The v8
// contract only said "do not modify code while guidance says it is not authorized",
// which is vacuous when no work item exists.
//
// What these tests can prove: the contract and bootstrap text, and the CLI paths the
// text sends an agent down (lightweight bounded work, active-work reuse, operational
// commands that create nothing, verification/finish, recovery, legacy refresh). What
// they cannot prove: that a real agent obeys the text. A text contract does not stop a
// direct file write; real-agent behavior must be checked separately in a real agent
// session (the Sekaya acceptance check in docs/upgrading-to-v1.0.1.md).
//
// Which tests would fail on v1.0.0: the contract/bootstrap text, the brief line, and the
// legacy refresh tests. The CLI-path tests pin existing behavior the new text relies on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { AGENT_CONTRACT_VERSION, agentContractBody, inspectAgentContract, renderAgentContractBlock } from '../src/agent/contract.js';
import { BOOTSTRAP_PROVIDERS, BOOTSTRAP_VERSION, bootstrapBody, inspectBootstrap, renderBootstrapBlock } from '../src/agent/bootstrap.js';
import { approveTeamBaseline, cli, frozenCli, git, writeTeamApp } from '../test-support/shared.js';

const SEKAYA = "Move the project's Edit and Delete buttons into a three-dots ActionGroup at the end of the table";
const repo = fileURLToPath(new URL('../', import.meta.url));
const V100 = path.join(repo, 'test', 'fixtures', 'v1.0.0-agent');

async function gitRepo(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'dev@example.com']);
  git(root, ['config', 'user.name', 'Dev']);
  return root;
}

async function greenfield() {
  const root = await gitRepo('yallaflow-routing-green-');
  cli(root, ['init', '--name', 'Sekaya']);
  return root;
}

async function brownfield({ approved = true } = {}) {
  const root = await gitRepo('yallaflow-routing-brown-');
  await writeTeamApp(root);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'app']);
  cli(root, ['init', '--name', 'Sekaya']);
  if (approved) await approveTeamBaseline(root);
  return root;
}

// Every file under .yallaflow/ with its bytes: proves a command wrote nothing.
async function snapshot(dir) {
  const out = {};
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[path.relative(dir, full)] = await readFile(full, 'utf8');
    }
  }
  await walk(dir);
  return out;
}

const guide = (root, id) => cli(root, ['guide', id]).stdout;
const authorized = (root, id) => /Application code modification: AUTHORIZED/.test(guide(root, id));

// The whole lightweight path for a bounded change, up to the write stage.
function routeToImplementation(root, id) {
  for (let i = 0; i < 5; i += 1) cli(root, ['advance', id]);
  for (const skill of ['context-discovery', 'requirement-clarification', 'implementation-planning']) {
    cli(root, ['checkpoint', id, '--skill', skill, '--complete', '--summary', `${skill} done`]);
  }
  assert.match(cli(root, ['advance', id]).stdout, /PLAN → IMPLEMENTATION/);
}

function verifyAndFinish(root, id) {
  cli(root, ['checkpoint', id, '--skill', 'implementation', '--complete', '--summary', 'ActionGroup in place']);
  cli(root, ['advance', id]);
  cli(root, ['verify', id, '--', process.execPath, '-e', '0']);
  cli(root, ['checkpoint', id, '--skill', 'verification', '--complete', '--summary', 'checks pass', '--evidence', 'verification:V-001']);
  cli(root, ['knowledge', 'review', id, '--none']);
  assert.match(cli(root, ['advance', id]).stdout, /VERIFICATION → DONE/);
  return cli(root, ['finish', id]);
}

// ---------------------------------------------------------------------------
// Contract and bootstrap text (automated contract evidence, not agent behavior)

test('contract v9 requires a routed, authorized work item before the first engineering edit', () => {
  assert.ok(AGENT_CONTRACT_VERSION >= 9, 'v9 rules stay in every later contract');
  const body = agentContractBody();
  assert.match(body, /^8\. Route before editing\. Every intentional engineering change, however small, is made inside a routed work item at a stage that authorizes it\./m);
  assert.match(body, /^## Work routing before editing$/m);
  assert.match(body, /Before your first edit to an engineering artifact, the change must belong to a routed work item whose yallaflow guide reports application code modification AUTHORIZED/);
  assert.match(body, /An engineering artifact is any tracked project file other than YallaFlow state: application source, tests, migrations, configuration, build and deployment files, and documentation\. Temporary debug logging and exploratory edits count\. So does a command that would modify tracked files/);
  assert.match(body, /Input files you write only to feed a yallaflow command, such as baseline, requirement, or convergence JSON, are not engineering artifacts: write them to a temporary directory/);
  assert.match(body, /never has to say "use YallaFlow" or "track this"/);
  assert.match(body, /any intentional edit to an engineering artifact is engineering work/);
  assert.match(body, /edit engineering artifacts only when guidance for the routed work item reports modification authorized/);
  assert.match(body, /Every engineering change ends with yallaflow finish for its work item/);
  // Honest about its limits.
  assert.match(body, /This contract is an instruction, not a technical lock: YallaFlow cannot stop a direct file write by itself/);
});

test('contract v9 keeps small changes lightweight and operational help outside work items', () => {
  const body = agentContractBody();
  assert.match(body, /Size never exempts a change from routing\. Size sets the weight of the workflow\./);
  assert.match(body, /A routine, low-risk change, such as a small UI adjustment, a straightforward bug, or a copy or style fix, is bounded work/);
  assert.match(body, /In the default adaptive interaction mode, bounded work has no specification or plan review and needs no lengthy specification/);
  assert.match(body, /without routine approvals\. Ask only about material business ambiguity\./);
  assert.match(body, /If the project's interaction mode does request a review gate, that gate is a human decision: ask the developer, and never approve it yourself\./);
  assert.match(body, /operational assistance \(start a dev server, open the application, show logs, check git status, inspect processes or ports, run the existing tests to report their state\) need no work item/);
  assert.match(body, /When operational help shows that a change is needed, route it before the first edit/);
  // The v8 operational-assistance paragraph is still there.
  assert.match(body, /Transient operational assistance — start Docker or a dev server, open the application, show logs, check git status, inspect local processes or ports — is handled directly, without a YallaFlow work item/);
});

test('contract v9 reuses covering active work and never duplicates it', () => {
  const body = agentContractBody();
  assert.match(body, /Reuse before creating\. If yallaflow brief or yallaflow status shows an active or resumable work item whose objective covers the request, continue it \(yallaflow resume, then yallaflow guide\)\. Do not create a duplicate\./);
  assert.match(body, /A request outside that objective is new work: route it separately, and never fold it silently into the active item\./);
  assert.match(body, /A read-only investigation never authorizes edits, so route the fix as new work\. For a follow-up to a DONE item, reopen it \(yallaflow reopen\) or route new work\. Never edit under a finished item\./);
});

test('contract v9 documents recovery of an untracked edit without reverting, rewriting history, or backdating', () => {
  const body = agentContractBody();
  assert.match(body, /Keep the change\. Do not revert, stash, reset, or rewrite it, and do not touch Git history\./);
  assert.match(body, /Tell the developer plainly that the change was made before it was tracked/);
  assert.match(body, /Make no further edits until guidance authorizes them\./);
  assert.match(body, /Its records carry the current time and are never backdated/);
  assert.match(body, /In a Brownfield project without approved understanding, routing is refused: keep the change, disclose it, run the baseline, and recover the change after the developer approves it\./);
  assert.match(body, /Inspect or reproduce the earlier behavior read-only against HEAD \(git show HEAD:<path>, or a temporary git worktree of HEAD\), or record that reproduction is unavailable\./);
  assert.match(body, /When you cannot tell whether a change is theirs, ask\. If an untracked change was already committed, route it the same way and cite its commit; never rewrite that commit\./);
  assert.match(body, /yallaflow checkpoint <work-id> --ruling "<paths> were edited before this work item existed, without workflow authorization; adopted for review and verification"/);
  assert.match(body, /Verification runs fresh against the working tree/);
  assert.match(body, /Never claim that the earlier edit was authorized or that evidence existed before it did/);
  assert.match(body, /the developer's own work in progress, stay theirs\. Leave them untouched and out of the work item/);
});

test('bootstrap v3 carries the route-before-edit precondition for every provider and still defers to AGENT.md', () => {
  assert.equal(BOOTSTRAP_VERSION, 3);
  for (const provider of Object.values(BOOTSTRAP_PROVIDERS)) {
    const body = bootstrapBody(provider);
    assert.match(body, /^6\. Before the first edit to source, tests, migrations, configuration, or any engineering artifact, even a small one: continue the active work item that covers the request or route one \(`yallaflow start`\), and edit only once `yallaflow guide` authorizes it\./m);
    assert.match(body, /Small changes route as bounded work: no spec or plan review by default\. Operational help needs no work item\./);
    assert.match(body, /never edit engineering artifacts while guidance says it is not authorized/);
    assert.match(body, /^9\. Before saying a task is done, run `yallaflow finish <work-id>`\. Tracking is never optional and never offered after the fact\. Recover untracked edits as AGENT\.md describes\.$/m);
    assert.match(body, /\.yallaflow\/AGENT\.md/);
  }
});

const OPTIONAL_TRACKING = [
  /(would you like|do you want|shall i|should i|want me to)[^.\n?]{0,80}\b(track|record|log)\b[^.\n?]{0,40}yallaflow/i,
  /\b(track|record|log)\b[^.\n?]{0,40}(in|with|through) yallaflow\?/i,
  /yallaflow[^.\n]{0,40}\btracking\b[^.\n]{0,20}\bis optional\b/i,
  /\boptional(ly)?\b[^.\n]{0,40}\b(track|record)\b[^.\n]{0,40}\b(yallaflow|work item)\b/i,
  /(would you like|do you want|shall i|should i|want me to)[^.\n?]{0,40}\b(create|open|start)\b[^.\n?]{0,30}(yallaflow )?work item[^.\n?]{0,40}\?/i
];

test('documentation lint: no agent-facing text, doc, or normal CLI output presents YallaFlow tracking as optional', async () => {
  const texts = {
    'Agent Contract': agentContractBody(),
    ...Object.fromEntries(Object.values(BOOTSTRAP_PROVIDERS).map((provider) => [provider.file, bootstrapBody(provider)]))
  };
  for (const doc of ['README.md', 'docs/using-yallaflow.md', 'docs/guide.md', 'docs/upgrading-to-v1.0.1.md']) {
    texts[doc] = await readFile(path.join(repo, doc), 'utf8');
  }
  const root = await greenfield();
  texts['brief (no work)'] = cli(root, ['brief']).stdout;
  cli(root, ['change', SEKAYA, '--scope', 'bounded']);
  texts['finish (in progress)'] = cli(root, ['finish', 'PF-0001'], false).stdout;
  for (const [name, text] of Object.entries(texts)) {
    for (const pattern of OPTIONAL_TRACKING) assert.doesNotMatch(text, pattern, `${name} must not offer tracking as optional`);
  }
  assert.match(agentContractBody(), /Never ask the developer whether to track a change in YallaFlow\. Never offer tracking as an optional follow-up\./);
});

// ---------------------------------------------------------------------------
// CLI paths the contract relies on

test('brief with no active work ties a new request to routing before the first edit', async () => {
  const root = await brownfield();
  const brief = cli(root, ['brief']).stdout;
  assert.match(brief, /Primary next concern: none — ready for new work; route an engineering change before its first edit \(small changes route as bounded work\)/);
  assert.match(brief, /Next: yallaflow start "<request>"/);
});

test('CLI path for the Sekaya scenario: the bounded UI change is not authorized until routed and advanced, then needs no human approval in adaptive mode', async () => {
  const root = await brownfield();
  // Before routing there is no active work item, so nothing authorizes an edit
  // (the only item is the approved baseline, PF-0001).
  assert.match(cli(root, ['status']).stdout, /Active work: none[\s\S]*Work items: 1\n/);
  cli(root, ['start', SEKAYA]);
  cli(root, ['route', 'PF-0002', '--type', 'change', '--scope', 'bounded', '--confidence', 'high',
    '--reason', 'Small UI rearrangement of existing actions; no data, authorization, or contract change.', '--title', 'Project table actions in a three-dots ActionGroup']);
  assert.equal(authorized(root, 'PF-0002'), false, 'INTAKE never authorizes an edit');
  routeToImplementation(root, 'PF-0002');
  assert.equal(authorized(root, 'PF-0002'), true);
  // Lightweight: no review gate was requested on the way, and no specification stage.
  const reviews = await readFile(path.join(root, '.yallaflow', 'work', 'PF-0002', 'reviews.yaml'), 'utf8').catch(() => '{"gates":{}}');
  assert.deepEqual(JSON.parse(reviews).gates, {});
  assert.doesNotMatch(guide(root, 'PF-0002'), /awaiting_review|yallaflow approve/);
  const finish = verifyAndFinish(root, 'PF-0002');
  assert.equal(finish.status, 0);
  assert.match(finish.stdout, /Implemented and verified\./);
});

test('CLI path in gated mode: a bounded change stops at a human implementation review the agent must not self-approve', async () => {
  const root = await gitRepo('yallaflow-routing-gated-');
  cli(root, ['init', '--name', 'Sekaya', '--mode', 'gated']);
  cli(root, ['change', SEKAYA, '--scope', 'bounded']);
  routeToImplementation(root, 'PF-0001');
  cli(root, ['checkpoint', 'PF-0001', '--skill', 'implementation', '--complete', '--summary', 'done']);
  const blocked = cli(root, ['advance', 'PF-0001'], false);
  assert.notEqual(blocked.status, 0);
  assert.match(`${blocked.stdout}${blocked.stderr}`, /implementation review is awaiting_review/);
  // The contract names this a human decision, so the bounded-work wording cannot invite self-approval.
  assert.match(agentContractBody(), /that gate is a human decision: ask the developer, and never approve it yourself/);
});

test('verification and finish requirements still hold for lightweight work', async () => {
  const root = await greenfield();
  cli(root, ['change', SEKAYA, '--scope', 'bounded']);
  const early = cli(root, ['finish', 'PF-0001'], false);
  assert.equal(early.status, 1);
  assert.match(early.stdout, /Not finished yet — the task is still in progress\./);
  routeToImplementation(root, 'PF-0001');
  cli(root, ['checkpoint', 'PF-0001', '--skill', 'implementation', '--complete', '--summary', 'done']);
  cli(root, ['advance', 'PF-0001']);
  // No fresh verification: DONE is refused.
  const refused = cli(root, ['advance', 'PF-0001'], false);
  assert.notEqual(refused.status, 0);
  assert.match(`${refused.stdout}${refused.stderr}`, /verification/i);
  assert.match(guide(root, 'PF-0001'), /yallaflow verify PF-0001 -- <command>/);
});

test('CLI path for active-work reuse: brief and status point to the covering item; an unrelated request becomes a separate item', async () => {
  const root = await greenfield();
  cli(root, ['change', SEKAYA, '--scope', 'bounded']);
  const brief = cli(root, ['brief']).stdout;
  assert.match(brief, /Active work: PF-0001/);
  assert.match(brief, /Primary next concern: continue PF-0001/);
  assert.match(brief, /Next: yallaflow resume PF-0001/);
  cli(root, ['resume', 'PF-0001']);
  cli(root, ['guide', 'PF-0001']);
  assert.match(cli(root, ['status']).stdout, /Work items: 1/);
  assert.deepEqual(await readdir(path.join(root, '.yallaflow', 'work')), ['PF-0001']);
  // An unrelated request is routed separately; the covering item stays intact.
  cli(root, ['bug', 'Login page throws on empty password', '--scope', 'bounded']);
  assert.deepEqual((await readdir(path.join(root, '.yallaflow', 'work'))).sort(), ['PF-0001', 'PF-0002']);
  assert.match(cli(root, ['guide', 'PF-0001']).stdout, /Stage: INTAKE/);
});

test('operational requests create no work item and change no YallaFlow state', async () => {
  for (const root of [await greenfield(), await brownfield()]) {
    const before = await snapshot(path.join(root, '.yallaflow'));
    // What an agent runs for "show git status", "start the dev server"-style help and orientation.
    git(root, ['status', '--short']);
    for (const args of [['brief'], ['status'], ['inspect'], ['doctor'], ['agent', 'status'], ['upgrade', 'status'], ['context', 'status']]) {
      cli(root, args, false);
    }
    assert.deepEqual(await snapshot(path.join(root, '.yallaflow')), before, 'operational and read-only commands write nothing');
    assert.match(cli(root, ['status']).stdout, /Work items: [01]\b/);
  }
});

test('Brownfield gate and Greenfield freedom are unchanged for the Sekaya request', async () => {
  const unapproved = await brownfield({ approved: false });
  const refused = cli(unapproved, ['change', SEKAYA, '--scope', 'bounded'], false);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /^PROJECT_UNDERSTANDING_REQUIRED/);
  assert.match(cli(unapproved, ['status']).stdout, /Work items: 0/);

  const green = await greenfield();
  assert.match(cli(green, ['change', SEKAYA, '--scope', 'bounded']).stdout, /Workflow: change/);
});

test('CLI path for recovery: an edit made before routing is kept, disclosed in a ruling, verified fresh, and dated when recorded', async () => {
  const root = await greenfield();
  await mkdir(path.join(root, 'src'));
  const file = path.join(root, 'src', 'ProjectsTable.jsx');
  await writeFile(file, 'export const actions = ["edit", "delete"];\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'table']);
  const head = git(root, ['rev-parse', 'HEAD']).stdout;
  // The untracked edit: made with no work item.
  const edited = 'export const actions = [{ group: "three-dots", items: ["edit", "delete"] }];\n';
  await writeFile(file, edited);
  const editedAt = (await stat(file)).mtimeMs;

  cli(root, ['change', SEKAYA, '--scope', 'bounded']);
  cli(root, ['checkpoint', 'PF-0001', '--ruling', 'src/ProjectsTable.jsx was edited before this work item existed, without workflow authorization; adopted for review and verification',
    '--ruling-reason', 'recovering an untracked edit', '--cost-if-wrong', 'an unreviewed UI change ships']);
  routeToImplementation(root, 'PF-0001');
  const finish = verifyAndFinish(root, 'PF-0001');
  assert.equal(finish.status, 0);

  assert.equal(await readFile(file, 'utf8'), edited, 'the pre-existing change is kept byte-for-byte');
  assert.equal(git(root, ['rev-parse', 'HEAD']).stdout, head, 'Git history untouched');
  assert.equal(git(root, ['stash', 'list']).stdout, '', 'nothing stashed');
  const progress = JSON.parse(await readFile(path.join(root, '.yallaflow', 'work', 'PF-0001', 'progress.yaml'), 'utf8'));
  assert.equal(progress.rulings.length, 1);
  assert.match(progress.rulings[0].decision, /edited before this work item existed, without workflow authorization/);
  const meta = JSON.parse(await readFile(path.join(root, '.yallaflow', 'work', 'PF-0001', 'meta.yaml'), 'utf8'));
  for (const at of [meta.createdAt, progress.rulings[0].createdAt]) {
    assert.ok(Date.parse(at) >= Math.floor(editedAt), `${at} is not backdated before the edit`);
  }
  // No ruling or work option accepts a caller-supplied timestamp.
  const backdate = cli(root, ['checkpoint', 'PF-0001', '--ruling', 'x', '--ruling-reason', 'y', '--cost-if-wrong', 'z', '--created-at', '2020-01-01T00:00:00Z'], false);
  assert.notEqual(backdate.status, 0);
});

// ---------------------------------------------------------------------------
// Legacy (v1.0.0) workspace compatibility

async function v100Workspace() {
  const root = await greenfield();
  await copyFile(path.join(V100, 'AGENT.md'), path.join(root, '.yallaflow', 'AGENT.md'));
  await writeFile(path.join(root, 'CLAUDE.md'), `# Team rules\n\nUse pnpm.\n\n${await readFile(path.join(V100, 'CLAUDE.md'), 'utf8')}`);
  await copyFile(path.join(V100, 'AGENTS.md'), path.join(root, 'AGENTS.md'));
  return root;
}

test('a v1.0.0 workspace (contract v8, bootstrap v2) reads as outdated, keeps working, and upgrades only on explicit refresh', async () => {
  const root = await v100Workspace();
  assert.deepEqual(await inspectAgentContract(root), { state: 'outdated', installed: AGENT_CONTRACT_VERSION, version: 8 });
  for (const provider of Object.values(BOOTSTRAP_PROVIDERS)) assert.equal((await inspectBootstrap(root, provider)).state, 'outdated');

  const before = await snapshot(path.join(root, '.yallaflow'));
  const claudeBefore = await readFile(path.join(root, 'CLAUDE.md'), 'utf8');
  const brief = cli(root, ['brief']).stdout;
  assert.match(brief, /Primary next concern: agent contract is not current/);
  assert.match(brief, /Next: yallaflow agent refresh/);
  assert.match(cli(root, ['agent', 'status']).stdout, new RegExp(`outdated \\(v8 → v${AGENT_CONTRACT_VERSION}\\)`));
  assert.deepEqual(await snapshot(path.join(root, '.yallaflow')), before, 'never rewritten on read');
  assert.equal(await readFile(path.join(root, 'CLAUDE.md'), 'utf8'), claudeBefore);

  // Existing work is not blocked by an outdated contract, and keeps its pinned behavior.
  cli(root, ['change', SEKAYA, '--scope', 'bounded']);
  const workBefore = await snapshot(path.join(root, '.yallaflow', 'work'));

  assert.match(cli(root, ['agent', 'refresh']).stdout, /Did update only the YallaFlow-managed block[\s\S]*AGENTS\.md: updated only the YallaFlow bootstrap block \(v2 → v3\)[\s\S]*CLAUDE\.md: updated only the YallaFlow bootstrap block \(v2 → v3\)/);
  assert.equal(await readFile(path.join(root, '.yallaflow', 'AGENT.md'), 'utf8'), renderAgentContractBlock());
  assert.equal(await readFile(path.join(root, 'CLAUDE.md'), 'utf8'), `# Team rules\n\nUse pnpm.\n\n${renderBootstrapBlock(BOOTSTRAP_PROVIDERS.claude)}`);
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), renderBootstrapBlock(BOOTSTRAP_PROVIDERS.codex));
  assert.deepEqual(await snapshot(path.join(root, '.yallaflow', 'work')), workBefore, 'historical work is never rewritten by a refresh');
  assert.match(cli(root, ['agent', 'refresh']).stdout, new RegExp(`already at agent contract v${AGENT_CONTRACT_VERSION}; nothing changed`));
});

test('a v1.0.0 CLI on a refreshed workspace reports the newer contract and refuses to downgrade it', async (t) => {
  const v100 = await frozenCli('v1.0.0');
  if (!v100) {
    if (process.env.CI) assert.fail('the v1.0.0 tag is required in CI (fetch tags)');
    return t.skip('v1.0.0 tag not available in this checkout');
  }
  const root = await greenfield();
  const agentMd = await readFile(path.join(root, '.yallaflow', 'AGENT.md'), 'utf8');
  const status = v100(root, ['agent', 'status']);
  assert.equal(status.status, 0);
  assert.match(status.stdout, new RegExp(`newer YallaFlow \\(v${AGENT_CONTRACT_VERSION} > installed v8\\)`));
  assert.notEqual(v100(root, ['agent', 'refresh']).status, 0);
  assert.equal(await readFile(path.join(root, '.yallaflow', 'AGENT.md'), 'utf8'), agentMd);
  // Work still runs on the older CLI: no schema changed.
  assert.equal(v100(root, ['change', SEKAYA, '--scope', 'bounded']).status, 0);
  assert.equal(cli(root, ['guide', 'PF-0001']).status, 0);
});
