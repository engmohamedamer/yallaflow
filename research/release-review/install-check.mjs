import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temp = mkdtempSync(path.join(os.tmpdir(), 'yf-install-review-'));
const env = { ...process.env, XDG_CONFIG_HOME: path.join(temp, 'config'), YALLAFLOW_CONSOLE_CONFIG: path.join(temp, 'console.json'), npm_config_cache: path.join(temp, 'cache') };
const run = (exe, args, cwd = temp) => execFileSync(exe, args, { cwd, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const prefix = path.join(temp, 'installed');
const project = path.join(temp, 'project');
mkdirSync(project);
const cli = path.join(prefix, 'node_modules/yallaflow/src/cli.js');
function workspaceFiles(dir, prefix = '') {
  return readdirSync(dir).sort().flatMap(name => {
    const full = path.join(dir, name), rel = path.posix.join(prefix, name);
    return statSync(full).isDirectory() ? workspaceFiles(full, rel) : [[rel, createHash('sha256').update(readFileSync(full)).digest('hex')]];
  });
}
let before;
for (const version of ['1.2.0', '1.3.0']) {
  run('npm', ['install', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', path.join(root, `research/release-review/artifacts/yallaflow-${version}.tgz`)]);
  assert.equal(run(process.execPath, [cli, '--version']).trim(), version);
  if (version === '1.2.0') {
    run(process.execPath, [cli, 'init'], project);
    run(process.execPath, [cli, 'start', 'Upgrade acceptance fixture'], project);
    before = workspaceFiles(path.join(project, '.yallaflow'));
  } else {
    run(process.execPath, [cli, 'snapshot', '--json'], project);
    run(process.execPath, [cli, 'work', 'show', 'PF-0001', '--json'], project);
    run(process.execPath, [cli, 'doctor'], project);
    assert.deepEqual(workspaceFiles(path.join(project, '.yallaflow')), before, 'upgrade read commands must preserve every workspace byte');
  }
  console.log(`PASS ${version}: installed tarball with registry dependencies; version correct`);
}
console.log('PASS upgrade 1.2.0 → 1.3.0: snapshot, work detail and doctor preserve workspace bytes');
writeFileSync(path.join(root, 'research/release-review/artifacts/install-results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), node: process.version, prefix, project, passed: ['1.2.0 isolated install', '1.3.0 upgrade install', 'version', 'existing workspace reads preserve all files'], limitation: 'npm --ignore-scripts; dependency install hooks were not executed' }, null, 2) + '\n');
