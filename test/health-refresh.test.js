// PF-0183: project health check and safe integration refresh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessHealth } from '../src/core/health.js';
import { applyRefresh, listRefreshBackups, planRefresh, previewRefresh, restoreRefresh } from '../src/agent/refresh.js';
import { renderAgentContractBlock, AGENT_CONTRACT_VERSION } from '../src/agent/contract.js';
import { BOOTSTRAP_PROVIDERS, renderBootstrapBlock } from '../src/agent/bootstrap.js';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const run = (cwd, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-health-'));
  spawnSync('git', ['init', '-q'], { cwd: root });
  const init = run(root, 'init', '--name', 'demo', '--type', 'greenfield');
  assert.equal(init.status, 0, init.stderr);
  return root;
}

// Every file and link under root (including .git), with content hashes: a write anywhere shows.
async function snapshot(root) {
  const out = [];
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (entry.isSymbolicLink()) out.push(`${rel} -> ${await readlink(full)}`);
      else if (entry.isDirectory()) { out.push(`${rel}/`); await walk(full); }
      else out.push(`${rel} ${createHash('sha256').update(await readFile(full)).digest('hex')} ${(await lstat(full)).mode}`);
    }
  }
  await walk(root);
  return out.join('\n');
}

const agentFile = (root) => path.join(root, '.yallaflow', 'AGENT.md');

test('a new project is healthy; health, refresh check and preview write nothing', async () => {
  const root = await project();
  const before = await snapshot(root);
  const report = await assessHealth(root);
  assert.equal(report.overall, 'healthy', JSON.stringify(report.findings));
  assert.equal(report.schema, 'yallaflow.health/1');
  const cli = run(root, 'health', '--json');
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).overall, 'healthy');
  assert.equal(run(root, 'refresh', 'check').status, 0);
  assert.equal(run(root, 'refresh', 'preview').status, 0);
  assert.equal((await planRefresh(root)).writes.length, 0);
  assert.equal(await snapshot(root), before, 'nothing written, not even a lock or a backup folder');
});

test('an older contract and bootstrap: update available, preview, apply only the managed blocks, idempotent, restore', async () => {
  const root = await project();
  const outside = '\n## Our own notes\n\nKeep this exactly.\n';
  await writeFile(agentFile(root), `Intro we wrote.\n\n${renderAgentContractBlock(AGENT_CONTRACT_VERSION - 1, 'An older contract body.\n')}${outside}`);
  const claude = path.join(root, 'CLAUDE.md');
  await writeFile(claude, `# Team rules\n\nUse tabs.\n\n${renderBootstrapBlock(BOOTSTRAP_PROVIDERS.claude, 1, 'old bootstrap\n')}\nAfter the block.\n`);
  // History the refresh must never touch.
  await mkdir(path.join(root, '.yallaflow', 'decisions'), { recursive: true });
  await writeFile(path.join(root, '.yallaflow', 'decisions', 'ADR-0001.md'), '# A decision\n');
  const historyBefore = await snapshot(path.join(root, '.yallaflow', 'decisions'));

  const report = await assessHealth(root);
  assert.equal(report.overall, 'update-available');
  assert.deepEqual(report.findings.map((item) => item.class), ['update-available', 'update-available']);

  const preview = await previewRefresh(root);
  assert.deepEqual(preview.writes.map((item) => [item.file, item.action]), [['.yallaflow/AGENT.md', 'update'], ['CLAUDE.md', 'update']]);
  assert.ok(preview.changes[0].after.includes('Intro we wrote.') && preview.changes[0].after.endsWith(outside));

  const gitBefore = await snapshot(path.join(root, '.git'));
  const result = await applyRefresh(root);
  assert.deepEqual(result.written, ['.yallaflow/AGENT.md', 'CLAUDE.md']);
  const agent = await readFile(agentFile(root), 'utf8');
  assert.ok(agent.startsWith('Intro we wrote.\n\n') && agent.endsWith(outside), 'text outside the block is byte-identical');
  assert.ok(agent.includes(`version=${AGENT_CONTRACT_VERSION} `));
  const claudeText = await readFile(claude, 'utf8');
  assert.ok(claudeText.startsWith('# Team rules\n\nUse tabs.\n\n') && claudeText.endsWith('\nAfter the block.\n'));
  assert.equal((await assessHealth(root)).overall, 'healthy');
  assert.equal(await snapshot(path.join(root, '.git')), gitBefore, 'Git is never touched');
  assert.equal(await snapshot(path.join(root, '.yallaflow', 'decisions')), historyBefore);

  const again = await applyRefresh(root);
  assert.equal(again.written.length, 0, 'a second refresh changes nothing');
  assert.equal(again.backup, null);

  const [backup] = await listRefreshBackups(root);
  assert.equal(backup.state, 'complete');
  assert.equal(spawnSync('git', ['check-ignore', '-q', `.yallaflow/local/backups/${backup.id}/manifest.json`], { cwd: root }).status, 0, 'backups are git-ignored');
  const restored = await restoreRefresh(root, backup.id);
  assert.deepEqual(restored.restored.sort(), ['.yallaflow/AGENT.md', 'CLAUDE.md']);
  assert.ok((await readFile(agentFile(root), 'utf8')).includes(`version=${AGENT_CONTRACT_VERSION - 1} `));
  assert.equal((await listRefreshBackups(root))[0].state, 'restored');
});

test('a hand-edited managed block is a conflict: nothing is written until the developer resolves it', async () => {
  const root = await project();
  const original = await readFile(agentFile(root), 'utf8');
  const edited = original.replace('## Core rules', '## Core rules\n\nOur extra rule inside the block.');
  assert.notEqual(edited, original);
  await writeFile(agentFile(root), edited);
  const before = await snapshot(root);

  const report = await assessHealth(root);
  assert.equal(report.overall, 'manual-review');
  assert.match(report.findings[0].message, /edited by hand/);
  assert.equal(run(root, 'health').status, 1, 'health exits 1 when a person has to decide');

  await assert.rejects(applyRefresh(root), (error) => error.code === 'REFRESH_CONFLICT' && /--resolve \.yallaflow\/AGENT\.md=keep/.test(error.message));
  const cli = run(root, 'refresh', 'apply');
  assert.notEqual(cli.status, 0);
  assert.equal(await snapshot(root), before, 'a refused refresh writes nothing (no backup either)');

  const kept = await applyRefresh(root, { resolve: { '.yallaflow/AGENT.md': 'keep' } });
  assert.equal(kept.written.length, 0);
  assert.equal(await readFile(agentFile(root), 'utf8'), edited);

  await assert.rejects(planRefresh(root, { resolve: { 'CLAUDE.md': 'keep' } }), /no hand edits to resolve/);
  await assert.rejects(planRefresh(root, { resolve: { 'package.json': 'keep' } }), /not a file YallaFlow manages/);

  const preserved = await applyRefresh(root, { resolve: { '.yallaflow/AGENT.md': 'preserve' } });
  assert.deepEqual(preserved.written, ['.yallaflow/AGENT.md']);
  const after = await readFile(agentFile(root), 'utf8');
  assert.ok(after.includes('Our extra rule inside the block.'), 'the edited text is kept verbatim');
  assert.equal((await planRefresh(root)).items[0].action, 'none');
});

test('missing AGENT.md and missing bootstraps are repairable; --add-missing adds the blocks', async () => {
  const root = await project();
  await rm(agentFile(root));
  await rm(path.join(root, 'CLAUDE.md'));
  await rm(path.join(root, 'AGENTS.md'));
  await writeFile(path.join(root, 'AGENTS.md'), '# Our agents file\n');
  const report = await assessHealth(root);
  assert.equal(report.overall, 'repairable');
  assert.ok(report.findings.some((item) => /AGENT\.md is missing/.test(item.message)));
  assert.ok(report.findings.some((item) => /No agent bootstrap is set up/.test(item.message)));
  const first = await applyRefresh(root);
  assert.deepEqual(first.written, ['.yallaflow/AGENT.md'], 'optional bootstraps only with --add-missing');
  const second = await applyRefresh(root, { addMissing: true });
  assert.deepEqual(second.written, ['AGENTS.md', 'CLAUDE.md']);
  assert.ok((await readFile(path.join(root, 'AGENTS.md'), 'utf8')).startsWith('# Our agents file\n'));
  assert.equal((await assessHealth(root)).overall, 'healthy');
  // Restore removes a file the refresh created and puts the appended one back.
  await restoreRefresh(root, second.backup);
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), '# Our agents file\n');
  await assert.rejects(lstat(path.join(root, 'CLAUDE.md')), /ENOENT/);
});

test('links: a managed file or workspace link leaving the project is unsafe and never written through', { skip: process.platform === 'win32' && 'symlinks need privileges on Windows' }, async () => {
  const root = await project();
  const elsewhere = await mkdtemp(path.join(os.tmpdir(), 'yf-elsewhere-'));
  const target = path.join(elsewhere, 'AGENT.md');
  await writeFile(target, renderAgentContractBlock(AGENT_CONTRACT_VERSION - 1, 'old\n'));
  await rm(agentFile(root));
  await symlink(target, agentFile(root));
  const report = await assessHealth(root);
  assert.equal(report.overall, 'unsafe');
  await assert.rejects(applyRefresh(root), (error) => error.code === 'REFRESH_UNSAFE');
  assert.ok((await readFile(target, 'utf8')).includes('old'), 'the outside file is untouched');

  const second = await project();
  await symlink(elsewhere, path.join(second, '.yallaflow', 'work-link'));
  const linked = await assessHealth(second);
  assert.equal(linked.overall, 'unsafe');
  assert.match(linked.findings[0].message, /\.yallaflow\/work-link is a link that leaves the project/);

  // A dangling link inside the workspace is unsafe too.
  const third = await project();
  await symlink(path.join(elsewhere, 'nothing-here'), path.join(third, '.yallaflow', 'dangling'));
  assert.equal((await assessHealth(third)).overall, 'unsafe');
});

test('a block from a newer YallaFlow is refused; a project requiring a newer YallaFlow is unsafe to update', async () => {
  const root = await project();
  await writeFile(agentFile(root), renderAgentContractBlock(AGENT_CONTRACT_VERSION + 5, 'from the future\n'));
  const report = await assessHealth(root);
  assert.equal(report.overall, 'unsafe');
  assert.match(report.findings[0].message, /newer YallaFlow/);
  await assert.rejects(applyRefresh(root), /Nothing was changed/);

  const other = await project();
  const configFile = path.join(other, '.yallaflow', 'config.yaml');
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  config.yallaflow = { ...(config.yallaflow ?? {}), minimumVersion: '99.0.0' };
  await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
  const incompatible = await assessHealth(other);
  assert.equal(incompatible.overall, 'unsafe');
  assert.ok(incompatible.findings.some((item) => item.area === 'compatibility'));
  const cli = run(other, 'refresh', 'apply');
  assert.notEqual(cli.status, 0, 'a state-changing refresh stops on an incompatible project');
});

test('an interrupted refresh is reported and can be restored; restore refuses a file changed afterwards', async () => {
  const root = await project();
  await rm(path.join(root, 'CLAUDE.md'));
  await writeFile(agentFile(root), renderAgentContractBlock(AGENT_CONTRACT_VERSION - 1, 'old\n'));
  const before = await readFile(agentFile(root), 'utf8');
  await assert.rejects(applyRefresh(root, { addMissing: true }, undefined, { afterWrite: (index) => { if (index === 0) throw new Error('power cut'); } }), /power cut/);
  const [backup] = await listRefreshBackups(root);
  assert.equal(backup.state, 'started');
  const report = await assessHealth(root);
  assert.equal(report.overall, 'repairable');
  assert.ok(report.findings.some((item) => item.area === 'refresh' && item.next.includes(backup.id)));
  const done = await restoreRefresh(root);
  assert.deepEqual(done.restored, ['.yallaflow/AGENT.md']);
  assert.equal(await readFile(agentFile(root), 'utf8'), before);

  // Changed after the refresh: nothing is restored.
  const again = await applyRefresh(root);
  await writeFile(agentFile(root), `${await readFile(agentFile(root), 'utf8')}\nedited after\n`);
  await assert.rejects(restoreRefresh(root, again.backup), (error) => error.code === 'REFRESH_CHANGED_SINCE');
});

test('older workspace fixture: health is read-only, refresh changes only AGENT.md and keeps all history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yf-old-'));
  await cp(path.join(FIXTURES, 'v0.3.6-workspace'), root, { recursive: true });
  const before = await snapshot(root);
  const report = await assessHealth(root);
  assert.equal(await snapshot(root), before, 'health wrote nothing');
  assert.ok(['update-available', 'repairable'].includes(report.overall), report.overall);
  const history = async () => (await snapshot(path.join(root, '.yallaflow'))).split('\n').filter((line) => !line.startsWith('AGENT.md') && !line.startsWith('local'));
  const historyBefore = await history();
  const result = await applyRefresh(root);
  assert.deepEqual(result.written, ['.yallaflow/AGENT.md']);
  assert.deepEqual(await history(), historyBefore, 'work records, ledgers, memory and sources are byte-identical');
  const outsideBefore = before.split('\n').filter((line) => !line.startsWith('.yallaflow'));
  assert.deepEqual((await snapshot(root)).split('\n').filter((line) => !line.startsWith('.yallaflow')), outsideBefore, 'project files untouched');
});

// Review fixes (PF-0186).
test('restore never acts on a crafted or foreign manifest: only the three managed files, this checkout only', async () => {
  const root = await project();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'yf-victim-'));
  const victim = path.join(outside, 'victim.txt');
  await writeFile(victim, 'original\n');
  await writeFile(path.join(root, 'app.js'), 'keep me\n');
  const sha = (text) => createHash('sha256').update(text).digest('hex');
  const id = 'refresh-20990101T000000Z-abcdef';
  const dir = path.join(root, '.yallaflow', 'local', 'backups', id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, '1.bak'), 'pwned\n');
  const manifest = (files, extra = {}) => JSON.stringify({ schema: 'yallaflow.refresh-backup/1', id, createdAt: '2099-01-01T00:00:00.000Z', root, state: 'started', files, ...extra });
  const crafted = [
    { file: path.relative(root, victim), existed: true, before: sha('pwned\n'), intended: [], after: sha('original\n'), backup: '1.bak' },
    { file: 'app.js', existed: false, before: null, intended: [], after: sha('keep me\n'), backup: null }
  ];
  await writeFile(path.join(dir, 'manifest.json'), manifest(crafted));
  assert.deepEqual(await listRefreshBackups(root), [], 'a manifest naming other files is ignored');
  await assert.rejects(restoreRefresh(root), (error) => error.code === 'REFRESH_NO_BACKUP');
  assert.equal((await assessHealth(root)).findings.some((item) => item.area === 'refresh'), false);
  // A well-formed manifest from another folder (committed, or copied) is ignored too.
  const agentText = await readFile(agentFile(root), 'utf8');
  await writeFile(path.join(dir, 'manifest.json'), manifest([{ file: '.yallaflow/AGENT.md', existed: true, before: sha('pwned\n'), intended: [], after: sha(agentText), backup: '1.bak' }], { root: '/somewhere/else' }));
  await assert.rejects(restoreRefresh(root, id), (error) => error.code === 'REFRESH_NO_BACKUP');
  // A backup name that is not a plain N.bak is refused.
  await writeFile(path.join(dir, 'manifest.json'), manifest([{ file: '.yallaflow/AGENT.md', existed: true, before: sha('pwned\n'), intended: [], after: sha(agentText), backup: '../../../x' }]));
  await assert.rejects(restoreRefresh(root, id), (error) => error.code === 'REFRESH_NO_BACKUP');
  assert.equal(await readFile(victim, 'utf8'), 'original\n');
  assert.equal(await readFile(path.join(root, 'app.js'), 'utf8'), 'keep me\n');
  assert.equal(await readFile(agentFile(root), 'utf8'), agentText);
});

test('--add-missing with CLAUDE.md linked to AGENTS.md writes the shared file once and verifies', { skip: process.platform === 'win32' && 'symlinks need privileges on Windows' }, async () => {
  const root = await project();
  await rm(path.join(root, 'CLAUDE.md'));
  await writeFile(path.join(root, 'AGENTS.md'), '# Shared agent notes\n');
  await symlink('AGENTS.md', path.join(root, 'CLAUDE.md'));
  const result = await applyRefresh(root, { addMissing: true });
  assert.deepEqual(result.written, ['AGENTS.md']);
  const [backup] = await listRefreshBackups(root);
  assert.equal(backup.state, 'complete');
  assert.equal((await lstat(path.join(root, 'CLAUDE.md'))).isSymbolicLink(), true, 'the link is kept');
  assert.ok((await readFile(path.join(root, 'AGENTS.md'), 'utf8')).startsWith('# Shared agent notes\n'));
});

test('a file edited while the refresh runs is not overwritten', async () => {
  const root = await project();
  await writeFile(agentFile(root), renderAgentContractBlock(AGENT_CONTRACT_VERSION - 1, 'old\n'));
  const edited = `${renderAgentContractBlock(AGENT_CONTRACT_VERSION - 1, 'old\n')}\nMy note added during the refresh.\n`;
  await assert.rejects(applyRefresh(root, {}, undefined, { beforeWrite: () => writeFile(agentFile(root), edited) }), (error) => error.code === 'REFRESH_CHANGED_DURING' && /Nothing was written/.test(error.message));
  assert.equal(await readFile(agentFile(root), 'utf8'), edited);
});
