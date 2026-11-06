# PF-0026 — Workspace write lock, atomic writes and exclusive ID allocation

**Type:** feature
**Status:** INTAKE
**Scope:** bounded
**Parent:** PF-0024
**Read-only:** no

## Requirements

REQ-004

## Acceptance Criteria

AC-004

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

- **`src/utils/lock.js`** (new) is the exclusive-create lock at `.yallaflow/local/lock`, holding `{pid, host, startedAt, command}`.
  - It is re-entrant inside one process.
  - It waits with backoff up to 10 s; `YALLAFLOW_LOCK_TIMEOUT_MS` overrides the wait.
  - A stale lock (holder pid dead on this host) is removed automatically. A lock from another host is never removed.
  - `clearStaleLock` refuses a live holder.
- **`src/cli.js`**: `main()` now wraps `dispatch()` in the lock for every command that can write, meaning everything except `init`, `verify`, help/version and the read-only commands and actions. The `doctor` command gains `--clear-lock`.
- **`src/commands/verify.js`**: the verified command runs without the lock. ID allocation, the log, the ledger append and any checkpoint reopen run under it. The output order is unchanged.
- **`src/utils/fs.js`**: `writeTextAtomic` uses a unique temp name (pid plus random) and retries a refused rename (EPERM/EBUSY/EACCES).
- **`src/core/yaml.js`**: `writeYaml` is now atomic.
- **`src/commands/doctor.js`**: reports the lock (held, stale or unreadable) as a warning.
- **`src/core/ownership.js`**: declares `local/lock` with owner `runtime` (transient, never committed). There is no agent-contract change.
- **`test/workspace-lock.test.js`** (6 tests):
  - 12 parallel starts;
  - parallel question, checkpoint, advance and 3 verifications on each of 4 items;
  - stale-lock report and recovery;
  - `--clear-lock` stale versus live;
  - busy timeout with no write, and waiting for a live holder;
  - re-entrancy, and read commands not taking the lock.
- **Correction after the first full suite (V-006: 3 failures).** Acquiring the lock created `local/`, which broke the invariant "no local/ outside Shared Projects", even for refused commands. The lock now removes `local/` again when it is empty.
- **Second correction.** A contender could delete a lock that another process had just taken (a check-then-delete race; the first race demo showed 1 collision in 5 rounds). Stale removal now claims the lock by an atomic rename and deletes it only if it is still the stale holder; otherwise it gives the lock back.
- **Race demonstration, final.** 20 rounds of 16 parallel `start` commands. v1.1.0 had collisions in 20 of 20 rounds; with the lock, 0 of 20 (V-007).
- **Race demonstration:** the same 12 parallel `start` commands with v1.1.0 lost work items in 4 of 5 rounds. With the lock, 0 of 5.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result
