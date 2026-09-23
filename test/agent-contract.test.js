// v0.3.6 agent-contract versioning: AGENT.md written by earlier YallaFlow versions is
// detected (never rewritten on detection) and upgraded only by the deliberate,
// idempotent `yallaflow agent refresh`, which preserves user-authored content.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { workspacePath } from '../src/core/workspace.js';
import { AGENT_CONTRACT_VERSION, agentContractBody, inspectAgentContract, renderAgentContractBlock } from '../src/agent/contract.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const fixture = (name) => readFile(fileURLToPath(new URL(`./fixtures/agent-contract/${name}`, import.meta.url)), 'utf8');

function run(root, args, expectOk = true) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });
  if (expectOk) assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr || result.stdout}`);
  return result;
}

async function workspaceWithAgent(content) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-agent-'));
  run(root, ['init', '--type', 'greenfield']);
  const file = path.join(workspacePath(root), 'AGENT.md');
  if (content !== undefined) await writeFile(file, content);
  return { root, file };
}

test('a new workspace gets a versioned, current agent contract and no warnings', async () => {
  const { root, file } = await workspaceWithAgent();
  const content = await readFile(file, 'utf8');
  assert.match(content, new RegExp(`^<!-- yallaflow-agent-contract:begin version=${AGENT_CONTRACT_VERSION} sha256=[0-9a-f]{64}`));
  assert.match(content, /## Project memory sequence/);
  assert.match(content, /<!-- yallaflow-agent-contract:end -->\n$/);
  assert.equal((await inspectAgentContract(root)).state, 'current');
  assert.doesNotMatch(run(root, ['doctor']).stdout, /AGENT\.md agent contract/);
  assert.doesNotMatch(run(root, ['status']).stdout, /Agent contract:/);
  assert.match(run(root, ['agent', 'status']).stdout, /Agent contract \(\.yallaflow\/AGENT\.md\): current/);
});

for (const [name, label] of [['v0.3.5.md', 'v0.3.5'], ['v0.3.4.md', 'v0.1–v0.3.4']]) {
  test(`an unmodified ${label} AGENT.md is detected read-only and replaced only by refresh`, async () => {
    const legacy = await fixture(name);
    const { root, file } = await workspaceWithAgent(legacy);
    assert.deepEqual(await inspectAgentContract(root), { state: 'legacy-generated', installed: AGENT_CONTRACT_VERSION, legacy: label });

    const doctor = run(root, ['doctor']);
    assert.match(doctor.stdout, new RegExp(`WARN AGENT\\.md agent contract: predates versioned agent contracts \\(unmodified ${label} template\\); run \`yallaflow agent refresh\``));
    assert.match(doctor.stdout, /Workspace healthy\./);
    assert.match(run(root, ['status']).stdout, /Agent contract: predates versioned agent contracts/);
    run(root, ['agent', 'status']);
    run(root, ['agent', 'refresh', '--dry-run']);
    assert.equal(await readFile(file, 'utf8'), legacy); // detection and dry-run never mutate

    assert.match(run(root, ['agent', 'refresh']).stdout, new RegExp(`Did replace the unmodified ${label} generated AGENT\\.md`));
    const refreshed = await readFile(file, 'utf8');
    assert.equal(refreshed, renderAgentContractBlock());
    assert.match(refreshed, /--type uncaptured-artifact/);
    assert.equal((await inspectAgentContract(root)).state, 'current');

    assert.match(run(root, ['agent', 'refresh']).stdout, new RegExp(`already at agent contract v${AGENT_CONTRACT_VERSION}; nothing changed`));
    assert.equal(await readFile(file, 'utf8'), refreshed); // idempotent
  });
}

test('a customized pre-v0.3.6 AGENT.md is never silently replaced; --preserve-existing keeps it verbatim', async () => {
  const custom = `${await fixture('v0.3.5.md')}\n## Team rules\n\nAlways run \`composer test\` before claiming done.\n`;
  const { root, file } = await workspaceWithAgent(custom);
  assert.equal((await inspectAgentContract(root)).state, 'legacy-customized');

  const refused = run(root, ['agent', 'refresh'], false);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /refusing to replace it silently[\s\S]*--preserve-existing[\s\S]*No files were changed\./);
  assert.equal(await readFile(file, 'utf8'), custom);

  const preview = run(root, ['agent', 'refresh', '--preserve-existing', '--dry-run']);
  assert.match(preview.stdout, /Would install the managed contract and keep the previous content verbatim/);
  assert.equal(await readFile(file, 'utf8'), custom);

  run(root, ['agent', 'refresh', '--preserve-existing']);
  const upgraded = await readFile(file, 'utf8');
  assert.ok(upgraded.startsWith(renderAgentContractBlock()));
  assert.match(upgraded, /## Preserved project instructions/);
  assert.ok(upgraded.includes(custom.trimEnd()));
  assert.equal((await inspectAgentContract(root)).state, 'current');
  run(root, ['agent', 'refresh', '--preserve-existing']);
  assert.equal(await readFile(file, 'utf8'), upgraded); // idempotent
});

test('an outdated managed block is updated in place; content outside the block is untouched', async () => {
  const before = '# Project notes\n\nDeploys happen on Thursdays.\n\n';
  const after = '\n## Local conventions\n\nUse Arabic UI strings from lang/ar.\n';
  const { root, file } = await workspaceWithAgent(`${before}${renderAgentContractBlock(0, '# Old contract\n\nOld rules.\n')}${after}`);
  assert.equal((await inspectAgentContract(root)).state, 'outdated');
  assert.match(run(root, ['doctor']).stdout, new RegExp(`WARN AGENT\\.md agent contract: outdated \\(v0 → v${AGENT_CONTRACT_VERSION}\\)`));
  assert.match(run(root, ['agent', 'refresh']).stdout, /update only the YallaFlow-managed block/);
  assert.equal(await readFile(file, 'utf8'), `${before}${renderAgentContractBlock()}${after}`);
});

test('hand edits inside the managed block are detected and preserved, never overwritten', async () => {
  const block = renderAgentContractBlock().replace('## Core rules', '## Core rules\n\nOur extra rule: never touch billing/.');
  const { root, file } = await workspaceWithAgent(block);
  assert.equal((await inspectAgentContract(root)).state, 'modified');
  assert.notEqual(run(root, ['agent', 'refresh'], false).status, 0);
  assert.equal(await readFile(file, 'utf8'), block);
  run(root, ['agent', 'refresh', '--preserve-existing']);
  const refreshed = await readFile(file, 'utf8');
  assert.match(refreshed, /## Preserved project instructions[\s\S]*Our extra rule: never touch billing\//);
  assert.equal((await inspectAgentContract(root)).state, 'current');
});

test('a contract from a newer YallaFlow is not downgraded', async () => {
  const { root, file } = await workspaceWithAgent(renderAgentContractBlock(AGENT_CONTRACT_VERSION + 1, agentContractBody()));
  const before = await readFile(file, 'utf8');
  const refused = run(root, ['agent', 'refresh'], false);
  assert.match(refused.stderr, /refusing to downgrade/);
  assert.equal(await readFile(file, 'utf8'), before);
});

test('a missing AGENT.md is recreated by refresh', async () => {
  const { root, file } = await workspaceWithAgent();
  await rm(file);
  assert.equal((await inspectAgentContract(root)).state, 'missing');
  run(root, ['agent', 'refresh']);
  assert.equal(await readFile(file, 'utf8'), renderAgentContractBlock());
});

// Contract v2 (v0.3.6): direct classified commands require --scope. Workspaces whose
// AGENT.md carries the real v1 managed block (fixture captured from the v1 template)
// must be detected as outdated and upgraded in place.
test('agent contract v2 teaches scope-required direct commands', async () => {
  assert.equal(AGENT_CONTRACT_VERSION, 2);
  const body = agentContractBody();
  assert.match(body, /yallaflow feature\|bug\|investigate\|change\|refactor\|release "<title>" --scope <spike\|bounded\|architectural>/);
  assert.match(body, /--scope is required; never guess or default a scope/);
  assert.match(body, /If the type or scope is not already known, use yallaflow start and classify with yallaflow route instead/);
  assert.match(body, /do not force or work around it/);
});

test('a v1 managed contract is reported outdated, read-only, by agent status, status, and doctor', async () => {
  const v1 = await fixture('v1-managed.md');
  assert.match(v1, /^<!-- yallaflow-agent-contract:begin version=1 /);
  const { root, file } = await workspaceWithAgent(v1);
  assert.deepEqual(await inspectAgentContract(root), { state: 'outdated', installed: 2, version: 1 });
  const status = run(root, ['agent', 'status']).stdout;
  assert.match(status, /Agent contract \(\.yallaflow\/AGENT\.md\): outdated/);
  assert.match(status, /Installed package contract: v2/);
  assert.match(status, /Workspace contract: v1/);
  assert.match(status, /outdated \(v1 → v2\); run `yallaflow agent refresh`/);
  assert.match(run(root, ['doctor']).stdout, /WARN AGENT\.md agent contract: outdated \(v1 → v2\)/);
  assert.match(run(root, ['status']).stdout, /Agent contract: outdated \(v1 → v2\)/);
  run(root, ['agent', 'refresh', '--dry-run']);
  assert.equal(await readFile(file, 'utf8'), v1);
});

test('refresh upgrades a v1 block to v2 in place, preserves custom instructions, and is idempotent', async () => {
  const before = '# Team instructions\n\nNever run migrations against production from an agent session.\n\n';
  const after = '\n## Local conventions\n\nArabic UI strings live in lang/ar.\n';
  const { root, file } = await workspaceWithAgent(`${before}${await fixture('v1-managed.md')}${after}`);
  assert.match(run(root, ['agent', 'refresh']).stdout, /update only the YallaFlow-managed block \(content outside it unchanged\) \(agent contract v2\)/);
  const upgraded = await readFile(file, 'utf8');
  assert.equal(upgraded, `${before}${renderAgentContractBlock()}${after}`);
  assert.match(upgraded, /--scope is required; never guess or default a scope/);
  assert.equal((await inspectAgentContract(root)).state, 'current');
  assert.match(run(root, ['agent', 'refresh']).stdout, /already at agent contract v2; nothing changed/);
  assert.equal(await readFile(file, 'utf8'), upgraded);
});

test('a hand-edited v1 block is still never overwritten without --preserve-existing', async () => {
  const edited = (await fixture('v1-managed.md')).replace('## Core rules', '## Core rules\n\nTeam rule: billing/ is off-limits.');
  const { root, file } = await workspaceWithAgent(edited);
  assert.equal((await inspectAgentContract(root)).state, 'modified');
  assert.notEqual(run(root, ['agent', 'refresh'], false).status, 0);
  assert.equal(await readFile(file, 'utf8'), edited);
  run(root, ['agent', 'refresh', '--preserve-existing']);
  const refreshed = await readFile(file, 'utf8');
  assert.ok(refreshed.startsWith(renderAgentContractBlock()));
  assert.match(refreshed, /## Preserved project instructions[\s\S]*Team rule: billing\/ is off-limits\./);
});

test('the v2 CLI refuses to downgrade a v3 contract', async () => {
  const { root, file } = await workspaceWithAgent(renderAgentContractBlock(3, agentContractBody()));
  const before = await readFile(file, 'utf8');
  assert.equal((await inspectAgentContract(root)).state, 'newer');
  assert.match(run(root, ['agent', 'refresh'], false).stderr, /newer YallaFlow contract \(v3\); refusing to downgrade it to v2/);
  assert.equal(await readFile(file, 'utf8'), before);
});
