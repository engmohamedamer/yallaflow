// PF-0157: one cross-platform way to find and start developer tools (src/utils/command.js).
// Every Windows and macOS case here is SIMULATED: the rules run with an injected platform,
// path.win32 and an injected file table on whatever machine runs the tests. Nothing in this
// file proves behavior on a real Windows or macOS machine: that is NOT VERIFIED. The Linux
// cases use real files and real processes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveCommand, safeEnvironment, WINDOWS_ENV } from '../src/utils/command.js';
import { createPlan } from '../src/newproject/project.js';
import { CATALOG } from '../src/newproject/catalog.js';

const NODE_DIR = 'C:\\Program Files\\nodejs';
const COMPOSER_DIR = 'C:\\ProgramData\\ComposerSetup\\bin';
const PHP_DIR = 'C:\\tools\\php84';
const NPX_CMD = [':: Created by npm, please don\'t edit manually.', '@ECHO OFF', 'SETLOCAL', 'SET "NODE_EXE=%~dp0\\node.exe"', 'IF NOT EXIST "%NODE_EXE%" (', '  SET "NODE_EXE=node"', ')', 'SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"', 'SET "NPX_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npx-cli.js"', 'FOR /F "delims=" %%F IN (\'CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"\') DO (', '  SET "NPM_PREFIX_NPX_CLI_JS=%%F\\node_modules\\npm\\bin\\npx-cli.js"', ')', 'IF EXIST "%NPM_PREFIX_NPX_CLI_JS%" (', '  SET "NPX_CLI_JS=%NPM_PREFIX_NPX_CLI_JS%"', ')', '"%NODE_EXE%" "%NPX_CLI_JS%" %*', ''].join('\r\n');
// What Composer-Setup.exe writes next to composer.phar.
const COMPOSER_BAT = ['@echo OFF', ':: in case DelayedExpansion is on and a path contains ! ', 'setlocal DISABLEDELAYEDEXPANSION', 'php "%~dp0composer.phar" %*', ''].join('\r\n');

function machine(files) {
  const table = new Map(Object.entries(files).map(([file, text]) => [file.toLowerCase(), text]));
  return { platform: 'win32', deps: { isFile: async (file) => table.has(String(file).toLowerCase()), readText: async (file) => { const text = table.get(String(file).toLowerCase()); if (typeof text !== 'string') throw new Error('ENOENT'); return text; }, node: `${NODE_DIR}\\node.exe` } };
}
const WIN_FILES = {
  [`${NODE_DIR}\\node.exe`]: 'MZ',
  [`${NODE_DIR}\\npx.cmd`]: NPX_CMD,
  [`${NODE_DIR}\\node_modules\\npm\\bin\\npx-cli.js`]: '//',
  [`${NODE_DIR}\\node_modules\\npm\\bin\\npm-prefix.js`]: '//',
  [`${COMPOSER_DIR}\\composer.bat`]: COMPOSER_BAT,
  [`${COMPOSER_DIR}\\composer.phar`]: 'phar',
  [`${PHP_DIR}\\php.exe`]: 'MZ',
  'C:\\Program Files\\Git\\cmd\\git.exe': 'MZ'
};
const WIN_PATH = { Path: [NODE_DIR, COMPOSER_DIR, PHP_DIR, 'C:\\Program Files\\Git\\cmd'].join(';'), PATHEXT: '.COM;.EXE;.BAT;.CMD' };

test('the child environment is an allow-list; Windows adds the system variables its programs need', () => {
  const source = { PATH: '/usr/bin', HOME: '/home/u', OPENAI_API_KEY: 'k', GITHUB_TOKEN: 't', SystemRoot: 'C:\\Windows' };
  assert.deepEqual(safeEnvironment(['PATH', 'HOME'], source, 'linux'), { PATH: '/usr/bin', HOME: '/home/u' });
  assert.deepEqual(safeEnvironment(['PATH', 'HOME'], source, 'darwin'), { PATH: '/usr/bin', HOME: '/home/u' }, 'simulated macOS: the POSIX rules');
  // simulated Windows: variables are read whatever their case, and no secret passes
  const win = safeEnvironment(['PATH', 'HOME'], { Path: 'C:\\a', systemroot: 'C:\\Windows', APPDATA: 'C:\\Users\\m\\AppData\\Roaming', Temp: 'C:\\T', NPM_TOKEN: 'x', OPENAI_API_KEY: 'k' }, 'win32');
  assert.deepEqual(win, { PATH: 'C:\\a', SystemRoot: 'C:\\Windows', APPDATA: 'C:\\Users\\m\\AppData\\Roaming', TEMP: 'C:\\T' });
  assert.ok(!WINDOWS_ENV.some((name) => /TOKEN|SECRET|PASSWORD|KEY|AUTH|COOKIE/i.test(name)), 'no credential-shaped name is on the Windows list');
});

test('simulated Windows: npx is started as npm\'s own script with node, never through a shell', async () => {
  const found = await resolveCommand(['npx', '--yes', 'create-vite@9.3.4', 'shop'], WIN_PATH, machine(WIN_FILES));
  assert.deepEqual({ ok: found.ok, file: found.file, args: found.args }, { ok: true, file: `${NODE_DIR}\\node.exe`, args: [`${NODE_DIR}\\node_modules\\npm\\bin\\npx-cli.js`, '--yes', 'create-vite@9.3.4', 'shop'] });
});

test('simulated Windows: Composer\'s installer shim is started as php.exe with composer.phar', async () => {
  const found = await resolveCommand(['composer', 'create-project', 'laravel/laravel:13.11.0', 'shop'], WIN_PATH, machine(WIN_FILES));
  assert.deepEqual({ ok: found.ok, file: found.file, args: found.args }, { ok: true, file: `${PHP_DIR}\\php.exe`, args: [`${COMPOSER_DIR}\\composer.phar`, 'create-project', 'laravel/laravel:13.11.0', 'shop'] });
  // without PHP the shim cannot be started: said plainly, never run by a shell
  const { [`${PHP_DIR}\\php.exe`]: _php, ...noPhp } = WIN_FILES;
  const refused = await resolveCommand(['composer', '--version'], WIN_PATH, machine(noPhp));
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'not-startable');
  assert.match(refused.message, /needs PHP/);
});

test('simulated Windows: a missing tool is "not found"; a native .exe starts as itself; an unknown script is refused', async () => {
  const pc = machine(WIN_FILES);
  assert.deepEqual(await resolveCommand(['docker', '--version'], WIN_PATH, pc), { ok: false, reason: 'not-found', message: 'docker was not found on PATH' });
  const git = await resolveCommand(['git', 'init', '--quiet'], WIN_PATH, pc);
  assert.deepEqual({ file: git.file, args: git.args }, { file: 'C:\\Program Files\\Git\\cmd\\git.exe', args: ['init', '--quiet'] });
  // a command script that is not a recognizable shim (it could run anything) is not started
  const odd = machine({ 'C:\\odd\\composer.bat': '@echo off\r\ncall "C:\\somewhere\\else.bat" %*\r\n', [`${PHP_DIR}\\php.exe`]: 'MZ' });
  const refused = await resolveCommand(['composer', '--version'], { Path: `C:\\odd;${PHP_DIR}` }, odd);
  assert.equal(refused.reason, 'not-startable');
  // a shim whose target is outside its own folder is refused too
  const outside = machine({ 'C:\\odd\\composer.bat': 'php "%~dp0..\\evil\\composer.phar" %*\r\n', 'C:\\evil\\composer.phar': 'x', [`${PHP_DIR}\\php.exe`]: 'MZ' });
  assert.equal((await resolveCommand(['composer'], { Path: `C:\\odd;${PHP_DIR}` }, outside)).reason, 'not-startable');
});

test('Linux (real files) and simulated macOS: a tool is the executable file on an absolute PATH folder', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yf-command-'));
  const tool = path.join(dir, 'composer');
  await writeFile(tool, '#!/bin/sh\necho "Composer version 2.8.0"\n');
  assert.equal((await resolveCommand(['composer', '--version'], { PATH: dir })).reason, 'not-found', 'no execute bit yet');
  await chmod(tool, 0o755);
  for (const platform of ['linux', 'darwin']) {
    const found = await resolveCommand(['composer', '--version'], { PATH: dir }, { platform });
    assert.deepEqual({ ok: found.ok, file: found.file, args: found.args }, { ok: true, file: tool, args: ['--version'] });
  }
  // a relative PATH entry never supplies a program
  assert.equal((await resolveCommand(['composer'], { PATH: '.' })).ok, false);
});

test('a plan\'s prerequisite check finds tools through the shared lookup (real processes on this machine)', async (t) => {
  const bin = await mkdtemp(path.join(os.tmpdir(), 'yf-prereq-'));
  const parent = await mkdtemp(path.join(os.tmpdir(), 'yf-parent-'));
  const config = await mkdtemp(path.join(os.tmpdir(), 'yf-config-'));
  await writeFile(path.join(bin, 'php'), '#!/bin/sh\nif [ "$1" = "-m" ]; then printf "[PHP Modules]\\r\\npdo_sqlite\\r\\n"; else echo "PHP 8.4.1 (cli)"; fi\n', { mode: 0o755 });
  const saved = process.env.PATH;
  process.env.PATH = bin;
  t.after(() => { process.env.PATH = saved; });
  const plan = await createPlan({ name: 'shop', parent, stack: 'laravel' }, { catalog: CATALOG, env: { YALLAFLOW_CONSOLE_CONFIG: path.join(config, 'console.json') } });
  const byName = Object.fromEntries(plan.body.prerequisites.map((entry) => [entry.name, entry]));
  assert.equal(byName.php.found, true);
  assert.match(byName.php.version, /PHP 8\.4\.1/);
  assert.equal(byName.pdo_sqlite.found, true, 'CRLF output (Windows) still lists the module');
  assert.equal(byName.composer.found, false);
});
