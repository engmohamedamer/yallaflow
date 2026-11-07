// Local launch files for connecting a user-started Claude Code session to YallaFlow
// (v1.3.0, experimental). Written under .yallaflow/local/agent/ (git-ignored), so the
// user's repository files (.mcp.json, .claude/) are never changed. Claude Code is
// launched by the user, never by YallaFlow.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureLocalIgnored } from './bridge.js';
import { safeLocalDir, safeWriteFile } from './local-files.js';

const CHANNEL = fileURLToPath(new URL('../../resources/agents/claude-channel.mjs', import.meta.url));
const HOOK = fileURLToPath(new URL('../../resources/agents/claude-hook.mjs', import.meta.url));
export const CHANNEL_SERVER_NAME = 'yallaflow';

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

export async function writeClaudeLaunchFiles(root, nodePath = process.execPath) {
  await ensureLocalIgnored(root);
  const dir = await safeLocalDir(root, '.yallaflow', 'local', 'agent');
  const mcpFile = await safeWriteFile(dir, 'claude-mcp.json', JSON.stringify({ mcpServers: { [CHANNEL_SERVER_NAME]: { command: nodePath, args: [CHANNEL] } } }, null, 1));
  const settingsFile = await safeWriteFile(dir, 'claude-settings.json', JSON.stringify(hookSettings(nodePath), null, 1));
  const rel = (file) => path.relative(root, file);
  return {
    mcpFile,
    settingsFile,
    // During the research preview a non-allowlisted channel needs the development flag;
    // Claude Code shows its own warning, which the user decides on.
    command: `claude --mcp-config ${rel(mcpFile)} --settings ${rel(settingsFile)} --dangerously-load-development-channels server:${CHANNEL_SERVER_NAME}`
  };
}
