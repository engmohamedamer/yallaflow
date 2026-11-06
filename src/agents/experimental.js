// The experimental Claude Code connection (v1.3.0) is not part of published releases:
// Anthropic has not confirmed that a third-party tool may distribute it. Its files live only
// in development builds. Shared code loads them on demand and refuses clearly when they are
// absent, so a release can never connect to Claude Code.
import { existsSync } from 'node:fs';

const FILES = ['./claude.js', './claude-files.js', './claude-detect.js', '../../resources/agents/claude-channel.mjs', '../../resources/agents/claude-hook.mjs'];

export const CLAUDE_NOT_INCLUDED = 'The experimental Claude Code connection is not included in this release of YallaFlow. Codex is the supported agent provider.';

export function claudeIncluded() {
  return FILES.every((file) => existsSync(new URL(file, import.meta.url)));
}

export async function loadClaude() {
  if (!claudeIncluded()) throw Object.assign(new Error(CLAUDE_NOT_INCLUDED), { status: 409, code: 'CLAUDE_NOT_INCLUDED' });
  const [link, files, detect] = await Promise.all([import('./claude.js'), import('./claude-files.js'), import('./claude-detect.js')]);
  return { ClaudeLink: link.ClaudeLink, writeClaudeLaunchFiles: files.writeClaudeLaunchFiles, detectClaude: detect.detectClaude };
}
