// PF-0148: finding and starting agents on Windows. Every Windows case here is SIMULATED:
// the lookup and launch rules run with platform 'win32', path.win32 and an injected file
// table on whatever machine runs the tests. Nothing in this file proves behavior on a real
// Windows machine (process creation, PowerShell, Git Bash): that is NOT VERIFIED.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectCodex, envValue, isExecutable, launchSpec, programExtensions, run, which } from '../src/agents/detect.js';
import { terminalCommand, openTerminal } from '../src/agents/terminal.js';
import { claudeIncluded } from '../src/agents/experimental.js';

const W = { platform: 'win32' };
const NPM = 'C:\\Users\\Mona Ali\\AppData\\Roaming\\npm';
const LOCAL = 'C:\\Users\\Mona Ali\\.local\\bin';
const ARABIC = 'D:\\أدوات\\bin';
// The shim npm's cmd-shim writes for a package's bin script.
const shim = (relative) => ['@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', '', 'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', '', `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${relative}" %*`, ''].join('\r\n');
const NPM_CMD = [':: Created by npm, please don\'t edit manually.', '@ECHO OFF', 'SETLOCAL', 'SET "NODE_EXE=%~dp0\\node.exe"', 'IF NOT EXIST "%NODE_EXE%" (', '  SET "NODE_EXE=node"', ')', 'SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"', 'SET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"', '"%NODE_EXE%" "%NPM_CLI_JS%" %*', ''].join('\r\n');
function machine(files) {
  const table = new Map(Object.entries(files).map(([file, text]) => [file.toLowerCase(), text]));
  return { platform: 'win32', isFile: async (file) => table.has(String(file).toLowerCase()), readText: async (file) => { const text = table.get(String(file).toLowerCase()); if (typeof text !== 'string') throw new Error('ENOENT'); return text; }, node: 'C:\\Program Files\\nodejs\\node.exe' };
}

test('simulated Windows: PATH is read whatever its case, and PATHEXT decides the extensions tried', () => {
  assert.equal(envValue({ Path: 'C:\\a' }, 'PATH', 'win32'), 'C:\\a');
  assert.equal(envValue({ path: 'C:\\a' }, 'PATH', 'win32'), 'C:\\a');
  assert.equal(envValue({ PATH: 'C:\\b', Path: 'C:\\a' }, 'PATH', 'win32'), 'C:\\b', 'the exact name wins');
  assert.equal(envValue({ Path: '/x' }, 'PATH', 'linux'), undefined, 'POSIX names are exact');
  assert.deepEqual(programExtensions({ PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.JS;.PS1' }, 'win32'), ['.com', '.exe', '.bat', '.cmd'], 'only what can be started without a shell');
  assert.deepEqual(programExtensions({ pathext: '.CMD;.EXE' }, 'win32'), ['.cmd', '.exe']);
  assert.deepEqual(programExtensions({}, 'win32'), ['.exe', '.com', '.cmd', '.bat']);
  assert.deepEqual(programExtensions({ PATHEXT: '.EXE' }, 'linux'), ['']);
});

test('simulated Windows: a native .exe and an npm .cmd shim are found; folders with spaces and Arabic names work', async () => {
  const pc = machine({ [`${LOCAL}\\claude.exe`]: 'MZ', [`${NPM}\\codex.cmd`]: 'x', [`${NPM}\\codex`]: '#!/bin/sh', [`${NPM}\\codex.ps1`]: 'x', [`${ARABIC}\\codex-acp.cmd`]: 'x' });
  const env = { Path: `C:\\Windows\\system32;"${NPM}";${LOCAL};${ARABIC};relative\\bin;.`, PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  assert.equal(await which('claude', env, pc), `${LOCAL}\\claude.exe`);
  assert.equal(await which('codex', env, pc), `${NPM}\\codex.cmd`, 'the .cmd shim, never the extensionless shell script or the .ps1');
  assert.equal(await which('codex-acp', env, pc), `${ARABIC}\\codex-acp.cmd`);
  assert.equal(await which('claude.exe', env, pc), `${LOCAL}\\claude.exe`, 'a name that already has its extension');
  assert.equal(await which('CLAUDE', { PATH: LOCAL.toUpperCase() }, pc), `${LOCAL.toUpperCase()}\\CLAUDE.exe`, 'the file table is case-insensitive like the real one');
  assert.equal(await which('gemini', env, pc), null, 'a missing program');
  assert.equal(await which('claude', { Path: 'relative;.' }, pc), null, 'relative PATH entries are never searched');
  assert.equal(await which('claude', {}, pc), null);
  assert.equal(await which(`${LOCAL}\\claude.exe`, {}, pc), `${LOCAL}\\claude.exe`, 'a full path with backslashes');
  assert.equal(await which(`${NPM}\\codex`, {}, pc), null, 'an extensionless file is not a Windows program');
  // .exe wins over .cmd in the same folder when PATHEXT lists it first
  const both = machine({ 'C:\\t\\claude.exe': 'MZ', 'C:\\t\\claude.cmd': 'x' });
  assert.equal(await which('claude', { PATH: 'C:\\t', PATHEXT: '.EXE;.CMD' }, both), 'C:\\t\\claude.exe');
  assert.equal(await which('claude', { PATH: 'C:\\t', PATHEXT: '.CMD;.EXE' }, both), 'C:\\t\\claude.cmd');
  // no execute-bit assumption
  assert.equal(await isExecutable('C:\\t\\claude.exe', both), true);
  assert.equal(await isExecutable('C:\\t\\notes.txt', machine({ 'C:\\t\\notes.txt': 'x' })), false);
});

test('POSIX lookup is unchanged: an execute bit is required and the bare name is used', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yf-which-'));
  await writeFile(path.join(dir, 'claude'), '#!/bin/sh\n');
  await writeFile(path.join(dir, 'claude.exe'), 'MZ');
  assert.equal(await which('claude', { PATH: dir }), null, 'no execute bit yet');
  await chmod(path.join(dir, 'claude'), 0o755);
  assert.equal(await which('claude', { PATH: dir }), path.join(dir, 'claude'));
  assert.equal(await which('claude', { Path: dir }), null, 'POSIX reads PATH only');
  assert.deepEqual(await launchSpec(path.join(dir, 'claude'), ['--version']), { file: path.join(dir, 'claude'), args: ['--version'] });
});

test('simulated Windows: an npm shim is started as its target with node, never through a shell', async () => {
  const target = `${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`;
  const pc = machine({ [`${NPM}\\codex.cmd`]: shim('node_modules\\@openai\\codex\\bin\\codex.js'), [target]: '//' });
  assert.deepEqual(await launchSpec(`${NPM}\\codex.cmd`, ['login', 'status'], pc), { file: 'C:\\Program Files\\nodejs\\node.exe', args: [target, 'login', 'status'] });
  // node.exe beside the shim is preferred, as the shim itself does
  const withNode = machine({ [`${NPM}\\codex.cmd`]: shim('node_modules\\@openai\\codex\\bin\\codex.js'), [target]: '//', [`${NPM}\\node.exe`]: 'MZ' });
  assert.equal((await launchSpec(`${NPM}\\codex.cmd`, [], withNode)).file, `${NPM}\\node.exe`);
  // npm's own npm.cmd: the CLI script, not the prefix helper
  const node = 'C:\\Program Files\\nodejs';
  const npm = machine({ [`${node}\\npm.cmd`]: NPM_CMD, [`${node}\\node_modules\\npm\\bin\\npm-cli.js`]: '//', [`${node}\\node_modules\\npm\\bin\\npm-prefix.js`]: '//', [`${node}\\node.exe`]: 'MZ' });
  assert.deepEqual(await launchSpec(`${node}\\npm.cmd`, ['prefix', '-g'], npm), { file: `${node}\\node.exe`, args: [`${node}\\node_modules\\npm\\bin\\npm-cli.js`, 'prefix', '-g'] });
  // a shim whose target is a native program
  const native = machine({ 'C:\\t\\claude.cmd': shim('node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'), 'C:\\t\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe': 'MZ' });
  assert.deepEqual(await launchSpec('C:\\t\\claude.cmd', ['--version'], native), { file: 'C:\\t\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe', args: ['--version'] });
  // a native .exe is started as it is; arguments stay an array, untouched
  const odd = ['a b', '& calc', '"x"', '%PATH%', 'مرحبا'];
  assert.deepEqual(await launchSpec(`${LOCAL}\\claude.exe`, odd, pc), { file: `${LOCAL}\\claude.exe`, args: odd });
  assert.deepEqual((await launchSpec(`${NPM}\\codex.cmd`, odd, pc)).args.slice(1), odd, 'no quoting or joining is ever done');
});

test('simulated Windows: a broken or unknown command script is refused with a plain reason, not run by a shell', async () => {
  const refused = async (files, file = 'C:\\t\\tool.cmd') => { try { await launchSpec(file, [], machine(files)); return 'started'; } catch (error) { return `${error.code}: ${error.message}`; } };
  const expected = /^SHIM_UNSUPPORTED: tool\.cmd is a Windows command script that YallaFlow cannot start safely \(it never uses a shell\)\./;
  assert.match(await refused({ 'C:\\t\\tool.cmd': '@echo off\r\ndel /q %TEMP%\\*\r\n' }), expected, 'a hand-written script');
  assert.match(await refused({ 'C:\\t\\tool.cmd': shim('node_modules\\tool\\cli.js') }), expected, 'the target is missing');
  assert.match(await refused({ 'C:\\t\\tool.cmd': shim('..\\..\\Windows\\system32\\evil.js'), 'C:\\Windows\\system32\\evil.js': '//' }), expected, 'a target outside the shim folder');
  assert.match(await refused({}), expected, 'the shim cannot be read');
  assert.match(await refused({ 'C:\\t\\tool.bat': 'x' }, 'C:\\t\\tool.bat'), /^SHIM_UNSUPPORTED: tool\.bat/);
  // run() reports it as an answer; it never throws
  const probe = await run('C:\\t\\tool.cmd', ['--version'], { platform: 'win32' });
  assert.deepEqual([probe.ok, probe.launchError], [false, 'SHIM_UNSUPPORTED']);
  assert.match(probe.stderr, /cannot start safely/);
});

test('a program that cannot be started is an answer with its cause, never a crash', async () => {
  const missing = await run(path.join(os.tmpdir(), 'yf-no-such-program'), ['--version']);
  assert.deepEqual([missing.ok, missing.launchError], [false, 'ENOENT']);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yf-broken-'));
  await writeFile(path.join(dir, 'codex'), 'not a program');
  await chmod(path.join(dir, 'codex'), 0o755);
  const broken = await run(path.join(dir, 'codex'), ['--version']);
  assert.equal(broken.ok, false);
});

test('providers are independent: a missing or broken Claude Code never makes Codex unavailable, and the reverse', { skip: !claudeIncluded() && 'the experimental Claude connection is not in this tree' }, async () => {
  const { fakeTools } = await import('../test-support/agent-fixtures.js');
  const { detectClaude } = await import('../src/agents/claude-detect.js');
  const tools = await fakeTools();
  const empty = await mkdtemp(path.join(os.tmpdir(), 'yf-empty-path-'));
  const env = { ...tools.env, PATH: empty };
  const codex = await detectCodex(env);
  const claude = await detectClaude(env);
  assert.equal(codex.ready, true, codex.problems.join(' '));
  assert.deepEqual(codex.adapter.launch, { file: codex.adapter.path, args: [] }, 'what a session starts is resolved by detection');
  assert.equal(claude.ready, false);
  assert.match(claude.problems.join(' '), /Claude Code \(`claude`\) is not installed or not on PATH/);
  // Claude Code present, Codex missing
  const bin = await mkdtemp(path.join(os.tmpdir(), 'yf-claude-only-'));
  await writeFile(path.join(bin, 'claude'), '#!/bin/sh\nif [ "$1" = "auth" ]; then echo \'{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}\'; else echo "2.1.319 (Claude Code)"; fi\n');
  await chmod(path.join(bin, 'claude'), 0o755);
  const only = { PATH: `${bin}:/usr/bin:/bin` };
  assert.equal((await detectClaude(only)).ready, true);
  const noCodex = await detectCodex(only);
  assert.equal(noCodex.ready, false);
  assert.match(noCodex.problems.join(' '), /Codex CLI \(`codex`\) is not installed or not on PATH/);
  // the panel lists the providers separately
  const bridge = await readFile(new URL('../src/agents/bridge.js', import.meta.url), 'utf8');
  assert.match(bridge, /const providers = \[\{ id: 'codex'[\s\S]{0,400}\}\];\s*if \(project\.claudeOn\) providers\.push\(\{ id: 'claude'/);
});

test('simulated Windows: the terminal is a new PowerShell window in the project folder; the folder is never in the command text', async () => {
  const command = 'claude "Run yallaflow brief, then wait for messages from the YallaFlow console." --mcp-config .yallaflow\\local\\agent\\claude-mcp.json';
  assert.deepEqual(await terminalCommand('D:\\My Work\\متجر', command, W), { file: 'powershell.exe', argv: ['-NoLogo', '-NoExit', '-Command', command] });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yf-term & more-'));
  const spawned = [];
  const fake = (file, argv, options) => { spawned.push({ file, argv, options }); const child = { once(event, fn) { if (event === 'spawn') queueMicrotask(fn); return child; }, unref() {} }; return child; };
  const opened = await openTerminal(dir, command, { platform: 'win32', spawnFn: fake });
  assert.equal(opened.terminal, 'powershell.exe');
  assert.equal(spawned[0].options.cwd, dir, 'the project folder is the working directory');
  assert.equal(spawned[0].options.shell, false);
  assert.equal(spawned[0].argv.join(' ').includes(dir), false);
  assert.equal(await terminalCommand('/x', 'c', { platform: 'freebsd', env: {} }), null, 'an unsupported system still falls back to copying the command');
});

test('simulated Windows: hook and launch commands use double quotes and forward slashes', { skip: !claudeIncluded() && 'the experimental Claude connection is not in this tree' }, async () => {
  const { hookSettings, launchCommand } = await import('../src/agents/claude-files.js');
  const node = 'C:\\Program Files\\nodejs\\node.exe';
  const hook = 'C:\\Users\\Mona Ali\\AppData\\Roaming\\npm\\node_modules\\yallaflow\\resources\\agents\\claude-hook.mjs';
  const settings = hookSettings(node, { platform: 'win32', hook });
  const command = settings.hooks.Stop[0].hooks[0].command;
  assert.equal(command, '"C:/Program Files/nodejs/node.exe" "C:/Users/Mona Ali/AppData/Roaming/npm/node_modules/yallaflow/resources/agents/claude-hook.mjs"');
  assert.equal(command.includes('\\'), false, 'no backslash for a shell to read as an escape');
  assert.equal(hookSettings(node, { platform: 'win32', hook: 'D:\\أدوات\\claude-hook.mjs' }).hooks.Stop[0].hooks[0].command, '"C:/Program Files/nodejs/node.exe" "D:/أدوات/claude-hook.mjs"');
  const root = 'D:\\My Work\\shop';
  const launch = launchCommand(root, `${root}\\.yallaflow\\local\\agent\\claude-mcp.json`, `${root}\\.yallaflow\\local\\agent\\claude-settings.json`, { platform: 'win32' });
  assert.equal(launch, 'claude "Run yallaflow brief, then wait for messages from the YallaFlow console." --mcp-config .yallaflow\\local\\agent\\claude-mcp.json --settings .yallaflow\\local\\agent\\claude-settings.json --dangerously-load-development-channels server:yallaflow');
  assert.equal(launch.includes(root), false, 'only relative, fixed file names');
  // POSIX output is unchanged
  assert.match(hookSettings('/usr/bin/node').hooks.Stop[0].hooks[0].command, /^'\/usr\/bin\/node' '\/.*claude-hook\.mjs'$/);
  assert.match(launchCommand('/p'), /^claude 'Run yallaflow brief, then wait for messages from the YallaFlow console\.' --mcp-config \.yallaflow\/local\/agent\/claude-mcp\.json /);
  const server = await readFile(new URL('../src/console/server.js', import.meta.url), 'utf8');
  assert.match(server, /binary && process\.platform !== 'win32' \? files\.command\.replace/, 'no machine path is placed in the Windows command text');
});

test('no shell anywhere in agent discovery and launch; an unreachable console is said in plain words', async () => {
  for (const file of ['detect.js', 'setup.js', 'acp.js', 'terminal.js', 'codex.js']) {
    const text = await readFile(new URL(`../src/agents/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /shell:\s*true|cmd\.exe|\/c['"]/, file);
  }
  const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
  assert.match(app, /The console is not reachable: no answer arrived\. Check that yallaflow console is still running in its terminal, then reload this page\./);
  assert.match(app, /code: 'OFFLINE', cause/);
  assert.equal((app.match(/await reach\(\(\) => fetch\(/g) ?? []).length, 2, 'both the read and the write path');
});
