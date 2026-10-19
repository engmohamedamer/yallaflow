// v0.3.10-internal.4 pilot hardening — regressions from a real Brownfield pilot:
//   A  pre-baseline engineering gate (PROJECT_UNDERSTANDING_REQUIRED; nothing created)
//   B  the original request survives the baseline and continues after approval
//   C  secret values never reach YallaFlow-owned durable state
//   D  PROJECT.md is a real projection once project memory exists
//   E  baseline coverage is transparent (inspected / sampled / not inspected / ...)
//   F  repository evidence records working-tree provenance where Git is available
// plus compatibility with the real frozen v0.3.10-internal.3 CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { exists } from '../src/utils/fs.js';
import { loadContextLedger } from '../src/context/ledger.js';
import { containsSecret, redactSecrets, REDACTED, shellQuote } from '../src/security/redact.js';
import { executeDecomposition, proposeDecomposition } from '../src/decomposition/store.js';
import { hasStarterPlaceholders, PROJECT_STARTER_PLACEHOLDERS } from '../src/context/projection.js';
import { AGENT_CONTRACT_VERSION, agentContractBody } from '../src/agent/contract.js';
import { REGISTRY_VERSION } from '../src/skills/constants.js';
import { loadSkillInstructions, pinnedInstructionVersion, SKILL_INSTRUCTION_VERSIONS } from '../src/skills/instructions.js';
import { PACKAGE_VERSION } from '../src/version.js';
import { approveTeamBaseline, cli, frozenCli, git, writeTeamApp } from '../test-support/shared.js';

const repo = fileURLToPath(new URL('../', import.meta.url));
const REQUEST = 'How does subscription renewal work?';
// Synthetic secrets only.
const DB_SECRET = 'synthetic-db-secret-4711';
const API_SECRET = 'sk-test-synthetic0000000000000000000000';
const BEARER = 'synthetictoken1234567890abcdef';

async function tmp(prefix = 'yallaflow-pilot-') {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

// A meaningful Brownfield repository: an invoicing app plus a subscription module and
// a developer .env holding (synthetic) credentials.
async function pilotRepo() {
  const root = await tmp();
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'Dev']);
  git(root, ['config', 'user.email', 'dev@example.com']);
  await writeTeamApp(root);
  await mkdir(path.join(root, 'backend', 'subscriptions'), { recursive: true });
  await writeFile(path.join(root, 'backend', 'subscriptions', 'renewal.js'), 'export function renew(sub) { return { ...sub, periodEnd: sub.periodEnd + 30 }; }\n');
  await writeFile(path.join(root, 'backend', 'subscriptions', 'scheduler.js'), 'export const RENEWAL_CRON = "0 3 * * *";\n');
  await writeFile(path.join(root, '.gitignore'), '.env\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'app']);
  await writeFile(path.join(root, '.env'), `DB_PASSWORD=${DB_SECRET}\nSTRIPE_API_KEY=${API_SECRET}\n`);
  return root;
}

async function treeText(dir) {
  let text = '';
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    text += entry.isDirectory() ? await treeText(full) : `\n${full}\n${await readFile(full, 'utf8')}`;
  }
  return text;
}

const sha = (text) => createHash('sha256').update(text).digest('hex');

// ---------------------------------------------------------------------------
// C — the sanitizer

test('C: the sanitizer redacts secret values conservatively and idempotently, and leaves ordinary evidence alone', () => {
  const redacted = [
    ['DB_PASSWORD=real-secret', 'DB_PASSWORD=<redacted>'],
    // A non-secret key before it must not swallow the assignment (multi-line text, prose).
    ['Steps:\nDB_PASSWORD=real-secret\nthen log in.', 'Steps:\nDB_PASSWORD=<redacted>\nthen log in.'],
    ['note: DB_PASSWORD=real-secret', 'note: DB_PASSWORD=<redacted>'],
    ['Read .env (DB_PASSWORD=real-secret) first', 'Read .env (DB_PASSWORD=<redacted>) first'],
    ['export API_KEY="abc123xyz"', 'export API_KEY="<redacted>"'],
    ['POSTGRES_PASSWORD: example', 'POSTGRES_PASSWORD: <redacted>'],
    ['password: hunter2', 'password: <redacted>'],
    ['dbPassword = "s3cr3t"', 'dbPassword = "<redacted>"'],
    ['"client_secret": "zzz"', '"client_secret": "<redacted>"'],
    ['--access-token=abcdef123456', '--access-token=<redacted>'],
    ['Authorization: Bearer abcdefghijklmnop1234', 'Authorization: Bearer <redacted>'],
    ['curl -H "Authorization: Basic dXNlcjpwYXNz" https', 'curl -H "Authorization: Basic <redacted>" https'],
    ['sent bearer abcdefghij1234567890 to the API', 'sent bearer <redacted> to the API'],
    ['Cookie: sid=abc123; theme=dark', 'Cookie: <redacted>'],
    ['DATABASE_URL=postgres://app:p4ss@db:5432/app', 'DATABASE_URL=postgres://app:<redacted>@db:5432/app'],
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked', 'token <redacted> leaked'],
    ['AKIAABCDEFGHIJKLMNOP', REDACTED],
    ['key sk-ant-api03-abcdefghijklmnopqrstuvwx', `key ${REDACTED}`],
    // Review findings: PHP/Laravel arrows, := , empty-user URLs, well-known names, flags.
    ["'password' => 'hunter2'", "'password' => '<redacted>'"],
    ['password := "abc"', 'password := "<redacted>"'],
    ['redis://:pw123@cache:6379', 'redis://:<redacted>@cache:6379'],
    ['APP_KEY=base64:abcdEFGH1234', 'APP_KEY=<redacted>'],
    ['SECRET_KEY_BASE=abc123def', 'SECRET_KEY_BASE=<redacted>'],
    ['PGPASSWORD=x9y', 'PGPASSWORD=<redacted>'],
    ['mysql --password hunter2 db', 'mysql --password <redacted> db'],
    ['credentials=AKx9s8d7f6g5h4j3k2', 'credentials=<redacted>'],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----', `-----BEGIN RSA PRIVATE KEY-----${REDACTED}-----END RSA PRIVATE KEY-----`]
  ];
  for (const [input, expected] of redacted) {
    assert.equal(redactSecrets(input), expected, input);
    assert.equal(redactSecrets(expected), expected, `idempotent: ${expected}`);
    assert.equal(containsSecret(input), true, input);
  }
  const ordinary = [
    '.env', 'config/database.yml#production', 'The .env file holds DB_PASSWORD', 'TOKEN_TTL=3600', 'PASSWORD_MIN_LENGTH=8',
    'password: string', 'apiKey: ApiKey;', 'token?: string', 'DB_PASSWORD=${DB_PASSWORD}', 'password = getenv("X")',
    'Authorization: role-based policies in src/auth.js', 'uses bearer authentication', 'see src/auth/password.js and token handling',
    'https://example.com/a:b@c', 'sha256:' + 'a'.repeat(64), 'verification:V-001', 'Stage: IMPLEMENTATION → VERIFICATION',
    'Refunds are allowed within 30 days.', 'secret_key_base is read from config/credentials.yml.enc',
    // Review findings: ordinary words in secret positions, and code references.
    'Unit tests pass: 3 of 5 fail', 'tests pass: 12/12', 'credentials: include', 'cookie: yes',
    "'password' => env('DB_PASSWORD', '')", 'password = os.environ["X"]', 'Cookie: Authorization: Authorization: abc123def456'
  ];
  for (const input of ordinary) assert.equal(redactSecrets(input), input, input);

  // Linear time on long unbroken input (extracted documents, verification logs).
  const started = Date.now();
  redactSecrets('a.'.repeat(100000));
  redactSecrets('x-'.repeat(100000));
  redactSecrets(Array.from({ length: 400000 }, (_, i) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456789-_'[(i * 7919) % 48]).join(''));
  assert.ok(Date.now() - started < 3000, `redaction stays fast on long tokens (${Date.now() - started} ms)`);
});

test('A/B: suggested commands are shell-safe — the developer\'s text is one single-quoted argument', async () => {
  const root = await pilotRepo();
  cli(root, ['init']);
  const request = 'Why does `renewSubscription()` fail for $PLAN user\'s plans?';
  const refused = cli(root, ['start', request], false).stderr;
  assert.ok(refused.includes(`NEXT VALID ACTION: yallaflow baseline start --objective ${shellQuote(request)}`));
  assert.equal(shellQuote(request), "'Why does `renewSubscription()` fail for $PLAN user'\\''s plans?'");
});

test('A: decomposition cannot create child work before Brownfield understanding is approved', async () => {
  const root = await pilotRepo();
  cli(root, ['init']);
  await assert.rejects(proposeDecomposition(root, 'PF-0001', { children: [] }), /PROJECT_UNDERSTANDING_REQUIRED/);
  await assert.rejects(executeDecomposition(root, 'PF-0001'), /PROJECT_UNDERSTANDING_REQUIRED/);
});

test('C: a lifecycle record written before redaction stays consistent after an internal.4 rewrite of meta.yaml', async (t) => {
  const frozen = await frozenCli('v0.3.10-internal.3');
  if (!frozen) return t.diagnostic('frozen v0.3.10-internal.3 tag unavailable; skipped');
  const root = await tmp();
  git(root, ['init', '-q']);
  assert.equal(frozen(root, ['init', '--type', 'greenfield']).status, 0);
  assert.equal(frozen(root, ['start', 'Login fails']).status, 0);
  assert.equal(frozen(root, ['route', 'PF-0001', '--type', 'bug', '--scope', 'bounded', '--confidence', 'high', '--reason', `Repro sets DB_PASSWORD=${DB_SECRET}; unit tests pass: 3 of 5`]).status, 0);
  cli(root, ['advance', 'PF-0001']);
  const meta = JSON.parse(await readFile(path.join(workspacePath(root), 'work', 'PF-0001', 'meta.yaml'), 'utf8'));
  assert.equal(meta.routingReason, 'Repro sets DB_PASSWORD=<redacted>; unit tests pass: 3 of 5', 'the rewrite redacts the secret and keeps ordinary text');
  const doctor = cli(root, ['doctor']).stdout;
  assert.doesNotMatch(doctor, /Routing Decision no longer matches/);
  assert.match(doctor, /Workspace healthy\./);
});

// ---------------------------------------------------------------------------
// The end-to-end pilot (A + B + C + D + E + F), CLI only

test('pilot: init → refused request → baseline with the request as objective → still refused while awaiting approval → approve → the original request continues on approved memory → another task', async () => {
  const root = await pilotRepo();
  cli(root, ['init']);
  const envBefore = await readFile(path.join(root, '.env'), 'utf8');

  // 3. Project understanding is not approved.
  const brief = cli(root, ['brief']).stdout;
  assert.match(brief, /^Project understanding: PROJECT_UNDERSTANDING_REQUIRED/m);

  // 4. The first project-semantic request is refused; nothing is created.
  const refused = cli(root, ['start', REQUEST], false);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /^PROJECT_UNDERSTANDING_REQUIRED: this existing project has no approved project understanding yet, so normal engineering work cannot start\. No work item was created\./);
  assert.match(refused.stderr, new RegExp(`Original request \\(keep it: it is the baseline's discovery objective and continues after approval\\): ${REQUEST.replace('?', '\\?')}`));
  assert.match(refused.stderr, new RegExp(`NEXT VALID ACTION: yallaflow baseline start --objective '${REQUEST.replace('?', '\\?')}'`));
  assert.deepEqual(await readdir(path.join(workspacePath(root), 'work')), []);
  for (const args of [['investigate', 'Subscription renewal', '--scope', 'bounded'], ['feature', 'Renewal reminders', '--scope', 'bounded'], ['change', 'Renewal period', '--scope', 'bounded'], ['refactor', 'Renewal', '--scope', 'bounded'], ['release', 'v2', '--scope', 'bounded'], ['bug', 'Renewal', '--scope', 'spike']]) {
    assert.match(cli(root, args, false).stderr, /^PROJECT_UNDERSTANDING_REQUIRED/, args.join(' '));
  }
  assert.deepEqual(await readdir(path.join(workspacePath(root), 'work')), []);

  // Read-only orientation stays available before the baseline (transient operational
  // help never creates work at all).
  for (const args of [['brief'], ['inspect'], ['status'], ['doctor'], ['agent', 'status'], ['context', 'status'], ['upgrade', 'status'], ['skill', 'repository-baseline'], ['--version']]) cli(root, args);

  // 5. The baseline uses the original request as its discovery objective.
  const started = cli(root, ['baseline', 'start', '--objective', REQUEST, '--focus', 'subscription renewal']).stdout;
  assert.match(started, /PF-0001 — Repository Baseline started/);
  assert.match(started, /Discovery lens: bootstrap discovery for: How does subscription renewal work\?/);
  await writeFile(path.join(root, 'renewal-notes.md'), '# Renewal\nRenewals run nightly.\n');
  cli(root, ['intake', 'add', 'PF-0001', 'renewal-notes.md']);
  // The Agent slips: a credential copied into a checkpoint summary.
  cli(root, ['checkpoint', 'PF-0001', '--skill', 'repository-baseline', '--complete', '--summary', `Read .env (DB_PASSWORD=${DB_SECRET}) and backend/subscriptions.`]);

  // 6. Draft — with the pilot's mistake: secret values in facts, evidence, notes, limitations.
  const draft = {
    facts: [
      { area: 'project', status: 'confirmed', summary: 'Invoicing and subscription billing system.', evidence: ['package.json', 'backend/subscriptions/renewal.js'], source: 'repository' },
      { area: 'business-rule', status: 'confirmed', summary: 'A renewal extends the subscription period by 30 days.', evidence: ['backend/subscriptions/renewal.js#renew'], source: 'repository' },
      { area: 'environment', status: 'confirmed', summary: `Database credentials come from .env (DB_PASSWORD=${DB_SECRET}).`, evidence: ['.env', `DB_PASSWORD=${DB_SECRET}`], source: 'repository', note: `Stripe key STRIPE_API_KEY=${API_SECRET}` },
      { area: 'integration', status: 'inferred', summary: `Payment calls send Authorization: Bearer ${BEARER}.`, evidence: ['backend/subscriptions/scheduler.js'], source: 'repository' },
      { area: 'architecture', status: 'unresolved', summary: 'Whether renewals retry after a failed payment cannot be established.', evidence: ['backend/subscriptions/renewal.js'], source: 'repository' }
    ],
    limitations: [
      { type: 'not-inspected', area: 'testing', summary: 'Tests were not inspected.', reason: 'Out of time.' },
      { type: 'runtime-unavailable', area: 'database', summary: `Production DB (postgres://app:${DB_SECRET}@prod/app) was not reachable.`, reason: 'No production access.' }
    ],
    coverage: { inspected: ['backend/subscriptions/', 'package.json'], sampled: ['backend/invoices/ (totals.js only)'] }
  };
  await writeFile(path.join(root, 'baseline.json'), JSON.stringify(draft));
  const drafted = cli(root, ['baseline', 'draft', 'PF-0001', '--file', 'baseline.json']).stdout;
  assert.match(drafted, /Discovery coverage \(what this baseline actually covered — not a completeness claim\):/);

  // E: the review distinguishes inspected / sampled / not inspected / unavailable / unresolved.
  const show = cli(root, ['baseline', 'show', 'PF-0001']).stdout;
  assert.match(show, /Inspected \(2\):\n {4}- backend\/subscriptions\/\n {4}- package\.json/);
  assert.match(show, /Sampled \(selectively inspected\) \(1\):\n {4}- backend\/invoices\/ \(totals\.js only\)/);
  assert.match(show, /Not inspected \(1\):\n {4}- Tests were not inspected\. \[not-inspected\]/);
  assert.match(show, /Unavailable \(1\):\n {4}- Production DB \(postgres:\/\/app:<redacted>@prod\/app\) was not reachable\. \[runtime-unavailable\]/);
  assert.match(show, /Unresolved facts \(1\):\n {4}- BF-005 /);
  assert.match(show, /Evidence cites \d+ distinct repository path\(s\); the inventory recognizes \d+ source file\(s\) and \d+ documentation candidate\(s\)\. A fact count is not a count of files read\./);

  // 7. Engineering work still cannot start while human approval is pending.
  const pending = cli(root, ['start', REQUEST], false);
  assert.match(pending.stderr, /PROJECT_UNDERSTANDING_REQUIRED[\s\S]*PROJECT_UNDERSTANDING_AWAITING_REVIEW[\s\S]*NEXT VALID ACTION: yallaflow baseline show PF-0001/);
  assert.deepEqual(await readdir(path.join(workspacePath(root), 'work')), ['PF-0001']);

  // 8. Explicit approval.
  const approved = cli(root, ['baseline', 'approve', 'PF-0001', '--note', 'Approved by the developer in the agent session: "Approve"']).stdout;
  assert.match(approved, /Continue the original request now — do not ask the developer to repeat it, and do not run another repository-wide discovery/);
  assert.match(approved, new RegExp(`Next: yallaflow start '${REQUEST.replace('?', '\\?')}'`));
  const afterApproval = cli(root, ['brief']).stdout;
  assert.match(afterApproval, /Primary next concern: project understanding approved — continue the original request that started the Brownfield baseline \(PF-0001\) without asking the developer to repeat it: How does subscription renewal work\?/);
  assert.match(afterApproval, new RegExp(`Next: yallaflow start '${REQUEST.replace('?', '\\?')}'`));

  // D: PROJECT.md is a real projection — no starter placeholders, known facts rendered.
  const project = await readFile(path.join(workspacePath(root), 'PROJECT.md'), 'utf8');
  assert.equal(hasStarterPlaceholders(project), false);
  for (const [, prompt] of PROJECT_STARTER_PLACEHOLDERS) assert.ok(!project.includes(prompt), prompt);
  assert.match(project, /^# .+\n\n## Project Kind\n\nbrownfield\n\n<!-- yallaflow-context:begin -->/);
  assert.match(project, /Invoicing and subscription billing system\./);

  // 9. The original request continues on approved memory — no second bootstrap.
  assert.match(cli(root, ['start', REQUEST]).stdout, /Created PF-0002/);
  cli(root, ['route', 'PF-0002', '--type', 'investigation', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Read-only question about renewal behavior.', '--title', 'Subscription renewal']);
  assert.match(cli(root, ['skill', 'context-discovery', '--work', 'PF-0002']).stdout, /Never repeat a repository-wide scan when approved, fresh project memory exists/);
  assert.match(cli(root, ['baseline', 'start'], false).stderr, /An approved Brownfield Baseline already exists/);
  assert.doesNotMatch(cli(root, ['brief']).stdout, /continue the original request/);
  const { ledger } = await loadContextLedger(root);
  assert.equal(ledger.facts.length, 5, 'project memory is the approved baseline, reused as-is');

  // Another task: existing memory used; only targeted freshness/intent discovery.
  await writeFile(path.join(root, 'backend', 'subscriptions', 'renewal.js'), 'export function renew(sub) { return { ...sub, periodEnd: sub.periodEnd + 31 }; }\n');
  const status = cli(root, ['context', 'status']).stdout;
  assert.match(status, /MAY_BE_STALE/);
  assert.match(cli(root, ['start', 'Add a renewal reminder email']).stdout, /Created PF-0003/);
  cli(root, ['route', 'PF-0003', '--type', 'feature', '--scope', 'bounded', '--confidence', 'high', '--reason', 'New reminder capability.']);
  assert.match(cli(root, ['context', 'affected', '--paths', 'backend/subscriptions/renewal.js'], false).stdout + cli(root, ['brief']).stdout, /CTX-0002/);
  assert.equal((await readdir(path.join(workspacePath(root), 'work'))).filter((id) => id !== 'PF-0001').length, 2, 'no second baseline work item');

  // C: no secret value anywhere in YallaFlow-owned durable state; the developer's file
  // and the paths that cite it are intact.
  const state = await treeText(workspacePath(root));
  for (const secret of [DB_SECRET, API_SECRET, BEARER]) assert.ok(!state.includes(secret), `${secret} must not be persisted`);
  assert.match(state, /DB_PASSWORD=<redacted>/);
  assert.match(state, /STRIPE_API_KEY=<redacted>/);
  assert.match(state, /Authorization: Bearer <redacted>/);
  assert.equal(await readFile(path.join(root, '.env'), 'utf8'), envBefore, 'the developer file is never modified');
  const environmentFact = ledger.facts.find((fact) => fact.area === 'environment');
  assert.ok(environmentFact.evidence.some((entry) => entry.type === 'repository' && entry.path === '.env'), '.env stays valid evidence');

  // F: working-tree provenance on repository evidence (content hash still authoritative).
  const byPath = new Map(ledger.facts.flatMap((fact) => fact.evidence).filter((entry) => entry.type === 'repository').map((entry) => [entry.path, entry]));
  assert.equal(byPath.get('package.json').workingTree, 'head');
  assert.equal(byPath.get('.env').workingTree, 'untracked');
  assert.match(byPath.get('.env').contentHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(cli(root, ['context', 'show', 'CTX-0003']).stdout, /\.env \(repository @ [0-9a-f]{7}\) \[untracked file\]/);

  const doctor = cli(root, ['doctor']).stdout;
  assert.match(doctor, /Workspace healthy\./);
  assert.doesNotMatch(doctor, /starter placeholders/);
});

test('A: transient operational assistance and read-only orientation never need a baseline; Greenfield and approved Brownfield create work as before', async () => {
  const root = await pilotRepo();
  cli(root, ['init']);
  const before = await treeText(workspacePath(root));
  for (const args of [['brief'], ['inspect'], ['status'], ['doctor'], ['agent', 'status'], ['context', 'status'], ['context', 'list'], ['upgrade', 'plan'], ['start'], ['--help']]) cli(root, args);
  assert.equal(await treeText(workspacePath(root)), before, 'orientation writes nothing');
  assert.match(agentContractBody(), /Transient operational assistance — start Docker or a dev server, open the application, show logs, check git status, inspect local processes or ports — is handled directly, without a YallaFlow work item and without waiting for project understanding/);

  const green = await tmp('yallaflow-pilot-green-');
  git(green, ['init', '-q']);
  cli(green, ['init']);
  assert.match(cli(green, ['brief']).stdout, /Project understanding: Greenfield/);
  assert.match(cli(green, ['start', 'Build a booking app']).stdout, /Created PF-0001/);
  assert.match(cli(green, ['feature', 'Booking', '--scope', 'bounded']).stdout, /Created PF-0002/);
  assert.equal(hasStarterPlaceholders(await readFile(path.join(workspacePath(green), 'PROJECT.md'), 'utf8')), true, 'no project memory yet: the template stays');

  const approved = await pilotRepo();
  cli(approved, ['init']);
  await approveTeamBaseline(approved);
  const start = cli(approved, ['start', 'Fix invoice totals']).stdout;
  assert.match(start, /Created PF-0002/);
  assert.doesNotMatch(start, /PROJECT_UNDERSTANDING/);
  assert.match(cli(approved, ['bug', 'Totals', '--scope', 'bounded']).stdout, /Created PF-0003/);
});

test('C: every YallaFlow-owned text path persists redacted values; source originals stay byte-for-byte; work records stay doctor-clean', async () => {
  const root = await tmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Dev']);
  git(root, ['config', 'user.email', 'dev@example.com']);
  await initWorkspace(root, 'demo', 'greenfield');
  const secret = `DB_PASSWORD=${DB_SECRET}`;
  cli(root, ['start', `Fix login; repro uses ${secret}`]);
  cli(root, ['route', 'PF-0001', '--type', 'bug', '--scope', 'bounded', '--confidence', 'high', '--reason', `Fails with Authorization: Bearer ${BEARER}`, '--title', 'Login fails']);
  cli(root, ['purpose', 'set', 'PF-0001', '--objective', `Understand login with ${secret}`]);
  cli(root, ['checkpoint', 'PF-0001', '--ruling', `Use ${secret} only locally`, '--ruling-reason', 'repro', '--cost-if-wrong', 'low']);
  cli(root, ['limitation', 'add', 'PF-0001', '--type', 'unavailable', '--area', 'database', '--summary', `Prod DB postgres://u:${DB_SECRET}@h/db unreachable`, '--reason', 'no access']);
  cli(root, ['question', 'add', 'PF-0001', '--category', 'business', '--text', `Is STRIPE_API_KEY=${API_SECRET} the live key?`]);
  await writeFile(path.join(root, 'request.txt'), `Steps:\n${secret}\nthen log in.\n`);
  const original = await readFile(path.join(root, 'request.txt'));
  assert.match(cli(root, ['intake', 'add', 'PF-0001', 'request.txt']).stdout, /Warning: SRC-0001 \(request\.txt\) appears to contain secret values[\s\S]*preserved original under \.yallaflow\/sources\/SRC-0001\/ keeps them byte-for-byte/);
  cli(root, ['verify', 'PF-0001', '--', process.execPath, '-e', `console.log(${JSON.stringify(`connecting with ${secret}`)})`, `STRIPE_API_KEY=${API_SECRET}`]);

  // Everything YallaFlow wrote — except the preserved original, which by contract stays
  // exactly as the developer supplied it.
  const state = (await treeText(workspacePath(root))).split(/\n(?=\/)/).filter((chunk) => !chunk.includes('/sources/SRC-0001/request.txt\n')).join('\n');
  for (const value of [DB_SECRET, API_SECRET, BEARER]) assert.ok(!state.includes(value), `${value} must not be persisted`);
  const source = path.join(workspacePath(root), 'sources', 'SRC-0001');
  assert.deepEqual(await readFile(path.join(source, 'request.txt')), original, 'the preserved original is byte-for-byte');
  assert.match(JSON.parse(await readFile(path.join(source, 'source.json'), 'utf8')).rawText, /DB_PASSWORD=<redacted>/);
  assert.match(await readFile(path.join(workspacePath(root), 'work', 'PF-0001', 'evidence', 'V-001-verification.log'), 'utf8'), /connecting with DB_PASSWORD=<redacted>/);
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);
  assert.doesNotMatch(cli(root, ['doctor']).stdout, /lifecycle record .*edited|hand-edit/i);
});

test('D: an internal.3-style approved workspace keeps human text; doctor warns about leftover placeholders and render retires only the untouched ones', async () => {
  const root = await pilotRepo();
  cli(root, ['init']);
  await approveTeamBaseline(root);
  const file = path.join(workspacePath(root), 'PROJECT.md');
  // Recreate what internal.3 left behind (placeholders kept next to the managed block),
  // with one section a human already wrote.
  const current = await readFile(file, 'utf8');
  const legacy = current.replace('## Project Kind\n\nbrownfield\n\n', '## Project Kind\n\nbrownfield\n\n## Purpose\n\n> Describe what the system does and who it serves.\n\n## Success Criteria\n\nInvoices are always correct.\n\n## Core Modules\n\n> Populated progressively by bootstrap and completed work.\n\n');
  await writeFile(file, legacy);
  assert.match(cli(root, ['doctor']).stdout, /WARN .*PROJECT\.md still shows init starter placeholders although project memory holds current facts\. Run `yallaflow context render`/);
  cli(root, ['context', 'render']);
  const rendered = await readFile(file, 'utf8');
  assert.equal(hasStarterPlaceholders(rendered), false);
  assert.match(rendered, /## Success Criteria\n\nInvoices are always correct\./, 'human-written content stays');
  assert.match(rendered, /<!-- yallaflow-context:begin -->/);
  assert.doesNotMatch(cli(root, ['doctor']).stdout, /starter placeholders|FAIL/);
});

test('E: coverage is optional, validated, and a draft without it says so', async () => {
  const root = await pilotRepo();
  cli(root, ['init']);
  cli(root, ['baseline', 'start']);
  cli(root, ['checkpoint', 'PF-0001', '--skill', 'repository-baseline', '--complete', '--summary', 'Discovery complete.']);
  const fact = { area: 'project', status: 'confirmed', summary: 'Invoicing.', evidence: ['package.json'], source: 'repository' };
  for (const [coverage, message] of [[['x'], /coverage must be an object/], [{ read: ['x'] }, /coverage has unknown field\(s\): read/], [{ inspected: [''] }, /coverage\.inspected must be a list/], [{}, /coverage must declare at least one of: inspected, sampled/]]) {
    await writeFile(path.join(root, 'b.json'), JSON.stringify({ facts: [fact], coverage }));
    assert.match(cli(root, ['baseline', 'draft', 'PF-0001', '--file', 'b.json'], false).stderr, message);
  }
  await writeFile(path.join(root, 'b.json'), JSON.stringify({ facts: [fact] }));
  const out = cli(root, ['baseline', 'draft', 'PF-0001', '--file', 'b.json']).stdout;
  assert.match(out, /Inspected \/ sampled: not declared by this draft — only the evidence citations and limitations below describe what was read\./);
  assert.match(cli(root, ['baseline', 'status']).stdout, /Evidence cites 1 distinct repository path\(s\)/);
});

test('F: provenance distinguishes HEAD, modified, and untracked content; outside Git nothing is recorded and hashes still decide freshness', async () => {
  const root = await pilotRepo();
  cli(root, ['init']);
  await writeFile(path.join(root, 'backend', 'invoices', 'tax.js'), 'export const TAX_RATE = 0.16;\n');
  await writeFile(path.join(root, 'notes.txt'), 'untracked\n');
  cli(root, ['baseline', 'start']);
  cli(root, ['checkpoint', 'PF-0001', '--skill', 'repository-baseline', '--complete', '--summary', 'Discovery complete.']);
  await writeFile(path.join(root, 'b.json'), JSON.stringify({ facts: [{ area: 'architecture', status: 'confirmed', summary: 'Invoices and tax.', evidence: ['backend/invoices/totals.js', 'backend/invoices/tax.js', 'notes.txt'], source: 'repository' }] }));
  cli(root, ['baseline', 'draft', 'PF-0001', '--file', 'b.json']);
  assert.match(cli(root, ['baseline', 'show']).stdout, /Evidence: backend\/invoices\/totals\.js, backend\/invoices\/tax\.js \[uncommitted working-tree changes\], notes\.txt \[untracked file\]/);
  cli(root, ['baseline', 'approve', 'PF-0001']);
  const evidence = (await loadContextLedger(root)).ledger.facts[0].evidence;
  assert.deepEqual(evidence.map((entry) => entry.workingTree), ['head', 'modified', 'untracked']);
  // Projection output is unchanged by provenance (no drift for older readers).
  assert.doesNotMatch(await readFile(path.join(workspacePath(root), 'context', 'architecture.md'), 'utf8'), /working-tree|untracked/);

  const plain = await tmp('yallaflow-pilot-nogit-');
  await writeFile(path.join(plain, 'app.js'), '1;\n');
  await initWorkspace(plain, 'plain', 'greenfield');
  cli(plain, ['investigate', 'App', '--scope', 'bounded']);
  for (let i = 0; i < 6; i += 1) cli(plain, ['advance', 'PF-0001']);
  cli(plain, ['knowledge', 'propose', 'PF-0001', '--kind', 'architecture', '--source', 'implementation-runtime', '--summary', 'App entry is app.js.', '--evidence', 'app.js']);
  cli(plain, ['knowledge', 'promote', 'PF-0001', '--candidate', 'K-001']);
  const [entry] = (await loadContextLedger(plain)).ledger.facts[0].evidence;
  assert.equal(entry.workingTree, undefined);
  assert.equal(entry.gitCommit, undefined);
  assert.match(entry.contentHash, /^sha256:/);
  await writeFile(path.join(plain, 'app.js'), '2;\n');
  assert.match(cli(plain, ['context', 'status']).stdout, /MAY_BE_STALE/);
});

// ---------------------------------------------------------------------------
// Versions and compatibility

test('versions: package 1.1.0, Agent Contract v10, Skill Registry v9 with repository-baseline v4; released v3 bytes archived; old pins keep their bytes', async () => {
  assert.equal(PACKAGE_VERSION, '1.1.0');
  assert.equal(JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8')).version, PACKAGE_VERSION);
  assert.equal(AGENT_CONTRACT_VERSION, 10);
  assert.equal(REGISTRY_VERSION, 9);
  assert.equal(pinnedInstructionVersion(9, 'repository-baseline'), 4, 'registry v9 changes no required instruction');
  assert.equal(pinnedInstructionVersion(7, 'repository-baseline'), 3);
  assert.equal(pinnedInstructionVersion(8, 'repository-baseline'), 4);
  assert.equal(pinnedInstructionVersion(6, 'repository-baseline'), 2);
  const v3 = SKILL_INSTRUCTION_VERSIONS['repository-baseline'][3];
  assert.equal(v3.path, 'resources/skills/archive/repository-baseline.v3.md');
  assert.equal(v3.sha256, '67f5c0cfa5b9aeee15bf20c1173477c6471ed9d5ce8d42bd59fa50db9a9a9972', 'the internal.3 hash is unchanged');
  assert.equal(sha(await readFile(path.join(repo, v3.path), 'utf8')), v3.sha256);
  const v4 = await loadSkillInstructions('repository-baseline', 4);
  assert.match(v4.text, /Never copy a secret value into the baseline/);
  assert.match(v4.text, /"coverage": \{ "inspected": \[\.\.\.\], "sampled": \[\.\.\.\] \}/);
  assert.match(v4.text, /refused with PROJECT_UNDERSTANDING_REQUIRED, that request is the objective/);
  const body = agentContractBody();
  assert.match(body, /no normal engineering work item \(feature, bug, investigation, change, refactor, release, or an unclassified yallaflow start intake\) can be created or routed/);
  assert.match(body, /Never copy a secret value into YallaFlow state/);
  assert.match(body, /continue the original request automatically/);
});

test('compatibility: work pinned by internal.3 (registry v7) still receives repository-baseline v3 exactly', async (t) => {
  const frozen = await frozenCli('v0.3.10-internal.3');
  if (!frozen) return t.diagnostic('frozen v0.3.10-internal.3 tag unavailable; skipped');
  const root = await pilotRepo();
  assert.equal(frozen(root, ['init']).status, 0);
  assert.equal(frozen(root, ['baseline', 'start']).status, 0);
  const meta = JSON.parse(await readFile(path.join(workspacePath(root), 'work', 'PF-0001', 'meta.yaml'), 'utf8'));
  assert.equal(meta.behaviorContract.registryVersion, 7);
  const served = cli(root, ['skill', 'repository-baseline', '--work', 'PF-0001']).stdout;
  assert.match(served, /Version: 3\nPinned by: PF-0001 \(Skill Registry v7\)/);
  assert.ok(served.includes((await readFile(path.join(repo, 'resources/skills/archive/repository-baseline.v3.md'), 'utf8')).trim()), 'the exact archived v3 bytes are served');
  assert.doesNotMatch(served, /Never copy a secret value into the baseline/, 'v4 text is not served to v7-pinned work');
  // The internal.4 CLI continues the internal.3 baseline, with coverage, and approves it.
  cli(root, ['checkpoint', 'PF-0001', '--skill', 'repository-baseline', '--complete', '--summary', 'Discovery complete.']);
  await writeFile(path.join(root, 'b.json'), JSON.stringify({ facts: [{ area: 'project', status: 'confirmed', summary: 'Invoicing.', evidence: ['package.json'], source: 'repository' }], coverage: { inspected: ['package.json'] } }));
  cli(root, ['baseline', 'draft', 'PF-0001', '--file', 'b.json']);
  cli(root, ['baseline', 'approve', 'PF-0001']);
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);
});

test('compatibility: the frozen internal.3 CLI reads an internal.4 workspace (coverage, provenance, v8 contract, retired placeholders)', async (t) => {
  const frozen = await frozenCli('v0.3.10-internal.3');
  if (!frozen) return t.diagnostic('frozen v0.3.10-internal.3 tag unavailable; skipped');
  const root = await pilotRepo();
  cli(root, ['init']);
  cli(root, ['baseline', 'start', '--objective', REQUEST]);
  cli(root, ['checkpoint', 'PF-0001', '--skill', 'repository-baseline', '--complete', '--summary', 'Discovery complete.']);
  await writeFile(path.join(root, 'b.json'), JSON.stringify({ facts: [{ area: 'project', status: 'confirmed', summary: 'Invoicing and subscriptions.', evidence: ['package.json', '.env'], source: 'repository' }], coverage: { inspected: ['package.json'], sampled: ['backend/'] } }));
  cli(root, ['baseline', 'draft', 'PF-0001', '--file', 'b.json']);
  // internal.3 can display (and would be able to approve) an internal.4 draft.
  const shown = frozen(root, ['baseline', 'show', 'PF-0001']);
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /Invoicing and subscriptions\./);
  cli(root, ['baseline', 'approve', 'PF-0001']);
  cli(root, ['start', REQUEST]);
  for (const args of [['brief'], ['status'], ['context', 'status'], ['context', 'show', 'CTX-0001'], ['baseline', 'status', 'PF-0001'], ['upgrade', 'status']]) {
    const result = frozen(root, args);
    assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
  }
  const doctor = frozen(root, ['doctor']);
  assert.equal(doctor.status, 0, doctor.stdout);
  assert.match(doctor.stdout, /PASS project context ledger/);
  assert.doesNotMatch(doctor.stdout, /FAIL/);
  assert.match(frozen(root, ['agent', 'status']).stdout, /newer/i, 'internal.3 sees the v8 contract as newer, never as corrupt');
});
