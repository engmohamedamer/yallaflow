// v0.3.7 state ownership: every file YallaFlow writes has a declared owner; the agent
// contract names CLI-owned state; deterministic tampering is detected; supported CLI
// transitions stay doctor-clean.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workspacePath } from '../src/core/workspace.js';
import { STATE_OWNERSHIP, ownershipOf } from '../src/core/ownership.js';
import { agentContractBody } from '../src/agent/contract.js';
import { cli, reconcile, yaschoolsWorkspace } from '../test-support/legacy-context.js';

async function files(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(absolute, base));
    else out.push(path.relative(base, absolute).split(path.sep).join('/'));
  }
  return out;
}

// A workspace exercising baseline, knowledge (fact + ADR), sources, verification,
// questions, limitations, and an applied reconciliation.
async function busyWorkspace() {
  const { root, currentWorkId } = await yaschoolsWorkspace();
  await writeFile(path.join(root, 'request.txt'), 'Export the school calendar.\n');
  cli(root, ['intake', 'add', currentWorkId, 'request.txt']);
  cli(root, ['verify', currentWorkId, '--', process.execPath, '--version']);
  cli(root, ['question', 'add', currentWorkId, '--category', 'business', '--text', 'Which calendar format?']);
  cli(root, ['limitation', 'add', currentWorkId, '--type', 'runtime-unavailable', '--area', 'database', '--summary', 'Production DB not reachable.', '--reason', 'No VPN.']);
  cli(root, ['knowledge', 'propose', currentWorkId, '--kind', 'decision', '--source', 'implementation-runtime', '--summary', 'Keep Codeception at the root.', '--evidence', 'codeception.yml',
    '--context', 'Suites live at the root.', '--decision', 'Keep root config.', '--reason', 'CI simplicity.', '--cost-if-wrong', 'Low.']);
  cli(root, ['knowledge', 'promote', currentWorkId, '--candidate', 'K-002']);
  const rid = await reconcile(root, [
    { candidate: 'RC-0001', action: 'reconfirms', target: 'CTX-0001', reason: 'Same fact.' },
    { candidate: 'RC-0003', action: 'limitation', limitationType: 'not-inspected', reason: 'Session gap.' },
    { candidate: 'RC-0004', action: 'new' }
  ]);
  return { root, currentWorkId, rid };
}

test('54. every file a full lifecycle writes has a declared owner, and the agent contract names all CLI-owned state', async () => {
  const { root } = await busyWorkspace();
  const all = await files(workspacePath(root));
  const unowned = all.filter((relative) => !ownershipOf(relative));
  assert.deepEqual(unowned, []);
  for (const expected of ['work/PF-0004/reconciliation.yaml', 'work/PF-0004/legacy-context.md', 'work/PF-0003/questions.yaml', 'work/PF-0003/discovery.yaml', 'context/index.yaml', 'decisions/ADR-PF-0003-K-002.md']) {
    assert.ok(all.includes(expected), `fixture exercises ${expected}`);
  }
  const body = agentContractBody();
  for (const entry of STATE_OWNERSHIP.filter((item) => item.owner === 'cli')) {
    const name = entry.path.replace('work/<id>/', '').replace('sources/SRC-####/', 'sources/').replace('decisions/ADR-*.md', 'decisions/');
    assert.ok(body.includes(name), `agent contract names CLI-owned ${entry.path}`);
  }
  assert.match(body, /work\.md is shared: you write its narrative sections/);
});

test('55. hand-editing a CLI-recorded work.md lifecycle record is detected; narrative edits are not', async () => {
  const { root, currentWorkId } = await yaschoolsWorkspace();
  const file = path.join(workspacePath(root), 'work', currentWorkId, 'work.md');
  const original = await readFile(file, 'utf8');
  await writeFile(file, original.replace('## Findings\n', '## Findings\n\nThe tenant resolver lives in tenant.php.\n'));
  assert.doesNotMatch(cli(root, ['doctor']).stdout, /Routing Decision/, 'the Agent writing narrative sections is expected');
  await writeFile(file, original.replace('**Work type:** investigation', '**Work type:** feature'));
  const doctor = cli(root, ['doctor']).stdout;
  assert.match(doctor, new RegExp(`WARN ${currentWorkId}: work\\.md's CLI-recorded Routing Decision no longer matches meta\\.yaml`));
  assert.match(doctor, /Workspace healthy\./, 'informational: work.md is shared, never locked');
});

test('55. hand-editing structured state is detected deterministically', async () => {
  const { root, rid } = await busyWorkspace();
  const planFile = path.join(workspacePath(root), 'work', rid, 'reconciliation.yaml');
  const plan = JSON.parse(await readFile(planFile, 'utf8'));
  plan.candidates[0].summary = 'Rewritten by hand.';
  await writeFile(planFile, JSON.stringify(plan, null, 2));
  assert.match(cli(root, ['doctor'], false).stdout, /FAIL .*plan is marked approved but was changed afterward/);
});

test('56. supported CLI transitions leave the workspace doctor-clean with no ownership warnings', async () => {
  const { root } = await busyWorkspace();
  const doctor = cli(root, ['doctor']).stdout;
  assert.match(doctor, /Workspace healthy\./);
  assert.doesNotMatch(doctor, /FAIL|Routing Decision no longer matches|still presented as current/);
});
