// PF-0134: open a terminal window in a project folder running one command the console built
// (never a command from a request). The developer then answers the agent's own prompts there.
// No shell is used to start the terminal; the command runs in `sh -c` inside it.
import { spawn } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

// Linux terminal emulators, most specific first; each builds its own argv for (cwd, command).
const LINUX_TERMINALS = Object.freeze([
  { bin: 'gnome-terminal', args: (cwd, command) => [`--working-directory=${cwd}`, '--', 'sh', '-c', command] },
  { bin: 'konsole', args: (cwd, command) => ['--workdir', cwd, '-e', 'sh', '-c', command] },
  { bin: 'xfce4-terminal', args: (cwd, command) => ['--working-directory', cwd, '-x', 'sh', '-c', command] },
  { bin: 'kitty', args: (cwd, command) => ['--directory', cwd, 'sh', '-c', command] },
  { bin: 'alacritty', args: (cwd, command) => ['--working-directory', cwd, '-e', 'sh', '-c', command] },
  { bin: 'x-terminal-emulator', args: (cwd, command) => ['-e', 'sh', '-c', command] },
  { bin: 'xterm', args: (cwd, command) => ['-e', 'sh', '-c', command] }
]);

async function onPath(bin, env) {
  for (const dir of String(env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const file = path.join(dir, bin);
    try { await access(file, constants.X_OK); return file; } catch { /* next */ }
  }
  return null;
}

const appleString = (text) => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
export const shellQuote = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;

// Which terminal would be used, or null: { file, argv } for spawn.
export async function terminalCommand(cwd, command, { platform = process.platform, env = process.env } = {}) {
  if (platform === 'darwin') {
    const script = `tell application "Terminal" to do script ${appleString(`cd ${shellQuote(cwd)} && ${command}`)}`;
    return { file: 'osascript', argv: ['-e', script, '-e', 'tell application "Terminal" to activate'] };
  }
  if (platform !== 'linux') return null;
  for (const terminal of LINUX_TERMINALS) {
    const file = await onPath(terminal.bin, env);
    if (file) return { file, argv: terminal.args(cwd, command) };
  }
  return null;
}

export async function openTerminal(cwd, command, { platform = process.platform, env = process.env, spawnFn = spawn } = {}) {
  const info = await stat(cwd).catch(() => null);
  if (!info?.isDirectory()) throw Object.assign(new Error('The project folder is no longer there.'), { code: 'FOLDER_MISSING', status: 404 });
  const found = await terminalCommand(cwd, command, { platform, env });
  if (!found) throw Object.assign(new Error('No terminal app was found on this machine. Copy the command and run it in your terminal.'), { code: 'NO_TERMINAL', status: 501 });
  await new Promise((resolve, reject) => {
    let child;
    try { child = spawnFn(found.file, found.argv, { cwd, env, detached: true, stdio: 'ignore', shell: false }); } catch (error) { reject(error); return; }
    child.once('error', () => reject(Object.assign(new Error('The terminal could not be opened. Copy the command and run it in your terminal.'), { code: 'NO_TERMINAL', status: 501 })));
    child.once('spawn', () => { child.unref?.(); resolve(); });
  });
  return { opened: true, terminal: path.basename(found.file) };
}
