# PF-0029 — Console docs, CHANGELOG and 1.2.0 release preparation (no publish)

**Type:** change
**Status:** INTAKE
**Scope:** bounded
**Parent:** PF-0024
**Read-only:** no

## Requirements

REQ-010

## Acceptance Criteria

AC-011

## Intake

## Known Facts

## Open Questions

## Requirement

## Business Rules

## Acceptance Criteria

## Discovery

## Specification / Expected Behavior

## Implementation Plan

## Implementation

**Docs:**
- New: `docs/console.md` and `docs/upgrading-to-v1.2.0.md`.
- Updated: `docs/cli.md` (new commands, JSON contract, lock), `docs/architecture.md` (read contract, stations, lock, console), `docs/limitations.md` (1.2: the console is read-only, lock edges, browser coverage), `docs/installation.md`, `docs/releasing.md` (network scan), README ("What's new in 1.2.0", upgrading, docs table), CHANGELOG `[1.2.0]` (not yet dated as released).

**Version:** 1.2.0 in `package.json`, `package-lock.json` and `src/version.js`. The version-pinning tests are updated. The domain versions are unchanged: Agent Contract v10, bootstrap v3, Registry v9, Knowledge Policy, schemas.

**Lock risks:**
- `intake ticket --fetch` fetches without the lock and locks only to write, re-checking the target work item.
- A lock directory created for the lock carries a `*` `.gitignore`, so a crash-left lock never shows in `git status`; it is removed with the lock.
- The default wait is now 60 s.

**Final independent review fixes:**
- A planted worktree `gitdir` is ignored unless the worktree points back. Git runs with `core.fsmonitor=false`.
- `verify` re-reads the work item under the lock and refuses to record a run on work that became DONE.
- Dry-run lock skip only for commands that define `--dry-run`.
- The Windows `start` arguments.
- `console remove` resolves the workspace root.
- `writeYamlAtomic` is an alias of `writeYaml`.
- Duplicate code and unused exports removed.

**User-journey fixes:**
- The convergence evidence in `work show` is normalized to `{type, ref, text}` (it was raw objects, so the UI showed no evidence).
- A new console link opened in the same tab adopts its token.
- A 401 stops the event-stream retries and asks for the link.
- The duplicated blocker line in the next-step card is removed.

**UI maintenance and accessibility:**
- Pruned 35 unused prototype CSS classes (45 KB to 38 KB).
- Contrast fixes to reach WCAG AA: muted text, nile-2, the done-chip ink, station counts, dark-mode active chip and filled icons.
- Decorative SVGs and tracks marked `aria-hidden`.

**Tests added:**
- fetch outside the lock;
- crash lock hidden from git;
- planted gitdir;
- verify on work turned DONE;
- convergence evidence refs.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result
