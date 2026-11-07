// Local-only release rehearsal. Exports immutable commits without changing Git state.
// Dependencies are reused from this checkout; this is not a clean npm install test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'research/release-review/artifacts');
const temp = mkdtempSync(path.join(os.tmpdir(), 'yallaflow-release-review-'));
mkdirSync(output, { recursive: true });
const env = { ...process.env, XDG_CONFIG_HOME: path.join(temp, 'config'), YALLAFLOW_CONSOLE_CONFIG: path.join(temp, 'console.json'), npm_config_cache: path.join(temp, 'npm-cache') };
const run = (exe, args, cwd = root, extra = {}) => execFileSync(exe, args, { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...extra });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const versions = [['1.2.0', 'bc14db0'], ['1.3.0', 'b700b2c']];
const overlay = run('git', ['diff', '--binary', 'b700b2c', '--', 'resources/console/app.js', 'test-support/agent-fixtures.js', 'test/workspace-lock.test.js', 'CHANGELOG.md']);
const overlayPath = path.join(output, '1.3.0-review-fixes.patch');
writeFileSync(overlayPath, overlay);
const results = [];
const sources = [];
for (const [version, ref] of versions) {
  const commit = run('git', ['rev-parse', `${ref}^{commit}`]).trim();
  const source = path.join(temp, `source-${version}`);
  mkdirSync(source);
  const archive = run('git', ['archive', '--format=tar', commit], root, { encoding: null });
  run('tar', ['-xf', '-', '-C', source], root, { input: archive });
  if (version === '1.3.0' && overlay) run('git', ['apply', overlayPath], source);
  sources.push(source);
  const pkg = JSON.parse(readFileSync(path.join(source, 'package.json')));
  const lock = JSON.parse(readFileSync(path.join(source, 'package-lock.json')));
  assert.equal(pkg.version, version);
  assert.equal(lock.version, version);
  assert.equal(lock.packages[''].version, version);
  if (version === '1.3.0') {
    const prior = path.join(output, 'yallaflow-1.3.0.tgz');
    const preserved = path.join(output, 'yallaflow-1.3.0-before-review-fixes.tgz');
    if (existsSync(prior) && !existsSync(preserved)) copyFileSync(prior, preserved);
  }
  const first = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], source))[0];
  const tarball = path.join(output, first.filename);
  const digest = hash(readFileSync(tarball));
  const secondDir = path.join(temp, `repeat-${version}`);
  mkdirSync(secondDir);
  run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', secondDir], source);
  assert.equal(hash(readFileSync(path.join(secondDir, first.filename))), digest, 'packing the same commit must reproduce bytes');
  const names = first.files.map(f => f.path);
  assert(names.includes('src/cli.js') && names.includes('resources/console/app.js'));
  assert(!names.some(n => /^(research|test|test-support|\.yallaflow|\.git)\//.test(n)));
  assert(!names.some(n => /(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|credentials(?:\.json)?)$/.test(n)), 'secret-like filenames excluded');
  const experimental = ['src/agents/claude.js', 'src/agents/claude-files.js', 'src/agents/claude-detect.js', 'resources/agents/claude-channel.mjs', 'resources/agents/claude-hook.mjs', 'docs/agents-claude-experimental.md'];
  assert(!names.some(n => experimental.includes(n)), 'experimental runtime files excluded');
  assert.equal(names.includes('src/agents/codex.js'), version === '1.3.0');
  assert(names.includes('resources/agents/claude/README.md'), 'ordinary Claude agent instructions remain available');
  // Inspect contents for high-signal secret formats without printing matches.
  const unpack = path.join(temp, `unpack-${version}`);
  mkdirSync(unpack);
  run('tar', ['-xzf', tarball, '-C', unpack]);
  const packageRoot = path.join(unpack, 'package');
  for (const name of names) {
    const content = readFileSync(path.join(packageRoot, name));
    if (content.includes(0)) continue;
    const text = content.toString('utf8');
    assert(!/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bAKIA[0-9A-Z]{16}\b/.test(text), `high-signal secret scan failed: ${name}`);
  }
  symlinkSync(path.join(root, 'node_modules'), path.join(packageRoot, 'node_modules'), 'dir');
  const cli = path.join(packageRoot, 'src/cli.js');
  assert.equal(run(process.execPath, [cli, '--version'], temp).trim(), version);
  for (const kind of ['greenfield', 'brownfield']) {
    const project = path.join(temp, `${version}-${kind}`);
    mkdirSync(project);
    if (kind === 'brownfield') {
      writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'acceptance-fixture', private: true }));
      writeFileSync(path.join(project, 'app.js'), 'console.log("acceptance fixture");\n');
    }
    run(process.execPath, [cli, 'init'], project);
    assert(existsSync(path.join(project, 'AGENTS.md')) && existsSync(path.join(project, 'CLAUDE.md')));
    run(process.execPath, [cli, 'doctor'], project);
    const snapshot = JSON.parse(run(process.execPath, [cli, 'snapshot', '--json'], project));
    assert(snapshot && !snapshot.error);
    if (kind === 'greenfield') {
      run(process.execPath, [cli, 'start', 'Acceptance fixture work'], project);
    } else {
      let rejected = false;
      try { run(process.execPath, [cli, 'start', 'Must require understanding'], project, { stdio: ['pipe', 'pipe', 'pipe'] }); }
      catch (error) { rejected = /PROJECT_UNDERSTANDING_REQUIRED|project understanding|baseline/i.test(String(error.stdout) + String(error.stderr)); }
      assert(rejected, 'brownfield engineering work must be gated');
    }
  }
  if (version === '1.3.0') {
    const module = await import(new URL(`file://${packageRoot}/src/agents/experimental.js`));
    assert.equal(module.claudeIncluded(), false);
    await assert.rejects(() => module.loadClaude(), { code: 'CLAUDE_NOT_INCLUDED' });
  }
  writeFileSync(`${tarball}.sha256`, `${digest}  ${first.filename}\n`);
  if (version === '1.2.0') {
    const historical = path.join(root, 'research/release-candidate', first.filename);
    mkdirSync(path.dirname(historical), { recursive: true });
    if (!existsSync(historical)) copyFileSync(tarball, historical);
    assert.equal(hash(readFileSync(historical)), digest, 'preserve the historical artifact unless identical');
    assert.equal(readFileSync(`${historical}.sha256`, 'utf8').trim().split(/\s+/)[0], digest, 'historical checksum matches regenerated package');
  }
  writeFileSync(path.join(output, `${version}-package-files.json`), JSON.stringify(first.files, null, 2) + '\n');
  results.push({ version, commit, overlaySha256: version === '1.3.0' ? hash(overlay) : null, filename: first.filename, sha256: digest, fileCount: names.length, reproducible: true, smoke: ['version', 'greenfield init', 'brownfield init', 'bootstraps', 'doctor', 'snapshot', 'brownfield gate'], dependencies: 'reused local node_modules, not a fresh install' });
  console.log(`PASS ${version}: reproducible package, version agreement, file boundaries, secret-pattern scan and isolated CLI smoke (${names.length} files)`);
}

// Rehearse the exact delta against the exported 1.2.0 tree, then compare every file.
const delta = run('git', ['diff', '--binary', versions[0][1], versions[1][1]], root);
const patch = path.join(temp, '1.3.0.patch');
writeFileSync(patch, delta);
run('git', ['apply', '--check', patch], sources[0]);
run('git', ['apply', patch], sources[0]);
if (overlay) run('git', ['apply', overlayPath], sources[0]);
function tree(dir, prefix = '') {
  return readdirSync(dir).sort().flatMap(name => {
    const full = path.join(dir, name), relative = path.posix.join(prefix, name);
    if (statSync(full).isDirectory()) return tree(full, relative);
    return [[relative, hash(readFileSync(full)), statSync(full).mode & 0o111]];
  });
}
assert.deepEqual(tree(sources[0]), tree(sources[1]), '1.3 delta must reproduce the exact 1.3 tree');
console.log('PASS integration: 1.3.0 delta plus recorded review overlay applies to exact 1.2.0 baseline and reproduces every file and executable bit');
const currentPack = path.join(temp, 'current-pack');
mkdirSync(currentPack);
run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', currentPack], root);
assert.equal(hash(readFileSync(path.join(currentPack, 'yallaflow-1.3.0.tgz'))), results[1].sha256, 'working tree package must match reviewed commit package');
console.log('PASS current working-tree package matches the reviewed 1.3.0 artifact; historical 1.2.0 checksum verified');
const report = { checkedAt: new Date().toISOString(), node: process.version, releaseCandidates: results, integration: 'exact exported trees match after patch application', limitations: ['No npm registry install or publication', 'Filename/high-signal secret scan is not exhaustive', 'No real provider interaction', 'Browser acceptance recorded separately'], scratch: temp };
writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Artifacts: ${output}`);
