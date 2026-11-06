# PF-0030 — Stabilize Flow Console phases A-C after owner review: independent diff review, lock stress (stale locks, crashes, PID reuse, concurrency, shared projects), station and completion accuracy against workflows and gates, local server security, read-only and CLI-compatibility confirmation; fix findings

## Raw Request

Stabilize Flow Console phases A-C after owner review: independent diff review, lock stress (stale locks, crashes, PID reuse, concurrency, shared projects), station and completion accuracy against workflows and gates, local server security, read-only and CLI-compatibility confirmation; fix findings

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** change
**Scope:** bounded
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow change --scope bounded`.
**Timestamp:** 2026-11-05T23:14:55.815Z
**Workflow:** change
**Required capabilities:** discover, clarify, plan, implement, verify
**Behavior contract:** registry v9
**Skills:** context-discovery, requirement-clarification, implementation-planning, implementation, verification
**Read-only:** no

## Intake

## Known Facts

## Open Questions

## Requirement

## Business Rules

## Acceptance Criteria

## Discovery

## Specification / Expected Behavior

## Implementation Plan

## Findings and fixes

The findings come from runtime lock experiments and from an independent review of the A–C diff on an isolated copy. Each was verified before it was fixed.

| # | Finding (severity) | Fix |
|---|---|---|
| H1 | Completion could reach 100% with every station "done" on work that is not DONE: checkpoint flags were trusted, and stale convergence, a run older than the last reopen, reopened checkpoints and failed runs were ignored. | `buildStations` takes evidence (`freshRun`, `converged`). Verify and Remember finish only when proven. A checkpoint reopened behind the stage brings its station back. A decomposed parent's Change station shows its children. Anything not DONE is capped at 99%. Work that is finished but not closed sits at Remember, never back at New. |
| H2a | A crash between creating and writing the lock left an empty lock that blocked every writer (reproduced with real `kill -9`). | The lock is written to a temp file and then `link()`ed into place, so it is never empty. An unreadable lock counts as stale after 30 s. Leftover temp files are swept. |
| H2b | A reused pid blocked writers forever, and `doctor --clear-lock` refused to clear it (reproduced). | The lock records the Linux boot id and the process start time. A lock taken before the last boot is stale on any platform. A zombie holder counts as gone. `--clear-lock` removes a lock older than 1 h whose holder cannot be identified. A positively identified live holder is never removed. |
| M1 | `verify` lost a finished run and its output when the workspace was busy. | The output is printed first, and recording waits up to 5 minutes. |
| M2 | Stale-lock claim races, and `release` deleted locks it didn't own. | A nonce per acquisition. Release and stale removal act only on the exact lock they judged. When putting a lock back without hard-link support, rename is the fallback. |
| M3 | Path traversal through `representation.path` (console text endpoint and `source show --content`). | `loadSourceText` confines the path to the source's own directory (lexical check plus realpath check). |
| L | HEAD on `/api/events` hung. | It returns 405. |
| L | `--dry-run` took the lock. | Dry runs do not lock. |
| L | Atomic writes reset file permissions. | The temp file gets the replaced file's mode. |
| L | The "new work" command allowed shell expansion of the title. | POSIX single quoting. |

**Accepted residuals, documented:**
- `intake ticket --fetch` holds the lock for the whole network fetch. This affects availability only.
- A crash leaves `*.tmp` files beside state files. They are never read.
- A lock left by a crash in a non-shared project is visible to `git status` until the next command removes it.
- An extremely narrow takeover window remains when three contenders race on a stale lock. The nonce check bounds its effect.
- `help` text gained the new commands. This is additive.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result
