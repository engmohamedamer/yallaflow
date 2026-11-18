// PF-0173 (real Windows trial, W2): a tool installed while the console runs is found without
// restarting it. Windows behavior is exercised with a simulated reg.exe and simulated files on
// whatever machine runs the tests; it is not a real-Windows result.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expandWindowsVariables, freshToolEnvironment, knownWindowsLocations, mergeWindowsPath, parseRegQuery, readRegistryPath, toolEnvironment } from '../src/utils/fresh-path.js';
import { which } from '../src/agents/detect.js';
import { consoleOnPort, forgetConsole, recordConsole } from '../src/console/instances.js';
import { busyPortNotes } from '../src/commands/console.js';

const MACHINE = 'HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment\r\n    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;%SystemRoot%;C:\\Program Files\\nodejs\;C:\\Program Files\\Git\\cmd\r\n\r\n';
const USER = 'HKEY_CURRENT_USER\\Environment\r\n    Path    REG_SZ    C:\\Users\\u\\AppData\\Roaming\\npm;%NOPE%\\bin\r\n';
const STALE = { Path: 'C:\\WINDOWS\\system32;C:\\WINDOWS;C:\\Program Files\\nodejs\;C:\\Users\\u\\AppData\\Roaming\\npm', SystemRoot: 'C:\\WINDOWS', PATHEXT: '.COM;.EXE;.BAT;.CMD' };

test('reg query output: the Path value and its type', () => {
  assert.deepEqual(parseRegQuery(MACHINE), { type: 'REG_EXPAND_SZ', value: '%SystemRoot%\\system32;%SystemRoot%;C:\\Program Files\\nodejs\;C:\\Program Files\\Git\\cmd' });
  assert.deepEqual(parseRegQuery(USER), { type: 'REG_SZ', value: 'C:\\Users\\u\\AppData\\Roaming\\npm;%NOPE%\\bin' });
  assert.equal(parseRegQuery('ERROR: The system was unable to find the specified registry key or value.'), null);
  assert.equal(expandWindowsVariables('%SystemRoot%\\x;%NOPE%', { SYSTEMROOT: 'C:\\W' }), 'C:\\W\\x;%NOPE%');
});

test('merge: the current PATH stays first; only new absolute folders are added; unexpanded ones are skipped', () => {
  const merged = mergeWindowsPath(STALE.Path, ['C:\\WINDOWS\\system32\\', 'c:\\program files\\nodejs', 'C:\\Program Files\\Git\\cmd', '%NOPE%\\bin', 'relative\\bin', '"C:\\Quoted\\bin"']);
  assert.deepEqual(merged.added, ['C:\\Program Files\\Git\\cmd', 'C:\\Quoted\\bin']);
  assert.ok(merged.path.startsWith(STALE.Path));
});

test('Windows: Git installed after the console started is found from the registry Path, under the Path name the process uses', async () => {
  const calls = [];
  const run = (file, args, options, done) => { calls.push({ file, args, options }); done(null, args[1].startsWith('HKLM') ? MACHINE : USER); };
  const registry = await readRegistryPath(STALE, { run, maxAgeMs: 0 });
  assert.deepEqual(calls.map((call) => call.file), ['C:\\WINDOWS\\System32\\reg.exe', 'C:\\WINDOWS\\System32\\reg.exe'], 'reg.exe by its System32 path, never from PATH');
  assert.deepEqual(calls[0].args, ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', '/v', 'Path']);
  assert.equal(calls[0].options.shell, false);
  const fresh = await freshToolEnvironment(STALE, { platform: 'win32', readRegistry: async () => registry });
  assert.equal(fresh.refreshed, true);
  assert.deepEqual(fresh.added, ['C:\\Program Files\\Git\\cmd']);
  assert.equal(fresh.env.PATH, undefined, 'written under the existing name');
  const isFile = async (file) => file === 'C:\\Program Files\\Git\\cmd\\git.exe';
  assert.equal(await which('git', STALE, { platform: 'win32', isFile }), null, 'the stale PATH does not find it (the trial)');
  assert.equal(await which('git', fresh.env, { platform: 'win32', isFile }), 'C:\\Program Files\\Git\\cmd\\git.exe', 'the refreshed PATH does');
  assert.equal(STALE.Path.includes('Git'), false, 'the caller environment is not changed');
});

test('a registry that cannot be read leaves the environment as it was; Linux and macOS are unchanged', async () => {
  const same = await freshToolEnvironment(STALE, { platform: 'win32', readRegistry: async () => ({ machine: null, user: null }) });
  assert.equal(same.env, STALE);
  assert.equal(same.refreshed, false);
  const thrown = await freshToolEnvironment(STALE, { platform: 'win32', readRegistry: async () => { throw new Error('denied'); } });
  assert.equal(thrown.env, STALE);
  const env = { PATH: '/usr/bin' };
  assert.equal(await toolEnvironment(env, { platform: 'linux' }), env);
  assert.equal(await toolEnvironment(env, { platform: 'darwin' }), env);
});

test('known install folders are for a diagnostic only', () => {
  assert.deepEqual(knownWindowsLocations('git', { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }), ['C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Users\\u\\AppData\\Local\\Programs\\Git\\cmd\\git.exe']);
  assert.deepEqual(knownWindowsLocations('unknown-tool', {}), []);
});

test('a second console says an earlier console holds the usual port, instead of moving silently', async () => {
  const file = path.join(await mkdtemp(path.join(os.tmpdir(), 'yf-inst-')), 'console-instances.json');
  assert.equal(await consoleOnPort(4747, { file }), null);
  // An earlier console (another live pid) recorded 4747; a dead one recorded 4749.
  const { writeFile } = await import('node:fs/promises');
  await writeFile(file, JSON.stringify({ consoles: [{ pid: 4242, port: 4747 }, { pid: 99999999, port: 4749 }] }));
  const isAlive = (pid) => pid === 4242;
  assert.deepEqual(await consoleOnPort(4747, { file, isAlive }), { pid: 4242, port: 4747 });
  assert.equal(await consoleOnPort(4749, { file, isAlive }), null, 'a dead entry does not count');
  await recordConsole(4748, { file, isAlive });
  assert.equal((await consoleOnPort(4748, { file, isAlive: () => true })), null, 'its own entry is never reported to itself');
  await forgetConsole({ file, isAlive });
  const notes = busyPortNotes([{ port: 4747, console: true }, { port: 4748, console: false }], 'http://127.0.0.1:4749');
  assert.match(notes[0], /Another YallaFlow console is still running on port 4747.*PATH it was started with/);
  assert.match(notes[1], /Port 4748 is used by another program/);
  assert.deepEqual(busyPortNotes([], 'x'), []);
});
