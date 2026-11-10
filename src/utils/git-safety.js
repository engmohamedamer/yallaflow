// PF-0112 review (re-verification, 2026-11-10): the settings every Git command YallaFlow starts
// outside src/execution/git-ops.js carries. A checkout's own configuration can name programs Git
// runs during ordinary reads (an fsmonitor command, hooks), and `git status` / `git diff` recurse
// into submodules, where a nested repository's own configuration (filters, fsmonitor) applies.
// Every status and diff that reads a work tree also passes --ignore-submodules=all on its command
// line: a .gitmodules entry (submodule.<n>.ignore) can override the config default, not the flag.
// In a lane, an agent can write both. With these, YallaFlow's reads run none of them.
export const SAFE_GIT = Object.freeze(['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'diff.ignoreSubmodules=all']);
