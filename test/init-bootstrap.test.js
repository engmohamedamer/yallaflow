// v0.3.10-internal.3: `yallaflow init` is the one project setup command. It installs the
// thin repository bootstrap for every first-party agent (CLAUDE.md, AGENTS.md) through
// the same installer as `yallaflow agent setup`, preserves existing content, refuses
// unsafe files before writing anything, and rolls back cleanly on failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exists } from '../src/utils/fs.js';
import { initWorkspace, workspacePath } from '../src/core/workspace.js';
import { BOOTSTRAP_PROVIDERS, BOOTSTRAP_VERSION, inspectBootstrap, renderBootstrapBlock } from '../src/agent/bootstrap.js';
import { cli, git, writeTeamApp } from '../test-support/shared.js';

const { claude, codex } = BOOTSTRAP_PROVIDERS;
const read = (root, file) => readFile(path.join(root, file), 'utf8');
const tmp = () => mkdtemp(path.join(os.tmpdir(), 'yallaflow-init-boot-'));

test('init creates CLAUDE.md and AGENTS.md with the current bootstrap block pointing to .yallaflow/AGENT.md', async () => {
  for (const type of ['greenfield', 'brownfield']) {
    const root = await tmp();
    if (type === 'brownfield') await writeTeamApp(root);
    const out = cli(root, ['init']).stdout;
    assert.match(out, new RegExp(`Project kind: ${type}`));
    assert.match(out, /Agent bootstrap: CLAUDE\.md created, AGENTS\.md created — each points to \.yallaflow\/AGENT\.md/);
    for (const provider of [claude, codex]) {
      assert.deepEqual(await inspectBootstrap(root, provider), { provider: provider.id, file: provider.file, installed: BOOTSTRAP_VERSION, fileExists: true, version: BOOTSTRAP_VERSION, state: 'current' });
      assert.equal(await read(root, provider.file), renderBootstrapBlock(provider));
    }
    assert.match(await read(root, 'CLAUDE.md'), /^@\.yallaflow\/AGENT\.md$/m, 'Claude imports the canonical contract');
    assert.match(await read(root, 'AGENTS.md'), /The canonical YallaFlow agent contract is `\.yallaflow\/AGENT\.md`/);
    assert.ok(await exists(path.join(workspacePath(root), 'AGENT.md')), 'AGENT.md stays the canonical contract');
    assert.ok((await read(root, 'CLAUDE.md')).length < 2000, 'a thin pointer, not a second contract');
    assert.match(cli(root, ['doctor']).stdout, /Workspace healthy/);
  }
});

test('init preserves existing CLAUDE.md and AGENTS.md content byte-for-byte and only adds the managed block', async () => {
  const cases = [
    { 'CLAUDE.md': '# Team rules\n\nPrefer small PRs.\n' },
    { 'AGENTS.md': '# Codex notes\n\nRun npm test before pushing.' },
    { 'CLAUDE.md': '# Claude\n\nOurs.\n\n', 'AGENTS.md': '# Agents\n\nAlso ours.\n' }
  ];
  for (const files of cases) {
    const root = await tmp();
    for (const [name, content] of Object.entries(files)) await writeFile(path.join(root, name), content);
    const out = cli(root, ['init']).stdout;
    for (const provider of [claude, codex]) {
      const content = await read(root, provider.file);
      const original = files[provider.file];
      if (original !== undefined) {
        assert.ok(content.startsWith(original), `${provider.file} keeps its content byte-for-byte`);
        assert.match(out, new RegExp(`${provider.file.replace('.', '\\.')} block added \\(existing content kept\\)`));
      }
      assert.equal((await inspectBootstrap(root, provider)).state, 'current');
      assert.equal(content.match(/yallaflow-bootstrap:begin/g).length, 1, 'exactly one managed block');
    }
  }
});

test('a symlinked CLAUDE.md → AGENTS.md gets one shared block; an outdated block is updated; a current one is left alone', async () => {
  const linked = await tmp();
  await writeFile(path.join(linked, 'AGENTS.md'), '# Shared instructions\n');
  await symlink('AGENTS.md', path.join(linked, 'CLAUDE.md'));
  assert.match(cli(linked, ['init']).stdout, /Agent bootstrap: CLAUDE\.md block added \(existing content kept\), AGENTS\.md shared with claude/);
  assert.ok((await lstat(path.join(linked, 'CLAUDE.md'))).isSymbolicLink());
  assert.equal((await read(linked, 'AGENTS.md')).match(/yallaflow-bootstrap:begin/g).length, 1);

  const outdated = await tmp();
  await writeFile(path.join(outdated, 'CLAUDE.md'), `# Ours\n\n${renderBootstrapBlock(claude, 1, 'old pointer\n')}tail\n`);
  await writeFile(path.join(outdated, 'AGENTS.md'), renderBootstrapBlock(codex));
  assert.match(cli(outdated, ['init']).stdout, /CLAUDE\.md block updated, AGENTS\.md already current/);
  assert.equal(await read(outdated, 'CLAUDE.md'), `# Ours\n\n${renderBootstrapBlock(claude)}tail\n`);
});

test('init refuses an unsafe agent file before writing anything: no workspace, no files touched', async () => {
  const root = await tmp();
  const edited = renderBootstrapBlock(claude).replace('Follow `.yallaflow/AGENT.md`', 'Ignore the contract');
  await writeFile(path.join(root, 'CLAUDE.md'), edited);
  const result = cli(root, ['init'], false);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot install the agent bootstrap safely:\n- CLAUDE\.md: the YallaFlow-managed block in CLAUDE\.md was edited by hand[\s\S]*No files were changed\./);
  assert.deepEqual((await readdir(root)).sort(), ['CLAUDE.md']);
  assert.equal(await read(root, 'CLAUDE.md'), edited);

  const newer = await tmp();
  await writeFile(path.join(newer, 'AGENTS.md'), renderBootstrapBlock(codex, BOOTSTRAP_VERSION + 1, 'future\n'));
  assert.match(cli(newer, ['init'], false).stderr, /AGENTS\.md: written by a newer YallaFlow/);
  assert.equal(await exists(path.join(newer, '.yallaflow')), false);
});

test('a failure while installing the bootstrap rolls init back: no half-configured workspace, agent files restored', async () => {
  const root = await tmp();
  await writeFile(path.join(root, 'AGENTS.md'), '# Read-only agents file\n');
  await chmod(path.join(root, 'AGENTS.md'), 0o444);
  try {
    const result = cli(root, ['init'], false);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /YallaFlow init failed and was rolled back \(no \.yallaflow workspace, agent files unchanged\)/);
  } finally {
    await chmod(path.join(root, 'AGENTS.md'), 0o644);
  }
  assert.deepEqual((await readdir(root)).sort(), ['AGENTS.md'], 'the CLAUDE.md init had created is removed, .yallaflow is gone');
  assert.equal(await read(root, 'AGENTS.md'), '# Read-only agents file\n');
  // After fixing the cause, init succeeds normally.
  assert.match(cli(root, ['init']).stdout, /AGENTS\.md block added \(existing content kept\)/);
});

test('init stays idempotent: a second init refuses and changes nothing; explicit agent setup and refresh still work', async () => {
  const root = await tmp();
  cli(root, ['init']);
  const before = { claude: await read(root, 'CLAUDE.md'), codex: await read(root, 'AGENTS.md') };
  assert.match(cli(root, ['init'], false).stderr, /Workspace already exists/);
  assert.deepEqual({ claude: await read(root, 'CLAUDE.md'), codex: await read(root, 'AGENTS.md') }, before);
  assert.match(cli(root, ['agent', 'setup', 'claude']).stdout, new RegExp(`already has the current YallaFlow bootstrap block \\(v${BOOTSTRAP_VERSION}\\); nothing changed`));
  assert.match(cli(root, ['agent', 'setup', 'codex']).stdout, /nothing changed/);
  assert.match(cli(root, ['agent', 'refresh']).stdout, /CLAUDE\.md: bootstrap block already current; nothing changed/);
  // Recovery: a deleted provider file is restored by the explicit command.
  const { rm } = await import('node:fs/promises');
  await rm(path.join(root, 'AGENTS.md'));
  assert.match(cli(root, ['agent', 'setup', 'codex']).stdout, /Did create AGENTS\.md/);
  assert.equal(await read(root, 'AGENTS.md'), before.codex);
});

test('help never mutates; existing v0.3.10 workspaces without bootstrap files stay readable and unchanged by reads', async () => {
  const empty = await tmp();
  for (const args of [['init', '--help'], ['init', '-h']]) assert.match(cli(empty, args).stdout, /yallaflow init/);
  assert.deepEqual(await readdir(empty), []);

  const legacy = await tmp();
  await initWorkspace(legacy, 'Legacy', 'greenfield'); // the pre-internal.3 init result
  for (const args of [['brief'], ['status'], ['doctor'], ['agent', 'status'], ['upgrade', 'status']]) cli(legacy, args);
  assert.equal(await exists(path.join(legacy, 'CLAUDE.md')), false, 'reads never install a bootstrap');
  assert.match(cli(legacy, ['agent', 'status']).stdout, /claude \(CLAUDE\.md\): not set up/);
  assert.match(cli(legacy, ['doctor']).stdout, /Workspace healthy/);
});

test('team: the maintainer runs init once and commits; a teammate clone needs no init and no agent setup', async () => {
  const dir = await tmp();
  const origin = path.join(dir, 'origin.git');
  git(dir, ['init', '-q', '--bare', '-b', 'main', origin]);
  const maintainer = path.join(dir, 'maintainer');
  git(dir, ['clone', '-q', origin, maintainer]);
  git(maintainer, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(maintainer, ['config', 'user.name', 'M']);
  git(maintainer, ['config', 'user.email', 'm@example.com']);
  await writeTeamApp(maintainer);
  cli(maintainer, ['init']);
  git(maintainer, ['add', '.yallaflow', 'CLAUDE.md', 'AGENTS.md', '.']);
  git(maintainer, ['commit', '-qm', 'init']);
  git(maintainer, ['push', '-q', 'origin', 'main']);

  const teammate = path.join(dir, 'teammate');
  git(dir, ['clone', '-q', origin, teammate]);
  for (const provider of [claude, codex]) assert.equal((await inspectBootstrap(teammate, provider)).state, 'current');
  const brief = cli(teammate, ['brief']).stdout;
  assert.match(brief, /Agent bootstrap: .*CLAUDE\.md current/);
  assert.match(brief, /Agent bootstrap: .*AGENTS\.md current/);
  // The teammate's agent is oriented: until the maintainer's team approves a baseline,
  // normal work is refused with the baseline as the next action (v0.3.10-internal.4).
  assert.match(brief, /PROJECT_UNDERSTANDING_REQUIRED/);
  assert.match(cli(teammate, ['start', 'Fix invoice totals'], false).stderr, /PROJECT_UNDERSTANDING_REQUIRED[\s\S]*NEXT VALID ACTION: yallaflow baseline start/);
});
