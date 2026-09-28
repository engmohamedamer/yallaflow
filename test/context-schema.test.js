// v0.3.7 context-ledger storage contract.
//   schema v1 — one `origin` per fact (v0.3.6 shape, readable by v0.3.6)
//   schema v2 — `origins` only (multi-origin, reconciliation references, `merged`)
// No migration on read; a ledger is written at the lowest schema that represents its
// content and is never downgraded; a newer schema is refused up front; v0.3.6 refuses v2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { contextLedgerPath, loadContextLedger, mutateContextLedger, validateContextLedger } from '../src/context/ledger.js';
import { readYaml, writeYaml } from '../src/core/yaml.js';
import { addLegacyKnowledge, cli, reconcile, snapshotWorkspace } from '../test-support/legacy-context.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/v0.3.6-workspace/', import.meta.url));

async function v036Workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-schema-'));
  await cp(FIXTURE, root, { recursive: true });
  return root;
}

const rawFacts = async (root) => (await readYaml(contextLedgerPath(root))).facts;
const withoutProvenance = ({ origin, origins, updatedAt, ...rest }) => rest;

// The frozen v0.3.6 CLI, extracted from its release tag (skipped when the tag is absent,
// e.g. in a shallow clone).
let v036Cli = null;
async function frozenV036() {
  if (v036Cli !== null) return v036Cli;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-v036-cli-'));
  const archive = spawnSync('sh', ['-c', `git -C "${REPO}" archive v0.3.6-internal.1 src resources package.json | tar -x -C "${dir}"`], { encoding: 'utf8' });
  if (archive.status !== 0) return (v036Cli = false);
  await symlink(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
  return (v036Cli = path.join(dir, 'src', 'cli.js'));
}
const hasTag = spawnSync('git', ['-C', REPO, 'rev-parse', '-q', '--verify', 'refs/tags/v0.3.6-internal.1']).status === 0;
const runV036 = (bin, root, args) => spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8' });

async function reconcileIntoFixture(root) {
  await addLegacyKnowledge(root, [
    { kind: 'tech-stack', summary: 'The service runs on Node.js.', evidence: ['package.json'] },
    { kind: 'tech-stack', summary: 'Node.js is the application runtime.', evidence: ['package.json'] }
  ]);
  return reconcile(root, [
    { candidate: 'RC-0001', action: 'reconfirms', target: 'CTX-0002', reason: 'The legacy note observed the same runtime fact.' },
    { candidate: 'RC-0002', action: 'merge-with', target: 'RC-0001', reason: 'Same legacy statement, worded differently.' }
  ]);
}

test('a real v0.3.6 v1 ledger is read as-is, and stays v1 through ordinary v0.3.7 work', async () => {
  const root = await v036Workspace();
  const before = await readFile(contextLedgerPath(root), 'utf8');
  const { ledger } = await loadContextLedger(root);
  assert.equal(ledger.schemaVersion, 1);
  assert.ok(ledger.facts.every((fact) => fact.origin && fact.origins === undefined));
  for (const args of [['context', 'status'], ['context', 'list', '--all'], ['context', 'show', 'CTX-0002'], ['doctor'], ['upgrade', 'status'], ['brief']]) cli(root, args);
  assert.equal(await readFile(contextLedgerPath(root), 'utf8'), before, 'no migration on read');
  assert.match(cli(root, ['upgrade', 'status']).stdout, /context schema: v1 \(also readable by YallaFlow 0\.3\.6\)/);

  const priorFacts = await rawFacts(root);
  cli(root, ['start', 'Check backups']);
  cli(root, ['route', 'PF-0003', '--type', 'investigation', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Read-only.']);
  for (let i = 0; i < 6; i++) cli(root, ['advance', 'PF-0003']);
  cli(root, ['knowledge', 'propose', 'PF-0003', '--kind', 'database', '--source', 'implementation-runtime', '--summary', 'Nightly backups run at 02:00.', '--evidence', 'db.yml']);
  cli(root, ['knowledge', 'promote', 'PF-0003', '--candidate', 'K-001']);
  const after = await readYaml(contextLedgerPath(root));
  assert.equal(after.schemaVersion, 1, 'no v2 feature needed → still v1');
  assert.deepEqual(after.facts.slice(0, 3), priorFacts, 'untouched facts are byte-for-byte identical');
  assert.deepEqual(Object.keys(after.facts[3]), Object.keys(priorFacts[0]), 'new facts use the v1 shape and key order');
});

test('reconciling a real v0.3.6 fact writes valid v2: origin becomes origins[0], no duplicates, stable key order', async () => {
  const root = await v036Workspace();
  const v1 = await rawFacts(root);
  await reconcileIntoFixture(root);
  const stored = await readYaml(contextLedgerPath(root));
  assert.equal(stored.schemaVersion, 2);
  assert.deepEqual(validateContextLedger(stored), []);
  for (const [index, fact] of stored.facts.entries()) {
    assert.equal(fact.origin, undefined, `${fact.id}: one canonical provenance field in v2`);
    assert.deepEqual(fact.origins[0], v1[index].origin, `${fact.id}: the v1 origin is carried over unchanged`);
    assert.equal(Object.keys(fact).indexOf('origins'), Object.keys(v1[index]).indexOf('origin'), `${fact.id}: key position preserved`);
    const keys = fact.origins.map((origin) => `${origin.workId}:${origin.candidateId ?? origin.baselineFactId}`);
    assert.equal(new Set(keys).size, keys.length, `${fact.id}: no duplicated origin`);
  }
  const node = stored.facts.find((fact) => fact.id === 'CTX-0002');
  assert.deepEqual(node.origins.map((origin) => [origin.workId, origin.baselineFactId ?? origin.candidateId, origin.reconciliation?.candidate ?? null]),
    [['PF-0001', 'BF-002', null], ['PF-0003', 'K-001', 'RC-0001'], ['PF-0003', 'K-002', 'RC-0002']]);
  assert.deepEqual(node.history.slice(-2).map((event) => event.action), ['reconfirmed', 'merged']);
  assert.deepEqual(stored.facts.filter((fact) => fact.id !== 'CTX-0002').map(withoutProvenance), v1.filter((fact) => fact.id !== 'CTX-0002').map(withoutProvenance), 'other facts change only their provenance field name');
  assert.match(cli(root, ['doctor']).stdout, /Workspace healthy\./);
  assert.match(cli(root, ['upgrade', 'status']).stdout, /context schema: v2 \(multi-origin \/ reconciled knowledge; requires YallaFlow ≥ 0\.3\.7\)/);
});

test('v2 round-trips: a no-op mutation and later ordinary work keep v2 and every prior fact unchanged', async () => {
  const root = await v036Workspace();
  await reconcileIntoFixture(root);
  const before = await readYaml(contextLedgerPath(root));
  await mutateContextLedger(root, () => null, '2026-09-30T00:00:00.000Z');
  const noop = await readYaml(contextLedgerPath(root));
  assert.deepEqual({ ...noop, updatedAt: null }, { ...before, updatedAt: null });
  const { ledger } = await mutateContextLedger(root, (ops) => ops.introduce({ area: 'database', summary: 'Backups are encrypted.', evidence: [{ type: 'user-confirmed', description: 'DBA' }], origin: { workId: 'PF-0002', candidateId: 'K-099' } }));
  assert.equal(ledger.schemaVersion, 2, 'never downgraded');
  const stored = await readYaml(contextLedgerPath(root));
  assert.deepEqual(stored.facts.slice(0, before.facts.length), before.facts);
  assert.deepEqual(stored.facts.at(-1).origins, [{ workId: 'PF-0002', candidateId: 'K-099' }]);
  assert.equal(stored.facts.at(-1).origin, undefined);
});

test('doctor catches malformed and divergent provenance for both schemas', async () => {
  const root = await v036Workspace();
  const file = contextLedgerPath(root);
  const v1 = await readYaml(file);
  const cases = [
    [(l) => { l.facts[0].origins = [l.facts[0].origin]; }, /CTX-0001 carries both origin and origins \(divergent provenance\); schema v1 records provenance only in origin/],
    [(l) => { l.facts[0].origins = [l.facts[0].origin]; delete l.facts[0].origin; }, /CTX-0001 uses origins, which requires context schema v2 \(this ledger is v1\)/],
    [(l) => { l.facts[0].origin.reconciliation = { workId: 'PF-0002', candidate: 'RC-0001' }; }, /CTX-0001 origin has unknown field\(s\): reconciliation/],
    [(l) => { l.facts[1].history.push({ action: 'merged', at: 'now', workId: 'PF-0002' }); }, /CTX-0002 has schema-v2 history \(merged \/ historical events\) in a schema v1 ledger/],
    [(l) => { l.schemaVersion = 2; }, /CTX-0001 uses origin; schema v2 records provenance only in origins/],
    [(l) => { l.schemaVersion = 2; for (const fact of l.facts) { fact.origins = [fact.origin]; } }, /carries both origin and origins \(divergent provenance\); schema v2 records provenance only in origins/],
    [(l) => { l.schemaVersion = 2; for (const fact of l.facts) { fact.origins = []; delete fact.origin; } }, /CTX-0001 requires an origins array with at least its introducing origin/],
    [(l) => { l.schemaVersion = 7; }, /context schema v7, written by a newer YallaFlow; this CLI supports v1 and v2/]
  ];
  for (const [corrupt, pattern] of cases) {
    const ledger = structuredClone(v1);
    corrupt(ledger);
    await writeYaml(file, ledger);
    const doctor = cli(root, ['doctor'], false);
    assert.equal(doctor.status, 1, `doctor fails for ${pattern}`);
    assert.match(doctor.stdout, pattern);
  }
});

test('a ledger from a newer YallaFlow is refused up front, reported by upgrade status/brief, and never modified', async () => {
  const root = await v036Workspace();
  const file = contextLedgerPath(root);
  await writeYaml(file, { ...(await readYaml(file)), schemaVersion: 3 });
  const before = await snapshotWorkspace(root);
  for (const args of [['context', 'status'], ['context', 'list'], ['context', 'show', 'CTX-0001'], ['context', 'render']]) {
    const result = cli(root, args, false);
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, /uses context schema v3, written by a newer YallaFlow; this CLI supports v1 and v2\. Upgrade YallaFlow/);
  }
  const status = cli(root, ['upgrade', 'status']).stdout;
  assert.match(status, /context schema: v3 — NEWER than this CLI supports \(v1–v2\); upgrade YallaFlow/);
  assert.match(status, /Recommended next action:\n  Upgrade the installed YallaFlow package/);
  assert.match(cli(root, ['brief']).stdout, /Primary next concern: the project context ledger uses a schema this CLI does not support/);
  assert.equal(cli(root, ['doctor'], false).status, 1);
  assert.deepEqual(await snapshotWorkspace(root), before);
});

test('mixed versions: v0.3.6 keeps reading v1 ledgers v0.3.7 writes, and refuses v2 on its schemaVersion check', { skip: !hasTag && 'v0.3.6-internal.1 tag not available' }, async () => {
  const bin = await frozenV036();
  assert.ok(bin, 'frozen v0.3.6 CLI extracted');
  assert.match(runV036(bin, REPO, ['--version']).stdout, /0\.3\.6-internal\.1/);

  // v1 written by v0.3.7 (ordinary promotion) stays fully usable by v0.3.6.
  const v1 = await v036Workspace();
  cli(v1, ['agent', 'refresh']);
  cli(v1, ['start', 'Check backups']);
  cli(v1, ['route', 'PF-0003', '--type', 'investigation', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Read-only.']);
  for (let i = 0; i < 6; i++) cli(v1, ['advance', 'PF-0003']);
  cli(v1, ['knowledge', 'propose', 'PF-0003', '--kind', 'database', '--source', 'implementation-runtime', '--summary', 'Nightly backups run at 02:00.', '--evidence', 'db.yml']);
  cli(v1, ['knowledge', 'promote', 'PF-0003', '--candidate', 'K-001']);
  const doctorV1 = runV036(bin, v1, ['doctor']);
  assert.doesNotMatch(doctorV1.stdout, /FAIL project context|FAIL context ledger|FAIL context projection/);
  assert.match(runV036(bin, v1, ['context', 'show', 'CTX-0004']).stdout, /Nightly backups run at 02:00\./);

  // v2 (reconciled): v0.3.6 fails clearly on the schema version and changes nothing.
  const v2 = await v036Workspace();
  await reconcileIntoFixture(v2);
  const ledgerBefore = await readFile(contextLedgerPath(v2), 'utf8');
  const doctor = runV036(bin, v2, ['doctor']);
  assert.equal(doctor.status, 1);
  assert.match(doctor.stdout, /FAIL context ledger: context ledger schemaVersion must be 1\./);
  cli(v2, ['start', 'Another check']);
  cli(v2, ['route', 'PF-0005', '--type', 'investigation', '--scope', 'bounded', '--confidence', 'high', '--reason', 'Read-only.']);
  for (let i = 0; i < 6; i++) cli(v2, ['advance', 'PF-0005']);
  cli(v2, ['knowledge', 'propose', 'PF-0005', '--kind', 'database', '--source', 'implementation-runtime', '--summary', 'Replica lag is under a second.', '--evidence', 'db.yml']);
  const promote = runV036(bin, v2, ['knowledge', 'promote', 'PF-0005', '--candidate', 'K-001']);
  assert.equal(promote.status, 1);
  assert.match(promote.stderr, /The project context ledger is invalid; refusing to modify it:\n- context ledger schemaVersion must be 1\./);
  assert.equal(await readFile(contextLedgerPath(v2), 'utf8'), ledgerBefore, 'v0.3.6 never writes a v2 ledger');
});
