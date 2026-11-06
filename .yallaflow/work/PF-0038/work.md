# PF-0038 — Agent Workspace v1.3.0 final stabilization: Codex process lifecycle, symlink race mitigation, cross-process one-session lock, session-scoped allow verification, delivery docs

## Raw Request

Agent Workspace v1.3.0 final stabilization: Codex process lifecycle, symlink race mitigation, cross-process one-session lock, session-scoped allow verification, delivery docs

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** change
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow change --scope architectural`.
**Timestamp:** 2026-11-06T18:41:33.819Z
**Workflow:** change
**Required capabilities:** discover, clarify, brainstorm, plan, implement, verify, converge, review
**Behavior contract:** registry v9
**Skills:** context-discovery, requirement-clarification, design-exploration, implementation-planning, implementation, verification, delivery-convergence, code-review
**Read-only:** no

## Intake

## Known Facts

## Open Questions

## Requirement

## Business Rules

## Acceptance Criteria

## Discovery

Observed against the real adapter (codex-acp 2.5.0 + codex 0.164.0, `initialize` only, no session or prompt):
- Process tree: node codex-acp → `codex app-server`, same process group as the console.
- SIGTERM and SIGKILL of the adapter both end `codex app-server` (it exits on stdin EOF).
- With the adapter in its own process group, killing the parent console (SIGKILL) still ends adapter and app-server (stdin EOF). A separate group therefore does not create orphans on a console crash.
- Not observable without a real turn: commands Codex runs during a turn. Those are the orphan risk (a long-running or detached command).

Codex permission options in codex-acp 2.5.0 (read from its dist): several options share kind `allow_always`, some session-scoped (`allow_for_session`, `allow_permissions_session`, MCP `allow_session`) and some persistent (`accept_execpolicy_amendment` = "don't ask again for commands that start with …", network `apply_network_policy_amendment:N` = "allow this host in the future", MCP `allow_always` = "Always allow"). YallaFlow picked the first `allow_always` by kind; when no session option is offered that is a persistent rule. Deny could fall to `reject_always` ("block this host in the future").

Cross-process: the slot is in-memory per server; a second console on the same checkout could start a second session and would overwrite agent-bridge.json (Claude). src/utils/lock.js already has process-identity liveness (boot id, start time) usable for a long-held lock.

Symlink threat model: the realistic racer is the supervised agent itself (workspace-write can create links inside the checkout but not write outside it); a race on an intermediate directory could redirect a console write outside the checkout. Linux offers fd-anchored paths (/proc/self/fd/N) for race-free resolution; macOS/Windows do not from Node.

## Specification / Expected Behavior

- Codex adapter spawned in its own process group (POSIX). End/crash/shutdown: TERM the group, KILL after grace, then verify the group and the snapshot of known descendants (Linux /proc) are gone. Survivors → `cleanup: {complete:false, survivors:[pids]}` on session.ended, a warning in the panel, and a line in the console's terminal on shutdown. Windows: adapter kill only, cleanup reported as unverified.
- Linux: local writes walk root → segments with O_DIRECTORY|O_NOFOLLOW handles and write/rename through /proc/self/fd/N. Elsewhere: existing lstat checks. Limitation documented honestly.
- Per-checkout agent lock `.yallaflow/local/agent-console.lock` (process identity as in lock.js) taken by an agent-enabled console; a live holder elsewhere makes start/resume/connect/stream return 409 CHECKOUT_LOCKED naming the holder; retried lazily; stale holders reclaimed; Claude bridge file written only by the holder.
- Allow for session → only session-scoped option ids; never persistent ones; deny → reject_once or cancelled; button offered only when a session-scoped option exists.

## Implementation Plan

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0025
**Type:** file
**Name:** owner-stabilization-request.md

Raw source preserved in: `.yallaflow/sources/SRC-0025/owner-stabilization-request.md`. Read it directly; it is not duplicated here.
