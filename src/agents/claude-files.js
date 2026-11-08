// Local launch files for connecting a user-started Claude Code session to YallaFlow
// (v1.3.0, experimental). Written under .yallaflow/local/agent/ (git-ignored), so the
// user's repository files (.mcp.json, .claude/) are never changed. Claude Code is
// launched by the user, never by YallaFlow.
import { fileURLToPath } from 'node:url';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureLocalIgnored } from './bridge.js';
import { safeLocalDir, safeWriteFile } from './local-files.js';

const CHANNEL = fileURLToPath(new URL('../../resources/agents/claude-channel.mjs', import.meta.url));
const HOOK = fileURLToPath(new URL('../../resources/agents/claude-hook.mjs', import.meta.url));
export const CHANNEL_SERVER_NAME = 'yallaflow';
// Fixed text from YallaFlow; it carries no project data.
export const FIRST_PROMPT = 'Run yallaflow brief, then wait for messages from the YallaFlow console.';

// POSIX single-quote a path for a hook command line.
const quote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

export function hookSettings(nodePath = process.execPath) {
  const command = `${quote(nodePath)} ${quote(HOOK)}`;
  const entry = (matcher) => [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout: 5 }] }];
  return {
    hooks: {
      SessionStart: entry(),
      UserPromptSubmit: entry(),
      PreToolUse: entry('*'),
      PostToolUse: entry('*'),
      Notification: entry('*'),
      Stop: entry()
    }
  };
}

// Exactly what the launch files hold, so the Setup checklist can tell YallaFlow's own files
// from planted ones (security review, PF-0069).
export function launchFileContents(nodePath = process.execPath) {
  return {
    'claude-mcp.json': JSON.stringify({ mcpServers: { [CHANNEL_SERVER_NAME]: { command: nodePath, args: [CHANNEL] } } }, null, 1),
    'claude-settings.json': JSON.stringify(hookSettings(nodePath), null, 1)
  };
}

export async function launchFilesCurrent(root, nodePath = process.execPath) {
  const dir = path.join(root, '.yallaflow', 'local', 'agent');
  for (const [name, expected] of Object.entries(launchFileContents(nodePath))) {
    try {
      const info = await lstat(path.join(dir, name));
      if (!info.isFile() || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) return false;
      if ((await readFile(path.join(dir, name), 'utf8')) !== expected) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function writeClaudeLaunchFiles(root, nodePath = process.execPath) {
  await ensureLocalIgnored(root);
  const dir = await safeLocalDir(root, '.yallaflow', 'local', 'agent');
  const contents = launchFileContents(nodePath);
  const mcpFile = await safeWriteFile(dir, 'claude-mcp.json', contents['claude-mcp.json']);
  const settingsFile = await safeWriteFile(dir, 'claude-settings.json', contents['claude-settings.json']);
  return { mcpFile, settingsFile, command: launchCommand(root, mcpFile, settingsFile) };
}

// During the research preview a non-allowlisted channel needs the development flag;
// Claude Code shows its own warning, which the user decides on. The first prompt comes
// first (--mcp-config takes several values): it makes Claude Code report its permission
// mode at once, since SessionStart hooks carry none (PF-0069), and orients the agent.
export function launchCommand(root, mcpFile = path.join(root, '.yallaflow', 'local', 'agent', 'claude-mcp.json'), settingsFile = path.join(root, '.yallaflow', 'local', 'agent', 'claude-settings.json')) {
  const rel = (file) => path.relative(root, file);
  return `claude ${quote(FIRST_PROMPT)} --mcp-config ${rel(mcpFile)} --settings ${rel(settingsFile)} --dangerously-load-development-channels server:${CHANNEL_SERVER_NAME}`;
}
