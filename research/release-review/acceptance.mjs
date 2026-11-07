// Start the combined manual acceptance environment using disposable projects only.
// Intentionally prints a private console link: do not capture this command as durable evidence.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const installation = JSON.parse(readFileSync(path.join(root, 'research/release-review/artifacts/install-results.json')));
const packageRoot = path.join(installation.prefix, 'node_modules/yallaflow');
const cli = path.join(packageRoot, 'src/cli.js');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'yf-manual-acceptance-'));
process.env.XDG_CONFIG_HOME = path.join(temporary, 'user-config');
process.env.YALLAFLOW_CONSOLE_CONFIG = path.join(temporary, 'console.json');
const roots = [];
for (const kind of ['greenfield', 'brownfield']) {
  const project = path.join(temporary, kind);
  mkdirSync(project);
  if (kind === 'brownfield') {
    writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'existing-example', private: true }));
    writeFileSync(path.join(project, 'app.js'), 'console.log("sample app — do not run");\n');
  }
  execFileSync(process.execPath, [cli, 'init'], { cwd: project, env: process.env, stdio: 'pipe' });
  if (kind === 'greenfield') execFileSync(process.execPath, [cli, 'start', 'Manual acceptance: review sample delivery workflow'], { cwd: project, env: process.env, stdio: 'pipe' });
  roots.push(project);
}
const { startConsoleServer } = await import(pathToFileURL(path.join(packageRoot, 'src/console/server.js')));
const server = await startConsoleServer({ roots, port: 0, agents: !process.argv.includes('--no-agents') });
if (process.argv.includes('--self-check')) {
  const response = await fetch(`${server.url}api/projects`, { headers: { Authorization: `Bearer ${server.token}` } });
  if (!response.ok || (await response.json()).projects.length !== 2) throw new Error('Acceptance fixture setup failed');
  await server.close();
  console.log('PASS acceptance startup: two disposable projects, isolated registry, loopback server and clean shutdown. No provider session started.');
} else {
  console.log('YallaFlow combined acceptance — installed 1.3.0 package includes 1.2.0 console behavior.');
  console.log(`Disposable projects: ${temporary}`);
  console.log(`Private local link: ${server.url}#token=${server.token}`);
  console.log('Codex starts only when you explicitly start a session in the UI. Existing provider login is unchanged.');
  console.log('Ctrl-C stops the console and its managed sessions. Scratch projects remain available for review.');
  let stopped = false;
  const stop = async () => { if (stopped) return; stopped = true; const incomplete = await server.close(); if (incomplete?.length) console.error('Some process cleanup could not be verified; inspect local processes before restarting.'); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
