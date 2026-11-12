// PF-0134 (1.5.2): Connect opens Claude Code in a terminal in the project folder; the console
// builds the command (never the request) and starts the terminal without a shell.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openTerminal, shellQuote, terminalCommand } from '../src/agents/terminal.js';

const app = await readFile(new URL('../resources/console/app.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../src/console/server.js', import.meta.url), 'utf8');

async function fakeBin(names) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'yf-term-'));
  for (const name of names) { const file = path.join(dir, name); await writeFile(file, '#!/bin/sh\n'); await chmod(file, 0o755); }
  return dir;
}
const fakeSpawn = (calls, fail = false) => (file, argv, options) => {
  calls.push({ file, argv, options });
  const child = new EventEmitter();
  child.unref = () => {};
  setImmediate(() => child.emit(fail ? 'error' : 'spawn', new Error('ENOENT')));
  return child;
};

test('the first terminal app on PATH is used, in the project folder, without a shell', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'yf-proj-'));
  const bin = await fakeBin(['xterm', 'gnome-terminal']);
  const calls = [];
  const result = await openTerminal(project, "claude 'hi'", { platform: 'linux', env: { PATH: bin }, spawnFn: fakeSpawn(calls) });
  assert.deepEqual(result, { opened: true, terminal: 'gnome-terminal' });
  assert.deepEqual(calls[0].argv, [`--working-directory=${project}`, '--', 'sh', '-c', "claude 'hi'"]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.cwd, project);
  assert.equal(calls[0].options.detached, true);
});

test('no terminal, a failed start or a missing folder is reported so the copy fallback shows', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'yf-proj-'));
  await assert.rejects(openTerminal(project, 'x', { platform: 'linux', env: { PATH: await fakeBin([]) }, spawnFn: fakeSpawn([]) }), { code: 'NO_TERMINAL' });
  await assert.rejects(openTerminal(project, 'x', { platform: 'linux', env: { PATH: await fakeBin(['xterm']) }, spawnFn: fakeSpawn([], true) }), { code: 'NO_TERMINAL' });
  await assert.rejects(openTerminal(path.join(project, 'gone'), 'x', { platform: 'linux', env: { PATH: '' } }), { code: 'FOLDER_MISSING' });
  assert.equal(await terminalCommand(project, 'x', { platform: 'win32', env: {} }), null);
});

test('macOS uses Terminal through osascript with the folder and command quoted', async () => {
  const found = await terminalCommand("/Users/me/it's here", 'claude "go"', { platform: 'darwin', env: {} });
  assert.equal(found.file, 'osascript');
  assert.match(found.argv[1], /^tell application "Terminal" to do script "cd '\/Users\/me\/it'\\\\''s here' && claude \\"go\\""$/);
  assert.equal(shellQuote("a'b"), `'a'\\''b'`);
});

test('the server builds the command itself and needs Claude Code on for the project', () => {
  const route = server.slice(server.indexOf("if (rest[1] === 'open-terminal') {"), server.indexOf("if (rest[1] === 'launch-files') {"));
  assert.match(route, /Object\.keys\(body\)\.length\) return send\(response, 400/, 'the request carries no command');
  assert.match(route, /if \(!bridge\?\.claudeOnFor\(project\.id\)\) return send\(response, 409/);
  assert.match(route, /writeClaudeLaunchFiles\(project\.root\)/);
  assert.match(server, /agents\\\/\(\?:settings\|launch-files\|approval-wait\|open-terminal\)/);
});

test('the chat opens on the chosen agent, keeps the warning to one line and connects through a terminal', () => {
  assert.match(app, /const listed = chosenHere && provider\(chosenHere\) && !agentProvider \? agent\.providers\.filter\(\(x\) => x\.id === chosenHere\) : agent\.providers;/);
  assert.match(app, /data-agent-choose="\$\{other\}">\$\{A\(`استخدم \$\{PROVIDER\[other\]\} بداله`, `Use \$\{PROVIDER\[other\]\} instead`\)\}/);
  assert.match(app, /<details class="awarn small awarn-compact" role="note"><summary>⚠/);
  assert.match(app, /agentAction\('connect', \{ provider: 'claude', workId \}, openClaudeTerminal\)/);
  assert.match(app, /post\(`\/api\/p\/\$\{pid\}\/agents\/open-terminal`, '\{\}'/);
  assert.match(app, /Claude Code opened in a terminal in the project folder\. Accept its development-channel prompt there/);
  assert.match(app, /return out\.filter\(\(x, i\) => !\(x\.session && out\[i \+ 1\]\?\.session\)\)\.slice\(-80\);/);
});
