# PF-0024 — Flow Console: Core --json read contract, concurrency lock, and local web console (phased)

## Raw Request

Build the YallaFlow Flow Console: a local web console (Flow v4 design, research/next-gen-console) on top of a versioned Core --json read contract, delivered in phases: Core read contract and concurrency lock first, then read-only Console, then attested actions, new work, and the multi-agent team view

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** feature
**Scope:** architectural
**Confidence:** high
**Reason:** New public machine-readable output contract (--json, SemVer-governed), a new concurrency lock touching every mutating command, a new optional package with a local HTTP server and security boundary, and later additive attestation fields in committed ledgers (irreversible). Cross-module and public-API impact warrant architectural depth with specification and plan review.
**Timestamp:** 2026-11-05T21:37:52.118Z
**Workflow:** feature
**Required capabilities:** discover, clarify, brainstorm, specify, plan, implement, verify, converge, review
**Behavior contract:** registry v9
**Skills:** context-discovery, requirement-clarification, design-exploration, specification, implementation-planning, implementation, verification, delivery-convergence, code-review
**Read-only:** no

## Intake

## Known Facts

## Open Questions

Structured material questions are authoritative in `questions.yaml`.

## Confirmed Decisions

The owner confirmed these in the agent session on 2026-11-05. They are recorded as Q-001 to Q-004.

- **Q-001.** The Console ships inside the `yallaflow` package as `yallaflow console`. It always runs the same version as the CLI and adds no new dependency.
- **Q-002.** The UI is plain JavaScript, CSS and HTML, reusing the approved Flow v4 prototype. There is no build step and no framework.
- **Q-003.** The first release is the Core `--json` read contract, the write lock and a read-only Console. Actions come in a later phase.
- **Q-005 (revises Q-003, owner 2026-11-06).** 1.2.0 adds one narrowly scoped, authenticated Create Work action (delivered by PF-0032). Every other Console mutation, approvals, agent execution and chat stay out of scope.
- **Q-004.** A later Console action is recorded as an additive attestation `{recordedVia: "console", claimedBy?, verified: false}`, with no default identity.

**Sources:**
- The Flow v4 design write-up (FLOW_V4.md).
- The decision summary.
- The target architecture.

All three are registered as sources of this work item.

## Discovery

Intent discovery against approved project memory (51 current facts), plus the research package written today in `research/next-gen-console/` (audit, architecture, UX, performance and security, roadmap, and the approved Flow v4 prototype).

**Repository evidence (confirmed):**
- There is no machine-readable output. `grep` for `--json` in `src/` finds nothing, and every command prints prose with `console.log` (`src/commands/*.js`).
- There is no write lock. No `O_EXCL`, lock file or `flock` exists in `src/`. Writes are read-modify-write (`research/next-gen-console/CURRENT_STATE_AUDIT.md` §1, item 2; `docs/limitations.md`).
- The derived views the Console needs already exist in Core: `evaluateAdvance(..., {mutate:false})` for blocker and next action, `buildBehaviorGuidance`, context freshness, and convergence status (`CURRENT_STATE_AUDIT.md` §4).
- There is no frontend and no HTTP server (CTX-0008). There are 4 runtime dependencies (CTX-0007). The runtime is Node >= 20.16 (CTX-0033). Tests use `node --test` (CTX-0035).
- Shared Project already isolates per-checkout state in `.yallaflow/local/` and uses branch-safe IDs, which is the basis for parallel agents in separate worktrees.

**Measured (research benchmarks):** `brief` takes 2.5 s and `status` 1.4 s at 200 work items; spawning the CLI costs about 150 ms.

**Owner-approved UX:** Flow v4 (`research/next-gen-console/flow-v4/`, `FLOW_V4.md`). It has 5 stations with a New gate and a Done line, a deterministic completion %, handoff/handback motion, a details panel with attachments, filters, a digest, notifications, a team view, insights and projects. The owner approved all of it in conversation on 2026-11-05 ("انا مبسوط حط خطه وابدا نفذ").

**Freeze check (2026-11-05):**
- HEAD is v1.1.0 plus two docs-only website commits.
- The package and the CLI are both at 1.1.0.
- `npm test` passed 766/766.
- The only uncommitted files are PF-0023's `.yallaflow` state and the untracked `research/`.

## Architecture / Technical Decisions

**Confirmed** (owner, Q-001 to Q-004):
- The Console is built into `yallaflow` as `yallaflow console`.
- The UI is plain JavaScript with no build step.
- The first release is read-only, together with the `--json` read contract and the write lock.
- A later action is recorded as an unverified attestation.

**Proposed** (agent design, following repository conventions; all are subject to the specification review):

1. **Data path.** The Console server reads data by spawning this package's own CLI entry (`process.execPath src/cli.js snapshot --json`).
   - It does not import Core in-process.
   - This keeps the server's event loop free of Core's synchronous git calls and of the domain `console.log` calls.
   - The version is identical by construction.
   - Spawning costs about 150 ms. Results are cached and refreshed only when the watcher reports a change.
2. **Stations are computed in Core.** `snapshot` maps each item's real stages and checkpoints to the five Flow stations and computes the completion %. The UI never derives rule-based state; the research review found that a UI derivation had drifted from Core.
   - The mapping is by skill capability:
     - discover and clarify → Understand;
     - brainstorm, specify and plan, plus the workflow's hypothesis, root-cause and plan stages → Decide;
     - implement → Change;
     - verify, converge and review → Verify;
     - knowledge review → Remember.
   - A station that does not apply (an investigation's Change) is reported as `na`.
3. **Live updates.**
   - A recursive `fs.watch` on `.yallaflow/` (Node ≥ 20.16 on Linux and macOS), with a 2 s mtime-poll fallback, debounced to 250 ms.
   - Changes reach the browser as Server-Sent Events, and the browser then re-fetches the snapshot.
4. **Write lock.**
   - An exclusive-create file at `.yallaflow/local/lock` holding `{pid, host, startedAt, command}`.
   - It is acquired in the CLI dispatcher for every mutating command, with retry and backoff up to 10 s, then fails with a clear message.
   - `verify` and `qc record` take the lock only around ID allocation and the ledger append, never while the user's command runs.
   - A lock is stale when its pid is dead on the same host. `doctor` reports it and `doctor --clear-lock` removes it.
   - Temp files get unique names (pid plus random), and structured state writes become atomic.
5. **Attachment preview.**
   - The server serves the preserved original of a source by its ID only (`/api/sources/SRC-####/original`).
   - It uses a content-type allowlist (images, PDF, plain text) with `Content-Disposition: inline`, `X-Content-Type-Options: nosniff` and a sandbox CSP.
   - Extracted text comes from Core's existing source loader.
6. **Team view.**
   - `git worktree list --porcelain`, then each worktree's `snapshot --json` and `git diff --name-only HEAD`, all read-only.
   - A conflict is the same path changed in two worktrees.
7. **Multiple projects.** A user-level registry at `~/.config/yallaflow/console.json` (mode 0600) lists workspace roots. It is never written inside a repository.

**Not applicable in this release:**
- answer, approve and new-work actions;
- starting or stopping agents (Agent Runtime);
- attestation fields.

## Design

The approved Flow v4 prototype (SRC-0014) is the UI design. Its screens are:
- **Flow map:** the New gate, 5 stations and the Done line, with the completion %, the bottleneck, filters and the digest.
- **Work lines.**
- **Item:** the station chain, the handoff/handback history and a details panel with 5 tabs. Attachments and handoff artifacts open in a drawer.
- **Team.**
- **Insights.**
- **Projects.**
- **Notifications.**

The production UI keeps the prototype's look, motion, RTL behaviour and accessibility rules. The changes:
- Simulated data is replaced by the snapshot and work-show contracts.
- Simulated live events are replaced by watcher events. A handoff animation plays when a station's status changes between two snapshots, and a handback when an item moves to an earlier station or a checkpoint is revised.
- Write actions are removed. Each action place shows the exact `yallaflow` command to run instead.
- The Readex Pro font (OFL) ships subset to woff2, with its licence.

## Specification

### Goal and Scope

Ship YallaFlow 1.2.0 with three parts:
1. A versioned read contract: `yallaflow snapshot --json` and `yallaflow work show <id> --json`.
2. A write lock that makes concurrent agents safe.
3. `yallaflow console`, a local, read-only web console implementing the approved Flow v4 design.

Out of scope:
- write actions;
- agent execution;
- remote or hosted access;
- attestation.

### Actors and Permissions

- **Developer (human).** Opens the Console on their own machine and reads everything about their workspaces.
- **Agents.** Keep using the CLI. The Console never issues mutating commands.
- **Anyone else on the network.** No access: the server binds to loopback only and requires a per-run token.

### Functional Requirements and Business Rules

These are recorded as REQ-001 to REQ-010 in `requirements.yaml`.

- **Completion %.** Each station is 20%. A finished or non-applicable station counts in full. The current station counts its finished steps plus half of the step in progress, divided by its steps. The project % is the mean over items. Core computes all of this.
- **"Waiting for you".** An item is waiting for a human exactly when Core's current blocker is a human gate, an open material question, a baseline approval or a demo scope approval.
- **Handback.** Shown when Core reports a checkpoint revision, a reopen, or a station regression.
- **Read-only, with one authorized exception.** No Console route changes `.yallaflow/`, the working tree or `.git/index`, except Create Work (Q-005, PF-0032): `POST` create and attach, which write only through Core `start`/`route`/`intake add`. Every other mutation is refused, and `--read-only` refuses Create Work too.

### Workflows and Lifecycle

1. Run `yallaflow console [--port N] [--no-open] [--project <dir>]...`.
2. The CLI starts the server, prints the URL with a one-time token and opens the browser.
3. The browser loads the snapshot and subscribes to events.
4. Agents' CLI writes trigger watcher events, then a re-fetch, then the animation.
5. Ctrl-C stops the server. There is no daemon.

### Data and Integrations

- **Snapshot schema `yallaflow.snapshot/1`:**
  - project: name, package version, understanding state, memory counts;
  - items[]: id, type, scope, title, status, stage, stations[5] {key, status, steps[{id, status, at?}]}, completion, waitingFor, blocker, nextAction, owner/agent if recorded, sourceCount, updatedAt;
  - generatedAt.
- **Work show schema `yallaflow.work/1`:**
  - request (raw text and title);
  - sources[] (id, name, kind, size, used-by references);
  - requirements[] and criteria[] with convergence state and evidence;
  - questions[];
  - checkpoints[] with summaries and timestamps;
  - verification runs (id, outcome, time);
  - revisions and reopens;
  - next action.
- Both carry a `schema` field and follow SemVer: fields are only ever added in a minor version.
- Git is read-only: `worktree list`, `diff --name-only` and `rev-parse`, with `--no-optional-locks`.

### Validation and Error Behavior

- An unknown work ID returns a JSON error `{error: {code, message}}` and exit code 1.
- If the lock times out, the command reports the holder's pid, the command and its age, and suggests `doctor`.
- If the Console cannot run the CLI or parse its output, the UI shows a visible error banner with the command that failed. It never shows stale data as fresh.

### Security and Privacy

- The server binds to 127.0.0.1 only.
- A random token is required, as a header or a one-time code exchanged for a session token held in `sessionStorage`.
- A Host allowlist returns 421, an Origin check returns 403, and a missing token returns 401.
- Only GET is accepted; anything else returns 405.
- Paths come from IDs only. Traversal and symlinks outside the workspace return 404.
- Headers: a strict CSP, `nosniff` and `no-referrer`. Nothing is loaded from external origins.
- Secrets stay redacted, because all data comes from Core's own redacted state.
- Nothing is sent over the network.

### UI / Screens

Flow v4 (SRC-0014):
- map, work, item with details and attachment drawer;
- team, insights, projects;
- notifications (in-page, plus optional browser notifications the user grants);
- the "since you were away" digest, based on a last-visit time kept in `localStorage`.

The UI is Arabic-first RTL, with English, light and dark modes, and respects `prefers-reduced-motion`. It works at 390 px with no horizontal page scroll.

### Acceptance Criteria

These are recorded as AC-001 to AC-012 in `requirements.yaml`.

### Unresolved Items

None that block the specification. The release version (1.2.0) and its publication remain the owner's decision at release time.

## Implementation Plan

Draft, to be finalized at the planning checkpoint after the specification is approved. The work is delivered as four child work items (`yallaflow decompose`), each verified and finished on its own, followed by release preparation.

| # | Child | Delivers | Criteria |
|---|---|---|---|
| A | Core read contract | `src/flow/stations.js` (stations and %), `snapshot` and `work show` commands with `--json`, JSON Schemas in `resources/schemas/`, fixtures, read-only contract test | AC-001, AC-002, AC-003 |
| B | Write lock | `src/utils/lock.js`, lock in the dispatcher for mutating commands, atomic writes with unique temp names, exclusive ID allocation, `doctor` lock report and `--clear-lock`, stress test | AC-004 |
| C | Console core | `yallaflow console`, `src/console/server.js` (node:http, token, Host/Origin, GET only, CSP), CLI runner with cache, watcher and SSE, `resources/console/` UI (Flow v4: map, work, item, details, attachment drawer), security and no-mutation tests, browser smoke test | AC-005, AC-006, AC-007, AC-008, AC-012 |
| D | Console extras | team view (worktrees, changed files, conflicts), insights, projects registry, digest, notifications | AC-009, AC-010 |
| E | Release preparation | `docs/console.md`, `docs/cli.md` JSON section, CHANGELOG, version 1.2.0 prepared | AC-011 |

Order: A → B → C → D → E. B is independent and can run alongside C.

Rules for every child:
- Text output stays unchanged (golden tests).
- No new runtime dependency.
- Each child ends with `npm test` green and `yallaflow finish`.
- Nothing is committed, tagged, pushed or published without the owner's approval.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0014
**Type:** file
**Name:** FLOW_V4.md

Raw source preserved in: `.yallaflow/sources/SRC-0014/FLOW_V4.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0015
**Type:** file
**Name:** DECISION_SUMMARY.md

Raw source preserved in: `.yallaflow/sources/SRC-0015/DECISION_SUMMARY.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0016
**Type:** file
**Name:** TARGET_ARCHITECTURE.md

Raw source preserved in: `.yallaflow/sources/SRC-0016/TARGET_ARCHITECTURE.md`. Read it directly; it is not duplicated here.
