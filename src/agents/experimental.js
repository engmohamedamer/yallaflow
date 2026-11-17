// The experimental Claude Code connection (v1.3.0) is kept in its own files and loaded on
// demand. Shared code refuses clearly when they are absent, so a build that leaves them out
// can never connect to Claude Code. The package currently lists these files (see
// `npm pack --dry-run`); whether a release ships them is the owner's decision, and the
// connection stays experimental, off until the developer chooses it for a project.
import { existsSync } from 'node:fs';

const FILES = ['./claude.js', './claude-files.js', './claude-detect.js', '../../resources/agents/claude-channel.mjs', '../../resources/agents/claude-hook.mjs'];

export const CLAUDE_NOT_INCLUDED = 'The experimental Claude Code connection is not included in this release of YallaFlow. Codex is the supported agent provider.';

export function claudeIncluded() {
  return FILES.every((file) => existsSync(new URL(file, import.meta.url)));
}

export async function loadClaude() {
  if (!claudeIncluded()) throw Object.assign(new Error(CLAUDE_NOT_INCLUDED), { status: 409, code: 'CLAUDE_NOT_INCLUDED' });
  const [link, files, detect] = await Promise.all([import('./claude.js'), import('./claude-files.js'), import('./claude-detect.js')]);
  return { ClaudeLink: link.ClaudeLink, writeClaudeLaunchFiles: files.writeClaudeLaunchFiles, launchFilesCurrent: files.launchFilesCurrent, launchCommand: files.launchCommand, detectClaude: detect.detectClaude };
}
