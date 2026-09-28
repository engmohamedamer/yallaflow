// v0.3.8 first-party agent bootstrap: a thin, versioned, YallaFlow-managed block in
// the provider's repository-root session file (AGENTS.md / CLAUDE.md) that points to
// the one canonical contract, .yallaflow/AGENT.md. Content outside the block is
// project-owned and never rewritten.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { cli } from '../test-support/legacy-context.js';
import { BOOTSTRAP_PROVIDERS, BOOTSTRAP_VERSION, bootstrapBody, inspectBootstrap, renderBootstrapBlock } from '../src/agent/bootstrap.js';
import { agentContractBody } from '../src/agent/contract.js';
import { ownershipOf } from '../src/core/ownership.js';

const { claude, codex } = BOOTSTRAP_PROVIDERS;

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-bootstrap-'));
  cli(root, ['init', '--type', 'greenfield']);
  return root;
}

const read = (root, file) => readFile(path.join(root, file), 'utf8');

test('AC-101: setup creates the provider file, or appends the block leaving existing content byte-for-byte', async () => {
  const root = await workspace();
  assert.match(cli(root, ['agent', 'setup', 'codex']).stdout, /Did create AGENTS\.md/);
  assert.equal(await read(root, 'AGENTS.md'), renderBootstrapBlock(codex));

  const own = '# House rules\n\nUse tabs.\n\n<!-- a comment of ours -->';
  await writeFile(path.join(root, 'CLAUDE.md'), own);
  assert.match(cli(root, ['agent', 'setup', 'claude']).stdout, /append the YallaFlow bootstrap block to CLAUDE\.md \(existing content unchanged\)/);
  const content = await read(root, 'CLAUDE.md');
  assert.ok(content.startsWith(own), 'user content is an unchanged prefix');
  assert.equal(content, `${own}\n\n${renderBootstrapBlock(claude)}`);
  assert.equal((await inspectBootstrap(root, claude)).state, 'current');
});

test('AC-102/AC-104: setup is idempotent and --dry-run writes nothing', async () => {
  const root = await workspace();
  assert.match(cli(root, ['agent', 'setup', 'claude', '--dry-run']).stdout, /Would create CLAUDE\.md[\s\S]*--- preview ---[\s\S]*@\.yallaflow\/AGENT\.md/);
  assert.deepEqual((await readdir(root)).filter((name) => name.endsWith('.md')), []);
  cli(root, ['agent', 'setup', 'claude']);
  const first = await read(root, 'CLAUDE.md');
  assert.match(cli(root, ['agent', 'setup', 'claude']).stdout, /already has the current YallaFlow bootstrap block \(v1\); nothing changed/);
  assert.equal(await read(root, 'CLAUDE.md'), first);
});

test('AC-103: a hand-edited block is refused without --preserve-existing, then kept verbatim with it', async () => {
  const root = await workspace();
  cli(root, ['agent', 'setup', 'codex']);
  const file = path.join(root, 'AGENTS.md');
  const edited = (await readFile(file, 'utf8')).replace('3. Run `yallaflow brief`', '3. Always run `yallaflow brief --verbose`');
  await writeFile(file, `Intro of ours.\n\n${edited}Trailer of ours.\n`);
  assert.equal((await inspectBootstrap(root, codex)).state, 'modified');
  const refused = cli(root, ['agent', 'setup', 'codex'], false);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /hand edits inside the YallaFlow-managed bootstrap block; refusing to replace them silently[\s\S]*No files were changed/);
  assert.equal(await readFile(file, 'utf8'), `Intro of ours.\n\n${edited}Trailer of ours.\n`);
  assert.match(cli(root, ['doctor']).stdout, /WARN AGENTS\.md agent bootstrap: the YallaFlow-managed block in AGENTS\.md was edited by hand/);

  cli(root, ['agent', 'setup', 'codex', '--preserve-existing']);
  const after = await readFile(file, 'utf8');
  assert.ok(after.startsWith(`Intro of ours.\n\n${renderBootstrapBlock(codex)}\n## Preserved YallaFlow bootstrap edits`));
  assert.match(after, /Always run `yallaflow brief --verbose`/);
  assert.ok(after.endsWith('Trailer of ours.\n'));
  assert.equal((await inspectBootstrap(root, codex)).state, 'current');
});

test('AC-105/AC-106: status reads state from markers; refresh updates only unmodified outdated blocks and never downgrades', async () => {
  const root = await workspace();
  const status = cli(root, ['agent', 'status']).stdout;
  assert.match(status, /codex \(AGENTS\.md\): not set up; run `yallaflow agent setup codex`/);
  assert.match(status, /claude \(CLAUDE\.md\): not set up/);
  assert.doesNotMatch(cli(root, ['doctor']).stdout, /agent bootstrap/, 'a provider that was never set up is not a warning');

  await writeFile(path.join(root, 'AGENTS.md'), `# Ours\n\n${renderBootstrapBlock(codex, 0, 'old pointer\n')}tail\n`);
  await writeFile(path.join(root, 'CLAUDE.md'), renderBootstrapBlock(claude, BOOTSTRAP_VERSION + 1, 'future\n'));
  assert.equal((await inspectBootstrap(root, codex)).state, 'outdated');
  assert.equal((await inspectBootstrap(root, claude)).state, 'newer');
  const doctor = cli(root, ['doctor']).stdout;
  assert.match(doctor, /WARN AGENTS\.md agent bootstrap: outdated \(v0 → v1\)/);
  assert.match(doctor, /WARN CLAUDE\.md agent bootstrap: written by a newer YallaFlow/);
  assert.match(doctor, /Workspace healthy\./);
  assert.match(cli(root, ['upgrade', 'plan']).stdout, /Refresh the AGENTS\.md agent bootstrap/);

  const newer = await read(root, 'CLAUDE.md');
  const refused = cli(root, ['agent', 'setup', 'claude'], false);
  assert.match(refused.stderr, /refusing to downgrade/);

  assert.match(cli(root, ['agent', 'refresh', '--dry-run']).stdout, /AGENTS\.md: would update only the YallaFlow bootstrap block \(v0 → v1\)/);
  assert.match(await read(root, 'AGENTS.md'), /old pointer/, 'dry-run wrote nothing');
  const refresh = cli(root, ['agent', 'refresh']).stdout;
  assert.match(refresh, /AGENTS\.md: updated only the YallaFlow bootstrap block/);
  assert.match(refresh, /CLAUDE\.md: bootstrap block not refreshed — written by a newer YallaFlow/);
  assert.equal(await read(root, 'AGENTS.md'), `# Ours\n\n${renderBootstrapBlock(codex)}tail\n`);
  assert.equal(await read(root, 'CLAUDE.md'), newer);
  assert.match(cli(root, ['agent', 'refresh']).stdout, /AGENTS\.md: bootstrap block already current; nothing changed/);
});

test('AC-105: a broken block or another provider\'s block is reported, never rewritten', async () => {
  const root = await workspace();
  const broken = `${renderBootstrapBlock(claude).replace('<!-- yallaflow-bootstrap:end -->\n', '')}`;
  await writeFile(path.join(root, 'CLAUDE.md'), broken);
  await writeFile(path.join(root, 'AGENTS.md'), renderBootstrapBlock(claude));
  assert.equal((await inspectBootstrap(root, claude)).state, 'broken');
  assert.equal((await inspectBootstrap(root, codex)).state, 'broken');
  assert.match(cli(root, ['agent', 'setup', 'claude'], false).stderr, /malformed YallaFlow bootstrap block/);
  assert.equal(await read(root, 'CLAUDE.md'), broken);
});

test('AC-107: provider blocks point to AGENT.md and never restate its rules', () => {
  const contract = agentContractBody();
  for (const provider of Object.values(BOOTSTRAP_PROVIDERS)) {
    const body = bootstrapBody(provider);
    assert.match(body, /\.yallaflow\/AGENT\.md/);
    assert.match(body, /yallaflow brief/);
    assert.ok(body.length < 1600, 'a thin pointer, not a second contract');
    for (const heading of contract.match(/^## .+$/gm)) assert.ok(!body.includes(heading), `does not copy ${heading}`);
  }
  // Claude Code expands `@path` imports in CLAUDE.md (resolved relative to the file);
  // Codex has no import syntax, so its block tells the agent to read the contract.
  assert.match(bootstrapBody(claude), /^@\.yallaflow\/AGENT\.md$/m);
  assert.doesNotMatch(bootstrapBody(codex), /^@/m);
});

test('AC-108: provider knowledge stays in src/agent and the agent command surface', async () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  const offenders = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (absolute.endsWith('.js')) {
        const relative = path.relative(src, absolute).split(path.sep).join('/');
        if (relative.startsWith('agent/') || ['cli.js', 'commands/agent.js'].includes(relative)) continue;
        if (/\b(claude|codex|CLAUDE\.md|AGENTS\.md)\b/i.test(await readFile(absolute, 'utf8'))) offenders.push(relative);
      }
    }
  }
  await walk(src);
  assert.deepEqual(offenders, []);
});

test('bootstrap files are classified as repository-root projections; help never writes', async () => {
  assert.equal(ownershipOf('CLAUDE.md', { base: 'repository' }).owner, 'projection');
  assert.equal(ownershipOf('AGENTS.md', { base: 'repository' }).owner, 'projection');
  assert.equal(ownershipOf('CLAUDE.md'), null, 'not a .yallaflow/ path');
  const root = await workspace();
  for (const args of [['agent', 'setup', '--help'], ['agent', 'setup', 'claude', '--help'], ['agent', 'setup', 'codex', '-h']]) {
    assert.match(cli(root, args).stdout, /yallaflow agent setup <codex\|claude>/);
  }
  assert.deepEqual((await readdir(root)).filter((name) => name.endsWith('.md')), []);
  assert.match(cli(root, ['agent', 'setup', 'cursor'], false).stderr, /Unknown agent provider: "cursor"\. Use one of: codex, claude\./);
  assert.match(cli(root, ['agent', 'setup'], false).stderr, /Usage: yallaflow agent setup <codex\|claude>/);
});
