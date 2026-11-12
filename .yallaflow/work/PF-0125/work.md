# PF-0125 — Security: yallaflow init (and agent setup/refresh) must never follow symlinks in managed bootstrap files and modify files outside the project

## Raw Request

Security: yallaflow init (and agent setup/refresh) must never follow symlinks in managed bootstrap files and modify files outside the project

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** bug
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow bug --scope architectural`.
**Timestamp:** 2026-11-11T11:29:33.380Z
**Workflow:** bug
**Required capabilities:** discover, systematic-debugging, plan, implement, verify, review
**Behavior contract:** registry v9
**Skills:** context-discovery, systematic-debugging, implementation-planning, implementation, verification, code-review
**Read-only:** no

## Intake

## Known Facts

## Open Questions

## Reproduction

In a scratch folder (no real project): `CLAUDE.md -> ../outside/bashrc` → `yallaflow init` appended the bootstrap block to `outside/bashrc`. Dangling `AGENTS.md -> ../outside/autostart.desktop` → init created `outside/autostart.desktop`. `.yallaflow` as a dangling link → init failed with `ENOTDIR` (no outside write, unclear message).

## Evidence

## Hypothesis

## Root Cause

`inspectBootstrap` (exists → access, readText → readFile), `setupBootstrap` (writeText → writeFile) and the init rollback (`snapshotBootstrapFiles`/`restoreBootstrapFiles`, readFile/writeFile) all follow symbolic links, and nothing checks where a link leads. Callers: `yallaflow init` (installAllBootstraps), `yallaflow agent setup`, `yallaflow agent refresh`, the console connect (through init).

## Discovery

## Specification / Expected Behavior

Managed files: the agent bootstrap files at the project root (`CLAUDE.md`, `AGENTS.md`, every entry of `BOOTSTRAP_PROVIDERS`) and, for `init`, the `.yallaflow` workspace directory itself.

1. A bootstrap file may be read or written only when it is absent, a regular file, or a symbolic link whose fully resolved target (realpath, through any number of links and linked directories) is an existing **regular file inside the project root** — this keeps the supported setup `CLAUDE.md -> AGENTS.md` (state `shared`) and links to files inside the project.
2. Anything else is a new unsafe state `unsafe-link`: a link (or chain) leaving the project root, a dangling link (creating its target would follow it), or a link to something that is not a regular file. It joins the existing unsafe states (`modified`, `newer`, `broken`), so:
   - `yallaflow init` refuses **before writing anything** ("No files were changed"), exactly as for a hand-edited block today;
   - `yallaflow agent setup` and `agent refresh` refuse that file; `doctor`/`brief`/status describe it with the fix ("replace the link with a regular file");
   - the console connect preview reports it (its own check is replaced by this one).
3. `.yallaflow` that already exists as a symbolic link (dangling or not) makes `init` refuse with a clear message, writing nothing.
4. Writes never follow a link: the resolved real path is re-checked (lstat: not a link, still inside the root) just before writing, and the content is written through a temporary file in the same directory plus rename (the existing `writeTextAtomic` pattern), so a link swapped in after the check is replaced, not followed. The init rollback restores only the exact real paths it recorded, with the same check.
5. Unchanged: regular files, absent files, the shared `CLAUDE.md -> AGENTS.md` setup, links to files inside the project, all CLI output and JSON shapes except the new refusal reason, and file permissions of rewritten files.

Out of scope: Windows link semantics (Windows is unsupported); protection against another process running as the same user that rewrites files directly (not a boundary YallaFlow can enforce; documented in local-files.js).

## Implementation Plan

1. `src/agent/bootstrap.js`: a `resolveManagedFile(root, file)` helper (lstat → realpath chain → inside-root + regular-file checks) returning `{ path, realPath, link, safe, reason }`; `inspectBootstrap` uses it (no implicit following) and reports `unsafe-link`; `UNSAFE_BOOTSTRAP_STATES` + `describeBootstrapState` gain it; `setupBootstrap` writes with a no-follow atomic write at the resolved real path after a re-check; snapshot/restore record and restore real paths with the same check; `bootstrapInitPlan` reuses the state (the console-only check is removed).
2. `src/core/workspace.js` `initWorkspace`: refuse when `.yallaflow` is a symbolic link (lstat), before any write.
3. Tests (`test/agent-bootstrap-security.test.js`): the three reproductions (outside link, dangling link, `.yallaflow` link) through the real CLI with byte-for-byte checks that nothing outside changed and nothing inside was written; a link chain through a linked directory; a link to a directory/fifo; `agent setup` and `agent refresh` refusals; doctor/status description; the shared `CLAUDE.md -> AGENTS.md` and an inside link still work; a regular file keeps its permissions; the rollback never writes through a link swapped in after the snapshot; the console connect reports the same state.
4. Full `npm run check`, then a separate local commit.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0067
**Type:** file
**Name:** owner-1.5.2-closeout.md

Raw source preserved in: `.yallaflow/sources/SRC-0067/owner-1.5.2-closeout.md`. Read it directly; it is not duplicated here.
