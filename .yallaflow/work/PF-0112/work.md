# PF-0112 — Unified Execution Modes: Run Now, Queue and Parallel (isolated Git worktrees) in one execution manager, agents dashboard and approvals inbox, on existing subscription agent integrations

## Raw Request

Unified Execution Modes: Run Now, Queue and Parallel (isolated Git worktrees) in one execution manager, agents dashboard and approvals inbox, on existing subscription agent integrations

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** feature
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow feature --scope architectural`.
**Timestamp:** 2026-11-09T17:52:58.285Z
**Workflow:** feature
**Required capabilities:** discover, clarify, brainstorm, specify, plan, implement, verify, converge, review
**Behavior contract:** registry v9
**Skills:** context-discovery, requirement-clarification, design-exploration, specification, implementation-planning, implementation, verification, delivery-convergence, code-review
**Read-only:** no

## Intake

Owner request for Checkpoint B (SRC registered on this item: `execution-modes-request.md`). Deliver three execution modes (Run Now, Queue, Parallel) in one feature release with one architecture and one UX, on the existing subscription agent integrations, preserving v1.4.2 behaviour and Git safety. This item covers architecture and planning first; implementation starts only after the specification and plan gates are approved (Checkpoint B), Git-permission changes need Checkpoint C, publishing needs Checkpoint D.

## Known Facts

Repository evidence (read 2026-11-09 on `feature/execution-modes` @ 3b34fa9, = v1.4.2 + release record):

- **One session per checkout.** `src/agents/bridge.js` keys everything by console project (= checkout root): `project.session` is a single slot taken synchronously in `reserve()` (bridge.js:444) and refused with `SESSION_ACTIVE` when busy (`assertFree`, bridge.js:430). Pending permissions, events (last 400) and the Claude link are per project entry.
- **Cross-process lock.** `src/agents/checkout-lock.js` holds `.yallaflow/local/agent-console.lock` (pid/host/boot id, stale reclaim) so only one console drives agents per checkout. A Git worktree is a different root → its own lock and slot. The PoC proved two lanes in one console (`SESSION_ACTIVE` refused a second session in the same checkout).
- **Session records & recovery.** `.yallaflow/local/agent-sessions/<12hex>.json` (+ `decisions.jsonl`); Codex sessions are `resumable` with `sessionId` and resume via `resumeCodex` (bridge.js:504). `stopFrom()` (bridge.js:22) classifies `usage_limit` with an optional `retryAt` text; `noteStop`/`finishCodex` persist `lastStop`.
- **Permissions.** `askPermission` (bridge.js:291) offers `allow` / `allow_session` (session-scoped only, `SESSION_SCOPED_OPTIONS` codex.js) / `deny`, auto-denies after `DEFAULT_PERMISSION_TIMEOUT_MS` = 5 min (overridable by `YALLAFLOW_AGENT_PERMISSION_TIMEOUT_MS`). Codex requests carry only `title` + the tool title (`codex.js` onRequest) — no file paths (PoC gap: "Editing files").
- **Subscription only.** `adapterEnvironment` strips `OPENAI_API_KEY`, `CODEX_API_KEY`, … ; a session starts only with a ChatGPT login; forbidden modes (`full-access|bypass|…`) are refused (`events.js` `isForbiddenMode`). Claude is `ownership: user-session`, `start:false` — the console cannot start Claude Code; it links to a user-started session via channel + hooks.
- **Console.** `src/console/server.js`: loopback only, per-run Bearer token, Origin checks, POST allowed only on `WRITE_ROUTE` / `AGENT_ROUTE` regexes. Project id = sha256(root)[0:10]. SSE `/api/events` broadcasts `change` (workspace watcher → runner cache invalidation) and `agent` events.
- **Reads go through the CLI.** `src/console/runner.js` spawns `yallaflow snapshot --json` / `work show --json`; `src/flow/snapshot.js` gives per item: `stage`, `state`, `waitingFor {kind:'review', gate}`, `blocker`, `nextAction`, lifecycle `held|closed`, `completedAt`. This is a mechanical completion signal (no agent-text parsing needed).
- **Worktrees today are read-only.** `src/console/worktrees.js` reads Git's admin files (no `git worktree` command), verifies the back-pointer, lists changed files with `--no-optional-locks status`, and the Worktrees page (`viewTeam`) shows lanes, active work, changed files and file overlaps; it states worktrees are not agent sessions.
- **Git safety contract.** Test 51 (`test/shared-project.test.js:701`) allows only `status, rev-parse, diff, ls-files, ls-tree, check-ignore, symbolic-ref, config, cat-file, merge-base` for `spawnSync('git', [...])` / `git(root, [...])` call shapes. `git init` exists only in `src/console/greenfield.js` (owner-approved PF-0057, explicit button, argv, no shell).
- **IDs.** `nextWorkId` (`src/core/workspace.js:144`): sequential `PF-####` in a single-user workspace; branch-safe `PF-<tag>-####` only when `config.shared.enabled` (Shared Project Mode). Active-work focus is tracked `state/current.yaml` single-user, git-ignored `local/state/current.yaml` when shared. **This repository is not a Shared Project.**
- **Shared memory merge.** Shared Project Mode stages knowledge as per-work memory deltas on feature branches; `yallaflow shared integrate` applies them on the integration branch; `shared check` / `finish` detect a fact changed in parallel (test at shared-project.test.js:690).
- **UI.** `resources/console/app.js` (3,171 lines, template strings, delegated click handler, `A(ar,en)` inline i18n). Single `agent` object per project (`GET /api/p/<pid>/agent`); `agentAttention`, `agentOnItem`, `switchHere`, `chatAction`, `goText`/`goOnText`, `permCard`, bell `needs()`; Worktrees page `viewTeam`; Projects page `viewProjects`. Dialog pattern: create-once `<dialog>` + `confirmed` checkbox.
- **Tests.** `test-support/fake-acp-agent.mjs` is a scriptable fake Codex ACP adapter used by `test/agent-bridge.test.js`; console HTTP tests exist (`console-server`, `console-agent-errors`, `console-project-chat`).

PoC evidence (disposable repo, 2026-11-09 15:21–15:27 UTC, ChatGPT Plus): two Codex sessions in two worktrees of a Shared Project from one console; independent approvals (A and B allowed/left pending independently); Git isolation pass; distinct branch-safe IDs `PF-6289MV5WHZ-0001` / `PF-JBD5MX0YAY-0001`; `shared check` PASS; `git merge-tree` clean on disjoint work and detected a deliberate conflict; resume after console restart worked. Gaps: no file paths on edit approvals, every command needs approval, 5-minute auto-deny, lanes appear as same-named projects, no all-agents view or inbox, nothing creates worktrees, agents do not commit.

## Open Questions

Structured material questions are authoritative in `questions.yaml`. Q-001…Q-007 (D1–D7) were answered by the owner on 2026-11-09 (SRC-0053) and resolved.

## Confirmed Decisions

- All three modes ship in the same feature release, **v1.5.0** (owner, 2026-11-09; Q-006). Lane + Run architecture approved (SRC-0053).
- Phases with checkpoints A (release 1.4.2 — done), B (this specification + plan gates), C (Git allowlist change, before M2 code), D (publishing).
- Agent sessions stay subscription-only (owner memory rule).
- **D1 / Q-001** Parallel requires Shared Project Mode, enabled only with explicit confirmation and migration safety checks.
- **D2 / Q-002** Conditionally approved: `worktree add -b` (hooks disabled), `worktree remove` (no `--force`), `merge-tree --write-tree --name-only`, only through one restricted, validated layer. No force, automatic merge, commit, push or destructive cleanup. Hook isolation and safe deletion must be verified. `worktree prune` and `branch -d` declined.
- **D3 / Q-003** Sibling `<repo>.lanes/<slug>` with strict path validation.
- **D4 / Q-004** No 30-minute default until Codex ACP timeout behaviour is verified; never auto-approve.
- **D5 / Q-005** Default 2 agents, maximum 4; above 2 is experimental until tested.
- **D7 / Q-007** The queue advances automatically only after verified DONE and a fully stopped session; any review, question, approval, failure or usage limit blocks progression.
- **D8 / Q-008** (SRC-0055, conditional) Revalidate everything if main moves after approval. A fresh explicit approval is required if any of these changes: the reviewed diff, the resulting tree, the merge commit, the verification scope, or the integration outcome. An approval is never silently extended to materially different content.
- **D9 / Q-009** (conditional) Hooks may be disabled for controlled YallaFlow operations, but the required equivalent checks must be identified and executed. Task tests are not assumed to replace hooks or CI. Merging is blocked when mandatory verification cannot be satisfied.
- **D10 / Q-010** (approved) A durable, team-visible integration record, with atomic and recoverable updates and safe Shared Project handling, that accurately reflects the final verified state.
- **D11 / Q-011** (approved) Review & Merge applies to parallel worktrees in v1.5.0. Run Now and Queue keep their existing Git behaviour.
- **D12 / Q-012** (modified) Worktrees are never deleted automatically and are retained by default. A separate, explicit Cleanup action is offered after MERGED & VERIFIED, behind all safety checks. Uncommitted or otherwise unpreserved data is never deleted.
- **D13 / Q-013** (approved with conditions) One merge commit per lane by default, preserving existing task history. No squash, rebase or history rewriting.
- **D14** (owner, 2026-11-10, SRC-0059) Agent Contract v12: it names `work/<id>/integration.yaml` as CLI-owned state, and test 54 is not weakened. Existing projects get a clear `agent refresh` requirement. User-customized instructions are preserved, or explicitly reviewed before replacement. This supersedes plan P6's "Agent Contract stays v11".
- **D15** (owner, 2026-11-10, SRC-0059) Approval wait is a project-level setting of 5, 15, 30 or 60 minutes, with 5 as the default. Expired requests are always denied, never approved, and existing projects keep today's behaviour. Evidence: the M0 experiment (codex-acp held an open request for 65 minutes; ending the session denied it cleanly).
- **M4 acceptance** (SRC-0059): green suite incl. test 54; console UX in EN/AR/mobile reviewed from a non-technical user's view; a real two-Codex end-to-end in disposable repos (Run Now, a three-task queue, two parallel agents with an intentional conflict: first merged, second returned to its agent, fresh review and approval, both changes present); no user data or knowledge lost; restart recovery without duplicate sessions or commits. Stop at Checkpoint D.
- Git transaction design validated against Git 2.43 documentation and YallaFlow code (SRC-0055). Every guarantee not yet proven by execution is listed as an open risk (R1–R10), not as proven behaviour.
- Additional owner requirements (SRC-0053): preserve v1.4.2 behaviour; lose no tasks, knowledge, uncommitted changes or evidence; interactive Agents view with centralized approvals and session controls; no duplicate execution from persistence/recovery; no worktree deletion while active, uncommitted, unmerged or otherwise unpreserved; explicit Claude Team limitations; negative tests for Git safety, concurrency and crash recovery.
- Requirements REQ-001…REQ-016 and acceptance criteria AC-001…AC-020 are recorded in `requirements.yaml` and are authoritative for convergence.
- **Scope revision (owner, 2026-11-09, SRC-0054).** The specification was returned with changes requested: **Review & Merge is part of v1.5.0**. The lifecycle becomes Start → Execute → Review → Approve → Merge → Verify, with minimal manual Git. YallaFlow may commit and merge, but only after an explicit approval of an exact plan, and only through the restricted layer. The architecture and D1–D7 stay approved. D2 originally excluded "automatic merge, commit"; it now reads: no *automatic* (unapproved) commit or merge, and still no force, push, reset, rebase, automatic conflict resolution or destructive cleanup. The Checkpoint C allowlist is re-proposed below for approval. New owner decisions D8–D13 are recorded as Q-008…Q-013. Requirements were revised with history (REQ-007, REQ-009, REQ-014 and their criteria) and REQ-017…REQ-024 / AC-021…AC-037 added.

## Discovery

Intent discovery against approved memory plus targeted reading of `src/agents/*`, `src/console/{server,worktrees,registry,runner}.js`, `src/shared/git.js`, `src/core/workspace.js`, `src/flow/snapshot.js`, test 51, and a UI map of `resources/console/app.js`. Findings are the Known Facts above. Limitations recorded on this item: only two concurrent Codex lanes tested; Claude lanes not exercised (Team login has channels off); non-Linux worktree behaviour not inspected; Codex ACP `locations`/`rawInput` presence to be confirmed.

Revision discovery (SRC-0054, impact IM-001):
- `yallaflow shared integrate` refuses to run off the integration branch (`src/shared/memory.js:290`), so knowledge integration must run in the home checkout after the fast-forward.
- `containsSecret` / `redactSecrets` (`src/security/redact.js`) can be reused to scan files before a commit and to redact test logs.
- Installed Git is 2.43.0. `merge-tree --write-tree` needs ≥ 2.38, and `--pathspec-from-file` / `--pathspec-file-nul` need ≥ 2.26, so v1.5.0 requires Git ≥ 2.38 for Review & Merge only.
- Git's documented behaviour, to be proven by the negative tests rather than assumed:
  - `merge --ff-only` refuses when a local change would be overwritten and keeps unrelated dirty and staged entries;
  - `commit --only <paths>` commits only those paths and leaves other staged entries staged (the second half is **not** in the manual; superseded by the SRC-0055 validation, Q2: `--only` is dropped);
  - `merge` aborts when the index has staged changes;
  - `worktree add` runs the `post-checkout` hook unless hooks are disabled.
- Per the owner's instruction, no commit, merge, reset, rebase, push or deletion was executed during this research, not even in a disposable repository.

## Architecture / Technical Decisions

**A1 — One model: Lanes, Runs, Tasks (proposed).** A *lane* is one checkout (the project's main checkout, or a worktree YallaFlow created) with at most one agent session — exactly today's rule, unchanged. A *task* is one work item to drive to DONE. A *run* is an ordered list of tasks in a lane. The three modes are shapes of the same model:

| Mode | Lanes | Tasks per lane | What is new |
|---|---|---|---|
| Run Now | main | 1 | nothing for the user; internally a 1-task run |
| Queue | main | N, sequential | scheduler advances on DONE |
| Parallel | main + K worktrees | 1..N each | lane creation, review, cleanup |

**A2 — Execution Manager sits above the AgentBridge (proposed).** New `src/execution/manager.js`, created by the console when agents are on. It never talks to providers; it calls existing bridge methods (`activate`, `startCodex`, `resumeCodex`, `message`, `end`, `cancel`, `status`) per lane, listens to the same bridge events and workspace `change` signals, and reads item state through the runner's `snapshot --json`. The bridge keeps all provider, permission, lock and mode rules. No duplicate session logic.

**A3 — Completion is read from YallaFlow state, never from agent text (proposed).** A task is done only when the snapshot shows its item at `DONE` (i.e. `yallaflow finish` succeeded). Review gates (`waitingFor.kind = 'review'`), open questions, permission requests, ended turns, usage limits, crashes and held/closed lifecycle map to explicit task states (see Workflows).

**A4 — Durable state is personal runtime state (proposed).** `.yallaflow/local/execution/` in the main checkout (git-ignored by the existing `ensureLocalIgnored`): `runs.json` (schema `yallaflow.execution/1`, atomic `safeWriteFile`), `events.jsonl` (append-only audit of scheduler decisions). Each worktree lane also gets `.yallaflow/local/execution/lane.json` (`createdBy: yallaflow`, home root, lane id) as its ownership marker. Nothing is written to tracked `.yallaflow` state, project memory, or `config.yaml`.

**A5 — Parallel requires Shared Project Mode (proposed; owner decision D1).** Without it, two lanes allocate the same `PF-####` and both write tracked `state/current.yaml`, so merging lanes conflicts on YallaFlow state. Shared Project Mode already gives branch-safe IDs, per-checkout local focus, staged memory deltas and `shared integrate`/`shared check` — the PoC used exactly this. The console offers the existing one-time `yallaflow shared enable` (maintainer action) when Parallel is first chosen; Run Now and Queue never require it.

**A6 — The only new mutating Git lives in one guarded module (proposed; Checkpoint C; revised by SRC-0054).** Originally `src/execution/git-worktree.js` with three subcommands. Revised: `src/execution/git-ops.js` is the single module allowed to run any non-read-only Git. It runs argv only with no shell, and always with `-c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.untrackedCache=false` plus env `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C` and a timeout. Paths go through NUL-separated pathspec files and object ids are validated hex, never `--force`. Each operation is a named function with a fixed argv shape (see the Checkpoint C allowlist). Test 51 allows the extra subcommands only in that file and asserts their shapes. YallaFlow still never pushes, pulls, fetches, rebases, resets, reverts, cherry-picks, stashes, cleans, checks out/switches, deletes branches, edits refs directly, or runs any three-way merge in a working tree.

**A7 — Integration (revised by SRC-0054).** Originally integration stayed with the developer. Revised: YallaFlow performs Review & Merge for lanes after the developer approves an exact, hash-bound plan (A10). The developer can still integrate by hand at any time; the console then recognises the merge through ancestry and offers verification and cleanup only. Knowledge integration reuses `shared integrate` / `shared check`.

**A10 — Merge without ever conflicting a working tree (proposed).**
- All three-way merging happens in Git's object database. `merge-tree --write-tree` computes the merged tree or the conflict list, and `commit-tree` creates the merge commit **M** with parents (target HEAD, lane commit).
- No working tree ever enters a half-merged state, because checkouts only ever **fast-forward** to M (`merge --ff-only <oid>`). The lane fast-forwards first, the integration tests run there on the exact tree of M, and only then does the home checkout fast-forward.
- The developer's checkout is touched only by a fast-forward to an already-tested commit. Git refuses that fast-forward if it would overwrite a local change, and pre-checks list such files before anything starts.
- Conflicts are never resolved by YallaFlow. The lane goes back to its agent: the item is reopened, and the agent integrates the target into the lane under its own approvals.

**A11 — Two separate states: Task DONE vs Changes MERGED & VERIFIED (proposed).**
- *Task DONE* is YallaFlow workflow state (finish succeeded).
- *Integration state* is separate: `not-ready → ready → approved → merging → merged → verified`, with side exits `blocked` and `failed`.
- The integration state is derived from the merge journal (local), Git ancestry (durable), and a durable per-work integration record (D10).
- Cards and the Agents view show both badges, for example "DONE · not merged" and "DONE · merged & verified".

**A8 — No Agent Contract change (proposed).** Lane instructions (stop at DONE, don't merge, which lane you are in) travel in the start message (`goText`), so the contract stays v11 and no `agent refresh` is needed.

**A9 — Codex is the automated provider; Claude lanes are assisted (proposed).** The console can start/resume/end Codex only (capability table). A Claude lane is prepared by the console (folder, launch files, next message) and driven by the developer's Claude Code session; on logins with channels off (Claude Team default) the next message is shown to copy. Claude never blocks a Codex lane.

## Design

Alternatives considered:

1. *Separate subsystems per mode* (a queue runner and a worktree orchestrator) — rejected: duplicate lifecycle, two UIs, contradicts "one coherent architecture".
2. *Multiple sessions per checkout* — rejected: breaks the one-active-work rule (`current.yaml`), the checkout lock and Git isolation; the PoC showed the lock is the right boundary.
3. *Agent-written completion signals* (parse "done" from text) — rejected: unreliable; YallaFlow state already proves DONE.
4. *Copy uncommitted work items into worktrees* — rejected: would hand-edit `.yallaflow` state. Parallel lanes take new requests (created inside the lane) or items already committed at the base commit.
5. *YallaFlow merges finished lanes* — originally rejected; **reversed by the owner (SRC-0054)**. Merge strategies compared for the approved scope:
   - a. `git merge --no-ff` in the developer's checkout — rejected: a conflict leaves the developer's working tree half-merged, and recovery would need `merge --abort`/`reset`.
   - b. Rebase or squash the lane onto the target — rejected: rewrites the lane's history, breaks the ancestry that cleanup relies on (REQ-009), and squash loses per-commit evidence.
   - c. `update-ref` on the target branch — rejected: if the target is checked out, its working tree and index silently go stale (they look like a revert).
   - d. **In-memory merge (`merge-tree` + `commit-tree`) followed by fast-forward-only checkouts — chosen.** No working tree ever conflicts, the tested tree is exactly what lands, Git refuses to overwrite local changes, and concurrent target movement is detected because the fast-forward fails.
   - e. A temporary detached worktree for integration tests — rejected: it lacks the lane's installed dependencies. The lane already has them, and fast-forwarding the lane to M is safe because the lane is YallaFlow-owned and clean after its commit.
6. *A background daemon* so queues run with the console closed — rejected: new infrastructure; the console process owns runs and a restart resumes them on one click.

## Specification

### Goal and Scope

One execution experience in the console: start one task now, queue several tasks for one agent, or run several agents in parallel in isolated worktrees — all observed from one Agents view with one approvals inbox. In scope: execution manager; queue persistence and recovery; worktree lanes (create, set up, clean up); **Review & Merge for lanes**, covering pre-merge checks, the review screen, explicit approval, controlled commit and merge, post-merge verification, knowledge integration, the merge queue and recovery (SRC-0054); dashboard and inbox; permission detail; usage-limit handling; conflict detection; docs and tests. Out of scope: any unapproved commit or merge; push; pull; fetch; rebase; reset; revert; automatic conflict resolution; branch deletion; auto-approving permissions or gates; running queues with the console closed; API-key providers; starting runtime services inside lanes automatically; Windows support claims; committing tasks that ran in the main checkout (D11).

### Actors and Permissions

- **Developer** (console user): creates runs, answers approvals, decides gates, integrates branches. Every decision stays human.
- **Execution Manager**: schedules tasks, starts/ends Codex sessions through the bridge, creates/removes worktrees only after the developer's explicit confirmation, and commits/merges only by executing a plan the developer approved (bound to hashes). Never approves, never decides gates, never resolves conflicts, never edits work items except through CLI commands (`activate`, create work, `reopen` on the developer's click, `shared integrate`, `integration record`).
- **Agent** (Codex managed / Claude user-session): works one task in one lane under its own approval mode (never full-access).

### Functional Requirements and Business Rules

- **FR1 Run Now** — "Start" on a work item behaves exactly as in 1.4.2 (activate, start Codex, `goText`; Claude link unchanged), now recorded as a one-task run.
- **FR2 Queue** — select 2+ work items → "Queue": ordered list, one agent and mode for the run (per-task override allowed), runs in the main lane one task at a time; a fresh agent session per task (durable state carries context).
- **FR3 Parallel** — select items or type requests → "Parallel": up to `maxLanes` (default 2, hard cap 4) worktree lanes, each with its own queue; requires Git, a commit to branch from, and Shared Project Mode.
- **FR4 Ownership** — a work item can be in at most one unfinished task across all lanes and projects of the console; the checkout lock and one-session-per-lane rule are unchanged.
- **FR5 Completion (D7)** — a task is `done` only when (a) the lane's fresh snapshot shows its item `DONE` and (b) the manager has ended the session and the bridge reports process cleanup `complete: true`. Only then is the next task claimed. An incomplete cleanup (`survivors`) marks the task `failed: cleanup` and blocks the lane. "Pause between tasks" is off by default.
- **FR5a No duplicate execution** — every start is a write-ahead claim: the task gets `attempt = n+1` and state `starting` persisted *before* any bridge call; the bridge slot is reserved synchronously (existing `reserve`). On load, any `starting`/`working` task becomes `interrupted` and is never restarted automatically. Resume is idempotent per attempt (a second Resume for the same attempt returns the existing state). Only the console that holds the home lane's checkout lock may write `runs.json` (single writer); a second console sees runs read-only. Before claiming, the manager re-reads the item's snapshot and the bridge session records: an item already DONE is marked `done` without starting; an item with a live session anywhere is refused (`ALREADY_RUNNING`).
- **FR6 Needs-you** — permission request, review gate, open question, or an ended turn without DONE puts the task in `needs-you` with the reason; the lane waits; nothing is auto-answered.
- **FR7 Usage limits** — a `usage_limit` stop pauses every lane using that provider, shows `retryAt` text when known, and offers: continue later, or switch the remaining tasks to the other ready provider. No automatic retries.
- **FR8 Failures** — crash or start failure → task `failed`, lane paused, actions: retry (resume when resumable, else fresh start), skip, cancel run.
- **FR9 Cancellation** — stop after current task; stop now (cancel turn + end session); remove queued tasks. Work items themselves are never closed, held, or deleted by a cancel.
- **FR10 Restart recovery** — after a console restart, runs load from `runs.json`; tasks that were starting/working become `interrupted`; nothing starts by itself; one "Resume" per lane (resume the recorded Codex session when resumable, else a fresh session with `goOnText`).
- **FR11 Worktree lanes** — create from a chosen base commit (default: integration branch tip) with branch `yf/<slug>` in a configured folder (default `<repo-parent>/<repo>.lanes/<slug>`); mark ownership; register the lane under its home project (grouped, not a same-named duplicate); offer the existing Setup & run steps for the lane (package scripts still need their checkbox).
- **FR12 Review & conflicts (revised by SRC-0054)** — live overlap warnings across lanes and main stay. The per-lane review and integration are now the Review & Merge workflow (FR20–FR31). Manual integration commands remain available as a fallback only.
- **FR13 Cleanup (REQ-009; revised by SRC-0054 and D12)** — lanes are **retained by default and never removed automatically**. A separate, explicit **Clean up** action (with a confirmation tick) is offered only after the integration state is `verified`, or after a manual integration was verified by ancestry. Removal is refused unless **all** hold: no task of the lane is starting/working/needs-you; no bridge session, Claude link or pending request for the lane; the lane's checkout lock is free (no other console); `status --porcelain --untracked-files=all` is empty (no staged, unstaged or untracked change, including `.yallaflow` work state); `status --ignored` lists no ignored path outside the **positively identified reproducible dependency directories** for the lane's detected stack (e.g. `node_modules/` beside a `package.json` with a lockfile, `vendor/` beside a `composer.lock`) — anything else (`.env`, build outputs, caches, unknown files) blocks removal and is listed; before removal the developer sees the **exact list** of ignored paths that will be deleted and confirms it (A6, REQ-033); the branch tip is an ancestor of the integration branch (`merge-base --is-ancestor`); the YallaFlow marker matches the home record. Then `git worktree remove <path>` (no `--force`) runs, Git's own dirty check is the second guard, and the branch is never deleted. There is no override tick: an unmerged lane stays until the developer merges it or removes it themselves.
- **FR13a Shared enable safety (D1)** — the console runs `yallaflow shared enable --dry-run` and shows its preview; enabling requires a confirmation tick and is refused while any agent session in the project is live, when the current branch is not the integration branch, or when tracked `.yallaflow` files have uncommitted changes. It runs the existing CLI command only (no hand edits); existing `PF-####` items stay valid; the developer commits the change. Parallel then refuses a base commit whose `config.yaml` (read with `cat-file`) lacks `shared.enabled`, telling the developer to commit the enable first.
- **FR14 Agents view & inbox** — one view across all projects and lanes: lane, item, provider, state, working time, last step, needs-you; one inbox of all open approvals/questions/gates with "open in context".
- **FR15 Permission detail** — approval cards show the command and the file paths when the provider sends them (ACP `locations`, `rawInput`), and the remaining time.
- **FR16 Timeout (D4)** — the default stays today's 5 minutes everywhere. M0 includes a recorded experiment with real codex-acp: hold a permission request open for 5, 15, 30 and 60 minutes and observe whether the adapter or app-server times out, cancels the turn, or keeps waiting. Only choices proven safe become selectable as a per-project setting; until then the existing `YALLAFLOW_AGENT_PERMISSION_TIMEOUT_MS` is the only override. A timeout always denies; nothing is ever auto-approved; the task becomes `needs-you: approval timed out`.
- **FR18 Claude Team (REQ-013)** — Claude lanes are labelled "assisted": the console prepares the folder, launch files and the next message; it never starts Claude Code and never advances a Claude task by itself (advance needs the developer's "Next" after DONE). The UI and docs state that on Claude Team/Enterprise logins console→Claude messages are off unless the organisation Owner enables channels, so the message is shown to copy into the terminal.
- **FR19 Interactive Agents view (REQ-011)** — per lane: answer approvals (Allow / Allow for session / Deny), open the review gate or question in context, Continue (sends `goOnText`), Pause run, Stop turn (`cancel`), End session, Resume, Retry, Skip, Open chat; per run: pause, resume, cancel after current, cancel now, reorder queued tasks. All actions call the same bridge/manager endpoints as the chat.
- **FR17 Small projects** — nothing new appears until the developer selects two or more items or opens the Agents tab; Parallel stays hidden until enabled for the project.

### Review & Merge (SRC-0054)

Applies to worktree lanes. Tasks run in the main checkout keep the 1.4.2 behaviour, with changes left uncommitted (D11).

- **FR20 Readiness (automated pre-merge checks).** "Review" is offered when a lane's last task is DONE. Preparing a review runs these checks, read-only or object-only, with no approval needed:
  1. **Task:** item `DONE` in the lane snapshot; latest verification run passed; convergence satisfied where required; no open question; no pending gate.
  2. **Session:** no live session, Claude link or pending request in the lane. From this point the lane is *locked for integration*, so no new session can start.
  3. **Changes:** the full lane change set = commits on `yf/<slug>` since base + uncommitted, staged and untracked files (`status --porcelain=v1 -z --untracked-files=all`, `diff --name-status base…HEAD`). Each file gets a status, size and binary flag, and its blob id is computed in Node (SHA-1 of `blob <len>\0` + content). Flags raised:
     - secret scan via `containsSecret` and file-name patterns (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `*.p12`);
     - files over 5 MB;
     - symlinks, refused if they point outside the repo;
     - submodule (gitlink) changes, refused in 1.5.0;
     - file-mode changes.
  4. **Repository integrity:** the hash of the common `.git/config` and `info/attributes` must be unchanged since lane creation; otherwise the merge is refused until reviewed, because an agent could plant a filter driver that `git add` would run. Also checked: Git ≥ 2.38, `user.name`/`user.email` set, no `MERGE_HEAD`/`rebase-*`/`CHERRY_PICK_HEAD`/`BISECT_LOG` in the home checkout or the lane.
  5. **Conflicts (object-only preview):** build the *approved lane tree* A in a private temporary index (`GIT_INDEX_FILE=.yallaflow/local/execution/tmp/<id>.index`):
     - `read-tree <laneHEAD>`, then `add -A --pathspec-from-file=<ticked> --pathspec-file-nul` (literal pathspecs), then `write-tree` = A.
     - So A = lane HEAD + exactly the ticked working-tree paths.
     - `commit-tree A -p <laneHEAD>` = candidate C′, then `merge-tree --write-tree --name-only --no-messages -z <targetHEAD> <C′>` = merged tree T, or the conflicting paths.
     - Overlaps with other lanes are listed too.
     - The review also shows the diff `targetHEAD → T`, i.e. exactly what main will receive including Git's merged hunks, not only the lane diff.
  6. **Target (home checkout):**
     - On the integration branch (symbolic-ref); not detached, not sparse.
     - **Index identical to HEAD** (`diff --cached --quiet`): staged changes block the merge, because Git documents that merges abort when the index differs from HEAD, and the knowledge commit must contain nothing of the developer's.
     - For every path that differs between target HEAD and T (`diff --name-only -z <targetHEAD> <T>`), all of these are refused and listed:
       - an unstaged modification;
       - an `lstat` hit for a path T adds (untracked **or ignored**, because Git may overwrite ignored files);
       - an `assume-unchanged` or `skip-worktree` entry (`ls-files -v -t`), because such entries can hide local changes from Git.
     - Unrelated unstaged and untracked files are allowed and must stay byte-identical.
     - The YallaFlow-owned paths that integration will write must be clean.
     - Paths that M changes relative to the target HEAD (`diff --name-only <targetHEAD> <T>`) must not be modified, staged or untracked in the home checkout; any that are get listed.
     - Unrelated dirty files are allowed and stay untouched.
     - The paths `shared integrate` will write (`.yallaflow/context/**`, projections, the lane work's `memory.yaml`) must be clean in the home checkout.
  7. **Shared Project integrity:**
     - In the lane: `yallaflow doctor` and `yallaflow shared check` pass.
     - The lane's staged memory delta (its work items' `memory.yaml` candidates and relations) is listed as the **expected integration outcome**.
     - The exact outcome is confirmed after approval but before main moves (FR23 step 6), using the deterministic `shared integrate --dry-run` on the tested tree.
  8. **Required merge checks (D9, FR32):**
     - the lane item's latest passing verification argv runs (V-###);
     - plus every check the project declares as required for merging.
     They are listed for approval and not run yet. If hooks or CI workflows are detected and the project has not declared its required merge checks, the merge is blocked until it does.
- **FR21 Review screen (S6).** Shows:
  - the readiness checklist with ✓/✗/⚠ and reasons;
  - changed files with per-file tick (default ticked), status, +/- counts and a diff view; secret-flagged files are unticked and need an explicit per-file confirmation to include;
  - the verification evidence (V-### runs with results, convergence findings, any QC results);
  - the plan, with the exact commit message (editable), the files, the target branch, the tests to run, knowledge integration, and lane removal.
  "Approve & merge" stays disabled until every blocking check passes. A file left unticked stays uncommitted in the lane, so the lane cannot be removed afterwards (a warning says so).
- **FR22 Explicit approval (D8).** The developer ticks "I approve committing these N files to `yf/<slug>`, merging into `<target>`, and running these checks" and clicks Approve & merge.
  - The approval record stores who (git `user.name`), when, and a **plan hash** over the *material content*:
    - approved lane tree A and the reviewed lane HEAD;
    - the ticked path list with blob ids;
    - commit and merge messages;
    - target branch and target HEAD;
    - merged tree T;
    - the merge commit's material content (tree T, parents = target HEAD and the lane commit whose tree is A on the reviewed lane HEAD, message);
    - the required-check argv list (verification scope);
    - the expected integration outcome.
  - Commit ids differ only by timestamps and are not material. Every other field is.
  - Any later difference in a material field (reviewed diff, T, merge commit content, check scope, integration outcome) invalidates the approval and needs a fresh one; the screen shows what changed. Nothing that commits or merges runs before a matching approval exists.
  - The approval record stores who (git `user.name`, as gates do), when, and a **plan hash** over: lane tree id, approved path list with blob ids, commit message, target branch, test argv list, and options.
  - Nothing that commits or merges runs before this record exists.
  - The approval covers this lane's changes only. If the target moves before the merge, D8 governs.
- **FR23 Controlled execution (after approval, merge lock held).** A write-ahead journal at `.yallaflow/local/execution/merges/<id>.json` records each step before and after it runs. Every Git call uses `--literal-pathspecs` (pathspec magic and globs off), and hooks and fsmonitor stay off.
  1. *re-validate*: no session in the lane; target HEAD unchanged; rebuild A in a temp index and compare it with the approved A; blob ids unchanged; repo config hash unchanged; home pre-checks (FR20.6) still pass. Any difference needs a fresh approval (D8).
  2. *lane commit (verify-before-commit)*:
     - stage the ticked paths in the lane's real index with `add -A --pathspec-from-file=<ticked> --pathspec-file-nul`;
     - run `write-tree` on the real index and require it to **equal A**; if an agent staged anything else, it differs and the merge is blocked before any commit, listing the extra entries;
     - then `commit -F <msg>`, with no pathspec, so exactly the verified index is committed;
     - then verify `HEAD^{tree}` = A and `HEAD^` = the reviewed lane HEAD.
     A mismatch stops as `failed`; nothing is undone, and the commit stays on `yf/<slug>` only.
  3. *merge commit*: `merge-tree --write-tree` against the approved target HEAD must give T again. Then `commit-tree T -p <targetHEAD> -p <laneCommit> -F <mergeMsg>` (plus `-S` when the developer's `commit.gpgSign` is true) = M. Then verify `M^{tree}` = T and its parents.
  4. *lane to M*: `merge --ff-only <M>` in the lane. Its working tree is clean except the unticked files, which do not intersect `diff(laneHEAD, M)` (checked first).
  5. *required checks on M*: run the approved check argv list in the lane on M, under the existing `acknowledgeScripts` consent included in the approval tick. Logs (redacted) go into the journal. Any failure, or a check that cannot run → `blocked: checks` (D9), and main is unchanged.
  6. *integration preview on M*: in the lane run `yallaflow shared integrate --dry-run` (code: the dry run returns before the branch check, `src/shared/memory.js:287`), plus `shared check` and `doctor`. The applicable set must equal the approved expected outcome and nothing may be blocked; otherwise stop before main moves and require a fresh approval (D8).
  7. *target to M*: re-check the target HEAD equals `M^1` and the home pre-checks pass, then `merge --ff-only <M>` in the home checkout. Then verify `HEAD` = M and `HEAD^{tree}` = T, and that every pre-recorded unrelated dirty file is byte-identical.
  8. *knowledge*: `yallaflow shared integrate` on the integration branch. The function is deterministic (same ledger, deltas and HEAD → byte-identical files, `src/shared/memory.js:275`), so the applied set must equal step 6; any difference → `merged · knowledge needs approval`, and nothing is committed.
  9. *record*: `yallaflow integration record` writes `work/<id>/integration.yaml` atomically (temp + rename via the existing YAML writer), with state `verified` and the evidence of steps 5–8 (D10).
  10. *knowledge commit (verify-before-commit)*:
      - stage exactly the YallaFlow-owned paths changed by steps 8–9 (status difference, each path checked against the allowed set) with `add -A --pathspec-from-file`;
      - `write-tree` must equal HEAD + those paths; the home index was identical to HEAD before, so anything the developer staged meanwhile makes it differ and blocks the commit;
      - then `commit -F <msg>`;
      - then verify `diff --name-only HEAD^ HEAD` = that set.
  11. *done*: the integration state becomes `verified` only when steps 7–10 have succeeded. The lane is **kept**; Cleanup is a separate explicit action (D12).
- **FR24 Concurrency.**
  - One merge executes at a time per target branch, under `.yallaflow/local/execution/merge.lock` (pid/host/boot id, stale reclaim — the existing lock utilities). Other approved merges wait FIFO in the *merge queue*.
  - When a waiting merge starts and main has moved, it re-previews. Because T, the merge commit content and possibly the integration outcome change, it returns to `ready` and **needs a fresh approval** (D8), showing what changed. The UI offers review of the next lane after the previous merge finishes, to avoid wasted approvals.
  - Only the console holding the home checkout lock may execute merges.
  - A lane under integration refuses new sessions, lane removal, and a second review.
  - Git's own `index.lock` present → the step fails with "Git is busy in <checkout>" and can be retried; no lock file is ever deleted.
- **FR25 Conflicts.** Never resolved automatically. A conflict in the preview or in step 3 → `blocked: conflict` with the paths. Actions:
  - "Send back to the agent": reopen the item with reason "integrate <target> into the lane and resolve conflicts in …" (the existing `yallaflow reopen`, the developer's click), then start the lane's agent with a prepared message.
  - "I'll integrate by hand": shows the commands; the console detects the result through ancestry.
  - "Cancel review".
- **FR26 Failures.** Any failed step stops the journal in `failed: <step>` with Git's message. Nothing is rolled back automatically (no reset, revert or branch moves). The screen states exactly what changed so far: lane commit X exists; target unchanged; or merged but knowledge pending.
  - Failure after step 6 → state `merged · not verified`. The undo command is shown as text only (`git revert -m 1 <M>`), and a fix task can be started.
- **FR27 Recovery.** On console start, a journal in a non-terminal step becomes `interrupted`. Nothing continues by itself. "Continue merge" re-validates reality and resumes from the first incomplete step. Each step detects "already done" first:
  - lane commit with the approved tree already at HEAD;
  - M already reachable from the lane;
  - target HEAD already M;
  - integrate bookkeeping already complete;
  - integration record present;
  so no step runs twice. "Abandon" leaves everything as it is and explains the state. A plan whose hash no longer matches reality needs a new approval.
- **FR28 States.** *Task DONE* and *Changes MERGED & VERIFIED* are shown as separate badges everywhere (cards, item page, Agents view, lane review).
  - `verified` requires steps 6–10 to succeed, or nothing to integrate.
  - `merged · knowledge needs review` and `merged · not verified` are distinct, actionable states.
- **FR29 Durable integration record (D10).** `work/<id>/integration.yaml` is CLI-owned (added to state ownership and `doctor`) and appended by `yallaflow integration record`.
  - **Contents:** merge commit M, tree T, target, lane branch, base, plan hash, approver, required checks with argv, exit codes and durations, post-merge checks, the knowledge items integrated, and the time. It states "CI not run by YallaFlow" explicitly.
  - **Writes:** atomic (temp file + rename) and append-only. The record is written only after steps 7–8 succeed, so it can never claim `verified` for a state that was not reached.
  - **Shared Project:** it lives in the lane work's own directory, so parallel lanes never write the same file. It is committed in the knowledge commit on the integration branch and reaches teammates through ordinary Git.
  - **Missing record:** the console derives `merged · not verified` from ancestry (lane commit reachable from main, no record for M) and never shows `verified`.
  - It is allowed on DONE work, like a recovered source, and never changes the stage.
- **FR30 Hooks and signing (D9).** Hooks are disabled for YallaFlow's own Git calls (A6). The review screen lists the detected hooks: `.git/hooks` non-sample files, `core.hooksPath`, `.husky/`, `.pre-commit-config.yaml`, `lefthook.yml`, plus CI workflows (`.github/workflows/*`, `.gitlab-ci.yml`).
  - It never claims that task tests replace them. Equivalence is declared by the developer (FR32), and merging is blocked when a declared check cannot run or fails.
  - A `commit-msg` rule is shown next to the editable message.
  - Signing follows the developer's config: `-S` is passed explicitly to `commit-tree` when `commit.gpgSign` is true, and `commit` signs by config. A signing failure stops the step, and nothing changes.
- **FR32 Required merge checks (D9).** Each project declares its merge checks once, in the tracked `config.yaml` under `execution.mergeChecks: [{name, argv, required}]`, written only through a new `yallaflow execution checks set` CLI command that the console calls after a confirmation tick.
  - The console *suggests* candidates from detected hooks, CI steps and package scripts (`lint`, `test`, `typecheck`); the developer chooses. YallaFlow never infers that a check is equivalent.
  - If hooks or CI exist and no merge checks are declared, Review is blocked with "declare the required checks".
  - Checks run on M in the lane (FR23 step 5). The integration record lists which ran and states that CI was not run.
- **FR33 Verified platform gate (A2, REQ-030).** `git-ops` holds a `VERIFIED` table of platform (`linux`) and Git versions on which `test/git-transaction.test.js` has passed: initially 2.43.x, extended only by a recorded passing run (for example the CI runner's Git).
  - Anywhere else — another OS, an unlisted Git version, or Git < 2.38 — every mutating operation (G1, G2, G7–G10) **fails closed**. The console then shows the manual Git commands for the same plan, and nothing runs.
  - Read-only preview may still run.
- **FR34 No external filters or merge drivers (A4, REQ-031).** Before any lane creation or merge step, YallaFlow detects (read-only) every effective-config `filter.<name>.clean|smudge|process` and `merge.<name>.driver` whose `<name>` is referenced by an attribute file of the repository: root and nested `.gitattributes` (tracked), `.git/info/attributes`, and `core.attributesFile`.
  - If any exists, automated lanes and Review & Merge are **blocked**, with no trust override in v1.5.0, and the manual alternative is shown.
  - Built-in attributes (`text`, `eol`, `binary`, `merge=union|text|binary`) involve no external command and are allowed.
  - The check runs again before every mutating step, as part of the configuration fingerprint.
- **FR35 Signing gate (A5, REQ-032).**
  - SSH signing, covered by permanent tests, is allowed.
  - OpenPGP signing is allowed only because the shipped suite contains the permanent GPG test (AC-047). If that test is absent or skipped in the release's recorded CI run, the release disables the GPG path.
  - Any other `gpg.format` (e.g. `x509`) is blocked, with the manual alternative.
- **FR36 Strict argument validation (REQ-035).** Each `git-ops` operation builds its argv from typed, validated inputs only:
  - slug `^[a-z0-9][a-z0-9._-]{0,48}$`;
  - absolute realpath under the validated lanes root or the home checkout;
  - object id `^[0-9a-f]{40}$` (or 64 for SHA-256 repositories), existence-checked;
  - temp and message files created by git-ops itself under `.yallaflow/local/execution/tmp/`.
  No caller passes raw argv. Option-like, relative, out-of-root or extra arguments are rejected before spawning.
- **FR37 Stop on inconsistency (A1, A3, REQ-034, REQ-037).**
  - Before and after every mutating step, YallaFlow validates HEAD, the target ref, the index tree vs HEAD tree, the approved paths' blob ids, the presence of `index.lock` and other in-progress markers, and the configuration fingerprint.
  - Any unexpected value stops the integration in a non-verified state.
  - YallaFlow never resets, checks out, repairs, removes a lock file, or retries a mutation by itself.
  - Manual recovery guidance is shown (C9). Continue re-validates everything first.
- **FR31 Commit content.**
  - Lane commit message default: `<work-id>: <title>`, with a blank line and the trailer `YallaFlow-Work: <work-id>`.
  - Merge commit: `Merge <lane branch> (<work-id>)` + trailer.
  - Knowledge commit: `chore(yallaflow): integrate <work-id> knowledge` + trailer.
  - Author and committer are the developer's Git identity. No AI co-author trailer is added unless the developer writes one.

### Git Safety Threat Model (revised for SRC-0054)

Assets: the developer's uncommitted work and index in the home checkout, the integration branch history, lane work, project memory and evidence, secrets on disk, the developer's machine.

| # | Threat | Mitigation |
|---|---|---|
| T1 | Unrelated files committed (developer WIP, agent debris, secrets) | Only a displayed, per-file-ticked path list is staged (NUL pathspec file, `--literal-pathspecs`). Before every commit, `write-tree` of the index must equal the approved tree; after it, `HEAD^{tree}` is checked. Secret scan with an explicit per-file override. The knowledge commit is limited to the YallaFlow-owned path set, and the home index must equal HEAD beforehand. |
| T2 | Developer's uncommitted changes overwritten | Home is touched only by `merge --ff-only`. Pre-check lists dirty/untracked files on M's changed paths and refuses; Git's own refusal is the second guard. No checkout, reset, stash or clean. |
| T3 | Half-merged / conflicted working tree | Three-way merge only in objects (`merge-tree`). Working trees only fast-forward. |
| T4 | Content changed between review and commit (TOCTOU) | Lane locked for integration. Approval bound to tree and blob ids. Re-validate before commit. Verify after commit. |
| T5 | Repository-configured code runs (hooks, fsmonitor, filters, gpg program) | `core.hooksPath=/dev/null`, `core.fsmonitor=false` on every call. Config/attributes hash pinned at lane creation; a change blocks. Filters and signing follow the developer's own config (documented). |
| T6 | Concurrent merges / target moved | Per-target merge lock and FIFO queue. Re-preview against the new HEAD. `--ff-only` fails if the target moved. Single writer (home checkout lock). |
| T7 | Crash mid-integration | Write-ahead journal. Idempotent "already done" detection. Manual Continue/Abandon. No automatic rollback. |
| T8 | Wrong branch or state in home | Integration branch only, from Shared config + symbolic-ref. Refuse detached, sparse, or in-progress operations. |
| T9 | Path or option injection | Absolute validated paths. Slugs `^[a-z0-9][a-z0-9._-]{0,48}$`. Object ids `^[0-9a-f]{40,64}$`. Paths only via NUL pathspec files. Every argv has a fixed shape. No shell. |
| T10 | Destructive cleanup | No automatic removal (D12). An explicit Clean up only after `verified` and all FR13 guards. `worktree remove` without `--force`. Branches never deleted. |
| T11 | History rewriting or remote effects | No rebase, reset, revert, `update-ref`, push, pull, fetch, tag or branch deletion anywhere (test 51). |
| T12 | Silent approval or auto-merge | No code path reaches step 2 without an approval record whose plan hash matches. Tests assert it. |
| T13 | Agent commits on the lane branch by itself | Allowed (agent's own approvals), but every commit since base is part of the reviewed change set and plan. Foreign authors are shown. |
| T14 | Secrets in YallaFlow records | Merge records and integration record store paths, ids, argv and exit codes only. Test output is passed through `redactSecrets`. |
| T15 | Fast-forward overwrites an *ignored* file (Git treats ignored files as expendable) | `lstat` pre-check of every path T adds in the home checkout; any existing file blocks. Verified again just before step 7. |
| T16 | `assume-unchanged` / `skip-worktree` entries hide local edits from Git | `ls-files -v -t` pre-check; any such entry on a changed path blocks. |
| T17 | Pathspec magic or globs widen what is staged (a file named `*.js` or `:(top)x`) | `--literal-pathspecs` on every call; NUL pathspec files; write-tree equality to the approved tree before every commit. |
| T18 | Console killed in the middle of a fast-forward (working tree partly updated, ref not moved) | Rare and short window. Detected on recovery (HEAD ≠ M while files on M's paths already match M). YallaFlow stops and explains; it never resets or checks out. Manual recovery steps are documented. Listed as open risk R7. |

### Git Transaction Validation (SRC-0055)

Method: Git 2.43.0 manual pages (`git-commit`, `git-merge`, `git-merge-tree`, `git-commit-tree`, `git-read-tree`, `git`) and YallaFlow source were read. No commit, merge or other mutating command was executed during this validation. Each claim carries one of these evidence classes:
- **Documented**: stated in the Git manual.
- **Code**: YallaFlow source.
- **Enforced**: the design checks it with hash equality, independent of Git's semantics.
- **Unverified**: an open risk, to be proven in M3a.

**Q1 — Temporary indexes, `commit-tree` and `merge-tree`.**
- *Documented:* `merge-tree --write-tree` "performs a merge, but does not make any new commits and does not read from or write to either the working tree or index". It prints the merged tree id. Exit status is 0 when clean, 1 on conflicts, and anything else is an error with unspecified output, so only exit 0 is accepted as clean. The manual itself shows `merge-tree --write-tree` → `commit-tree <tree> -p A -p B` as the intended sequence.
- *Documented:* `GIT_INDEX_FILE` selects an alternate index file. `read-tree <tree>` loads a tree into that index.
- *Design:* the temp index lives under `.yallaflow/local/execution/tmp/`, is used only by G4–G6, and is deleted after use. The developer's and the lane's real indexes are never touched in preview. Objects created by preview are unreferenced and are collected by Git's own gc later.
- *Unverified (R1):* that `add -A` on a fresh temp index in a linked worktree produces the same blob ids as the real index would (no stat cache; clean filters run). The design compares tree ids, so a difference blocks rather than corrupts.

**Q2 — `commit --only` with staged and unstaged changes.**
- *Documented:* `--only` commits "the updated working tree contents of the paths specified … disregarding any contents that have been staged for other paths".
- What happens afterwards to the index entries of other paths is **not** stated in the manual (R2). The design therefore **drops `commit --only`**. It stages the approved paths, requires `write-tree` of the real index to equal the approved tree A (enforced), then runs `commit` without paths and verifies `HEAD^{tree}` = A (enforced).
- In the home checkout, the index must equal HEAD before the knowledge commit (enforced pre-check). Anything the developer stages meanwhile breaks the equality and blocks the commit.

**Q3 — Fast-forwarding main and unrelated local changes.**
- *Documented:* `git merge` "will stop without doing anything when local uncommitted changes overlap with files that git merge may need to update". Merges also "abort if there are any changes registered in the index relative to the HEAD commit (… generally, the index must match HEAD)".
- *Design:* staged changes in home block the merge (pre-check), so the index rule never matters. Unstaged unrelated modifications and untracked files are expected to survive a fast-forward. **This is unverified (R3)**, and AC-025 demands before/after byte hashes.
- Known gaps handled by pre-checks:
  - Git may overwrite **ignored** files (T15): an `lstat` hit on any added path blocks.
  - `assume-unchanged`/`skip-worktree` entries can hide edits (T16) and block.
  - Case-insensitive filesystems are not verified (R8, Linux only).

**Q4 — `shared integrate` and `integration.yaml` without changing approved content.**
- They never change M. They land in a separate knowledge commit K on top of M, limited to YallaFlow-owned paths (enforced by the path-set check and by write-tree equality).
- *Code:* `integrateSharedMemory` is deterministic: same ledger, pending deltas and HEAD give byte-identical output, with a timestamp taken from the data (`src/shared/memory.js:275-277`).
- *Code:* `--dry-run` returns before the integration-branch check (`src/shared/memory.js:287`), so the exact applicable set can be computed in the lane on the tested M **before main moves** (step 6). It is then compared with the real result after the merge (step 8).
- The approval covers the expected integration outcome. A differing outcome stops for a fresh approval (D8).
- K's bytes are not individually approved; its scope (paths, knowledge items) is. *Unverified (R4):* that the dry-run applicable set in the lane equals the real run in the home checkout for the same tree. It is expected from determinism, and a difference blocks the knowledge commit.

**Q5 — Crash after main moved, before verification was recorded.**
- The journal marks step 7 before and after it runs. On restart nothing continues automatically. *Continue* derives reality first:
  - `HEAD == M` in home means step 7 is done;
  - the integrate bookkeeping shows what step 8 completed (the existing integrate is re-runnable: "re-run … to finish it", `src/shared/memory.js:523`);
  - an `integration.yaml` entry for M means step 9 is done;
  - a commit after M touching only those paths with the trailer means step 10 is done.
- Until step 9 exists, every view derives `merged · not verified` from ancestry. `verified` is never shown without the record.
- If the journal is lost or corrupt, the merge shows "state unknown — review" and offers re-verification (steps 7 check → 10) only after a fresh confirmation.
- A crash **inside** the fast-forward itself (R7, T18) can leave files updated but HEAD not moved. YallaFlow detects it and stops without resetting, and documents the manual recovery. This is an accepted open risk.

**Q6 — Can we truthfully guarantee that no unrelated file is committed?**
What can be guaranteed:
- **(a)** The lane commit's tree equals the approved tree A. This is checked before the commit (index tree) and after (HEAD tree) by content hash. A tree id identifies every path and every byte.
- **(b)** What lands on main is exactly the tree T that was previewed, tested and approved (`HEAD^{tree}` = T after the fast-forward).
- **(c)** The knowledge commit changes only the YallaFlow-owned path set (checked before and after).
What cannot be guaranteed:
- the *meaning* of an approved file's content: the reviewer's judgement, with a heuristic secret scan;
- files the developer explicitly ticks;
- the output of the developer's own clean/smudge filters.
So the truthful wording is: **"YallaFlow refuses to commit any tree other than the one you approved, and proves it by hash before and after"**, not "Git semantics guarantee it".

**Open risks — not yet proven by execution.** Each is closed by an M3a experiment plus a permanent test. Until then it is reported as a risk, not as behaviour:

| ID | Risk | Proof planned |
|---|---|---|
| R1 | Temp-index blob/tree ids equal the real-index ids (filters, line endings, executable bits) | Compare A from the temp index and from the real index on text, binary, CRLF, `+x` and symlink files |
| R2 | Real-index behaviour after staging approved paths when an agent staged others | Stage extra entries; the equality check must block; nothing committed |
| R3 | `merge --ff-only` keeps unrelated unstaged and untracked files byte-identical, and refuses on overlap | Hash-before/after on modified, untracked, ignored and overlapping files |
| R4 | Dry-run applicable set in the lane = real integrate result in home | Two lanes with deltas, including one parallel fact change |
| R5 | Hooks never run with `core.hooksPath=/dev/null` for `worktree add`, `commit`, `merge --ff-only` | Planted hooks write a marker file; it must not appear |
| R6 | `commit-tree` signing: explicit `-S` honours the developer's key; failure leaves no ref change | Test repo with a throwaway key and a failing `gpg.program` |
| R7 | Crash during the fast-forward | Kill at the checkout phase via a slow filesystem shim, if feasible; otherwise documented as accepted risk |
| R8 | Case-insensitive and non-Linux filesystems | Out of scope for 1.5.0 verification; documented limitation |
| R9 | `--literal-pathspecs` with `--pathspec-from-file` treats `*`, `?`, `[`, `:(` names literally | Files with such names; only they are staged |
| R10 | Git ≥ 2.38 detection and refusal on older Git | Version probe test |

### Workflows and Lifecycle

Task states: `queued → starting → working ⇄ needs-you → done`; side exits `paused` (limit / interrupted / developer), `failed`, `skipped`, `cancelled`.

| Signal (source) | Task state | Scheduler action |
|---|---|---|
| snapshot stage `DONE` + session ended with cleanup complete | done | claim next task (or pause if "between tasks"); incomplete cleanup → failed |
| `permission.requested` (bridge) | needs-you: approval | wait; inbox entry |
| snapshot `waitingFor.kind = review` | needs-you: decision | wait; open gate in context |
| `turn.ended`, item not DONE, no pending | needs-you: reply | wait; `chatAction` button |
| `session.stopped` `usage_limit` | paused: limit | pause all lanes on that provider |
| `session.ended` crashed / start error | failed | pause lane; retry/skip/cancel |
| lifecycle held/closed (snapshot) | skipped | next task |
| console restart while starting/working | interrupted | wait for Resume |

Run states: `ready → running → (paused) → finished | cancelled`. Lane states: `creating → preparing → ready → busy → idle → integrating → removing → removed`.

Integration states (separate from the task state, SRC-0054): `not-ready → ready (review prepared) → approved → queued (merge lock) → merging → merged → verified`. Side states are `blocked: conflict | tests | precondition`, `merged · knowledge needs review`, `merged · not verified`, `failed: <step>` and `interrupted`. Only `verified` allows lane removal.

### Data and Integrations

`runs.json` (main checkout, local):
```json
{ "schema": "yallaflow.execution/1",
  "runs": [{ "id": "r-1a2b3c", "mode": "queue", "createdAt": "…", "state": "running",
    "options": { "pauseBetween": false, "provider": "codex", "mode": "workspace-write" },
    "lanes": [{ "id": "main", "root": "/abs/repo", "kind": "main",
      "tasks": [{ "id": "t-1", "workId": "PF-0120", "request": null, "provider": "codex",
                  "state": "done", "sessionRecord": "a1b2c3d4e5f6", "startedAt": "…", "endedAt": "…",
                  "reason": null }] }] }],
  "lanes": [{ "id": "l-7f3e", "root": "/abs/repo.lanes/login-page", "branch": "yf/login-page",
              "base": "f156459…", "home": "/abs/repo", "createdAt": "…", "state": "ready" }],
  "settings": { "maxLanes": 2, "lanesDir": null, "permissionTimeoutMin": 5 } }
```
Bridge: unchanged API; additions — `permissionTimeoutFor(project)` honouring the per-project setting, and request `detail.paths[]` / `detail.command` from ACP. Registry (`console.json`): optional `parent` and `lane` fields on entries (older consoles ignore them). New API: `GET /api/execution` (all runs/lanes/tasks + aggregated pending), `POST /api/p/<pid>/execution/(run|pause|resume|cancel|reorder|skip|retry)`, `POST /api/p/<pid>/lanes/(create|remove)`, `GET /api/p/<pid>/lanes/<id>/review`.

Review & Merge additions (SRC-0054):
- **Endpoints:** `POST /api/p/<pid>/lanes/<id>/review/prepare` (object-only; returns the readiness, the change set and the plan with its hash), `POST …/merge/approve` (`{planHash, files[], message, options, confirmed:true}`), `POST …/merge/(continue|abandon|cancel)`, `GET /api/p/<pid>/merges` (the merge queue and journals).
- **Local store:** `.yallaflow/local/execution/merges/<id>.json` holds `{schema:'yallaflow.merge/1', lane, workId, planHash, plan, approval, steps:[{name, state, startedAt, endedAt, detail}], state}`.
- **Locks and temp files:** `merge.lock` serialises merges; `tmp/` holds the private temporary indexes, which are removed after each use.
- **Tracked state:** the new CLI-owned `work/<id>/integration.yaml`, written by the new `yallaflow integration record` command (D10). This is the only new tracked state format.

### Validation and Error Behavior

Start refused with a reason when: provider not ready / not subscription-logged-in; item already owned by another unfinished task; lane busy; Parallel without Git, without a commit, or without Shared Project Mode; lanes folder inside the repo, a symlink, or not writable; branch name exists; worktree path exists; `maxLanes` reached. Worktree removal refused per FR13 (active, dirty, ignored non-dependency files, unmerged, not verified, or not created by YallaFlow). Review & Merge refusals are listed per check in FR20 and per step in FR23. Every error uses the console's existing `{code, message}` shape and Arabic/English text.

### Security and Privacy

- New POST routes join the token + Origin + exact Content-Type checks; lane create/remove and run start require a `confirmed` checkbox like gates.
- Worktree Git: argv only, no shell, hooks disabled (`core.hooksPath=/dev/null` — `git worktree add` otherwise runs `post-checkout`), fsmonitor off, names `^[a-z0-9][a-z0-9._-]{0,48}$` under prefix `yf/`, realpath checks, never `--force`, never branch deletion.
- Lanes inherit the bridge rules: no API keys in the adapter env, forbidden modes refused, permissions never auto-approved, `allow_session` only session-scoped.
- The manager never answers a permission, gate or question; the inbox only relays the developer's click.
- Local state only (`.yallaflow/local`, mode 0600 dirs via existing helpers); no secrets stored; transcripts stay with providers.
- Test 51 extended, not weakened: the new subcommands are allowed only in `src/execution/git-ops.js` with asserted argv shapes.
- Review & Merge security: see the Git Safety Threat Model (T1–T14) and the Checkpoint C allowlist. The approve route requires `confirmed:true`, a matching `planHash`, the token and Origin, and is refused in a read-only console or by a console without the home checkout lock.

### UI / Screens

**S1 — Work page, small project (unchanged until you select).**
```
┌ Work ──────────────────────────────────────────────────────────┐
│ ☐ PF-0120  Login page copy        Ready        [▶ Start]        │
│ ☐ PF-0121  Fix invoice rounding   Ready        [▶ Start]        │
│ ☐ PF-0122  Add CSV export         Ready        [▶ Start]        │
└────────────────────────────────────────────────────────────────┘
```
**S2 — Two or more selected → one action bar.**
```
┌──────────────────────────────────────────────────────────────┐
│ 3 selected   [▶ Run one now]  [☰ Queue 3]  [⫽ Parallel 3]  ✕ │
└──────────────────────────────────────────────────────────────┘
          (Parallel shows "Set up" first if not enabled)
```
**S3 — Run sheet (Queue).**
```
┌ Queue 3 tasks ─────────────────────────────────────────────────┐
│ Agent: (•) Codex  ( ) Claude Code (assisted)   Mode: workspace-write │
│ 1 ↕ PF-0121  Fix invoice rounding            Codex             │
│ 2 ↕ PF-0120  Login page copy                 Codex             │
│ 3 ↕ PF-0122  Add CSV export                  Codex             │
│ ☐ Pause after each task so I can look                          │
│ Approvals wait 5 min (more only after testing); unanswered = denied │
│ ☐ I understand the agent works through these one by one        │
│                                   [Cancel]  [Start queue]      │
└────────────────────────────────────────────────────────────────┘
```
**S4 — Parallel setup (first time per project).**
```
┌ Parallel work ─────────────────────────────────────────────────┐
│ Each task gets its own folder and branch (Git worktree).       │
│ ✓ Git repository   ✓ Base: main @ 3b34fa9                      │
│ ✗ Shared Project Mode — needed so work IDs never collide       │
│   [Enable Shared Project Mode]  (runs yallaflow shared enable) │
│ Lanes folder: /home/me/Amasi/YallaFlow.lanes   [Change]        │
│ At most [2 ▾] agents at once (3–4 experimental)                │
│ ☐ Create folders and branches yf/… for me                      │
│                                   [Cancel]  [Create 2 lanes]   │
└────────────────────────────────────────────────────────────────┘
```
**S5 — Agents view (new tab, all projects).**
```
┌ Agents ─────────────────────────────── Needs you (2) ──────────┐
│ ⚠ Codex · lane login-page · wants to edit src/auth/login.js   │
│   [Allow] [Allow for session] [Deny]          27 min left  ↗   │
│ ⚠ Codex · main · PF-0121 waits for your plan review  [Review]↗ │
├────────────────────────────────────────────────────────────────┤
│ YallaFlow                                                      │
│  main        PF-0121 ● waiting for you   Codex  12 min          │
│              queue: PF-0120 ○  PF-0122 ○        [Pause][Stop]   │
│  login-page  PF-A1B2-0001 ● working      Codex  4 min  "npm test"│
│  csv-export  PF-C3D4-0001 ✓ done                [Review][Remove]│
│ lalaff                                                          │
│  main        — no agent —                                       │
└────────────────────────────────────────────────────────────────┘
```
**S6 — Review & Merge (revised by SRC-0054; replaces the manual-commands lane review).**
```
┌ Review · lane csv-export · yf/csv-export → main ─────────────────────┐
│ PF-C3D4-0001  Task: DONE ✓      Changes: NOT MERGED                  │
│ Readiness                                                            │
│  ✓ Task done, verification V-003 passed, criteria satisfied          │
│  ✓ Agent stopped · lane locked for review                            │
│  ✓ No conflicts with main @ 9e1f2c0 (main moved 2 commits since base)│
│  ✓ Shared memory: check PASS · 1 knowledge item will integrate       │
│  ⚠ Your main checkout has 3 unrelated uncommitted files (untouched)  │
│  ⚠ Project hooks (.husky/pre-commit) will not run; tests below will  │
│ Changes (5 files)                                     [View diff]    │
│  ☑ M src/export/csv.js            +84 −3                              │
│  ☑ A src/export/csv.test.js       +61                                 │
│  ☑ M src/ui/menu.js               +4  −1                              │
│  ☐ A .env.local   ⚠ looks like a secret — not included               │
│  ☑ A .yallaflow/work/PF-C3D4-0001/… (work records)                    │
│ Evidence  V-001 ✗ · V-002 ✓ · V-003 ✓ (npm test, 1,048 passed)        │
│ Plan                                                                 │
│  1 Commit 4 files on yf/csv-export: "PF-C3D4-0001: Add CSV export"    │
│  2 Create merge commit into main (in memory, no working tree touched) │
│  3 Run required checks on the merged result: npm test, npm run lint  │
│  4 Fast-forward main · verify · integrate knowledge · record          │
│  5 Commit YallaFlow knowledge on main                                 │
│  Lane folder is kept; Clean up is offered after MERGED & VERIFIED    │
│ ☐ I approve committing these 4 files, merging into main and          │
│   running the commands above                                         │
│                                   [Cancel]   [Approve & merge]       │
└──────────────────────────────────────────────────────────────────────┘
```
**S9 — Merge progress (live journal).**
```
┌ Merging csv-export → main ────────────────────────────────┐
│ ✓ Re-checked approved changes                              │
│ ✓ Committed on yf/csv-export (4f2a9d1)                     │
│ ✓ Merge commit prepared (b81c0e7), no conflicts            │
│ ● Running npm test in the lane…  2 min                     │
│ ○ Fast-forward main   ○ Verify   ○ Knowledge   ○ Clean up  │
│ Merge queue: login-page waits (approved)                   │
└────────────────────────────────────────────────────────────┘
```
**S10 — Outcomes.**
```
✓ MERGED & VERIFIED  main @ b81c0e7 · required checks passed · knowledge integrated (c2d4e6f) · lane kept  [Clean up]
⛔ Blocked: conflict in src/ui/menu.js with main  [Send back to the agent] [I'll integrate by hand] [Cancel]
⛔ Blocked: tests failed on the merged result (main unchanged)  [View log] [Send back to the agent]
⚠ Merged, not verified: shared check failed  [View] [Re-run checks]  Undo yourself: git revert -m 1 b81c0e7
⏸ Interrupted (console restarted at step "Run tests")  [Continue merge] [Abandon]
```
**S7 — Item page.** Unchanged chat; a line above it: "In queue · 2 of 3 · next: PF-0122" or "Lane login-page"; the existing attention call-out now counts all lanes.

**S8 — Usage limit.** Banner in Agents view: "Codex reached its usage limit (try again at 18:40). 2 lanes paused. [Continue later] [Move remaining tasks to Claude Code]".

Large projects: Agents view groups by project and lane, the inbox sorts by oldest waiting, filters (needs-you / working / done), and the Worktrees page becomes the lane review entry point (no duplicate page).

### Acceptance Criteria

The authoritative list is AC-001…AC-044 for REQ-001…REQ-029 in `requirements.yaml` (revision history kept). Provenance: SRC-0052…SRC-0055 and Q-001…Q-013. Summary by area:

- **Run Now:** AC-001, AC-002.
- **Queue:** AC-003…AC-007.
- **Parallel:** AC-008, AC-009, AC-010 (revised: full allowlist), AC-011, AC-012, AC-013 (revised: removal only after `verified`), AC-018 (revised: conflicts feed Review & Merge).
- **Review & Merge (SRC-0054):**
  - AC-021: readiness checks;
  - AC-022: review screen content;
  - AC-023: no commit or merge without a matching approval;
  - AC-024: exactly the approved files committed;
  - AC-025: developer's uncommitted and staged work untouched;
  - AC-026: no working tree ever half-merged;
  - AC-027: tests run on the exact merged tree before the target moves;
  - AC-028: post-merge verification + knowledge integration + record;
  - AC-029: DONE vs MERGED & VERIFIED shown separately;
  - AC-030: merge queue serialisation and moved target;
  - AC-031: conflicts never auto-resolved;
  - AC-032: failures stop without rollback and are explained;
  - AC-033: crash recovery without repeated steps;
  - AC-034: lane removal only after `verified`;
  - AC-035: hook, filter and config isolation;
  - AC-036: end-to-end lifecycle with real subscriptions.
- **Overall:** AC-014…AC-017, AC-019 (revised: Review & Merge negatives included), AC-020.
- **D8–D13 and validation (SRC-0055):**
  - AC-013/AC-034 revised: no automatic cleanup;
  - AC-023 revised: fresh approval on any material change;
  - AC-024 revised: verify-before-commit by tree equality;
  - AC-025 revised: staged home changes block, plus ignored, assume-unchanged and skip-worktree refusals;
  - AC-027 revised: required checks;
  - AC-038: hooks/CI and declared checks;
  - AC-039: integration record accuracy;
  - AC-040: one merge commit, no rewriting;
  - AC-041: crash after main moved;
  - AC-042: literal pathspecs;
  - AC-043: open risks R1–R10 closed or the guarantee withdrawn;
  - AC-044: Run Now and Queue Git behaviour unchanged.

Negative test matrix (REQ-015 / AC-019; revised):

| Area | Cases |
|---|---|
| Git safety | Planted `post-checkout`, `pre-commit`, `commit-msg`, `post-merge` hooks and a repo-config `core.hooksPath` never run. Changed `.git/config`/`info/attributes` after lane creation blocks the merge. Slug, path and oid injection is refused (`..`, leading `-`, spaces, NUL, unicode, symlinks, in-repo or in-`.git` lanes dir). Test 51 rejects any mutating subcommand outside `git-ops.js`, any `--force`/`-f`, `add .`/`commit -a` on a real index, `merge` other than `--ff-only <oid>`, and every forbidden command. |
| Commit scope | An untracked `notes.txt` in the lane left unticked is not committed. Secret-flagged files are excluded by default. An agent-staged extra file makes the index tree differ from the approved tree and blocks the commit. The developer's unstaged and untracked home changes survive the merge and the knowledge commit byte-for-byte; staged home changes block before step 2. A file changed after approval → re-validation fails and nothing is committed. |
| Merge | A conflict in the preview and in step 3 → blocked, with no working tree or ref changed. Target moved between approval and merge → re-preview (D8). A dirty home file on M's paths → refused before step 2. An untracked home file colliding with a new path → refused. A test failure on M → target unchanged. |
| Concurrency | Two approvals for two lanes at once → serialised, the second re-previewed. Double-clicked Approve → one journal. A second console → read-only, cannot execute. Inbox and chat answering the same request → one applies. Two starts for one task → one session. |
| Crash recovery | Kill after each journal step 1–11 → restart shows `interrupted`, Continue completes without repeating a done step (asserted by commit counts and ref values), Abandon changes nothing. Corrupt journal → shown as unreadable, nothing executes. Queue crash cases as before. |
| Transaction (SRC-0055) | A file named `*.js` and one named `:(top)a` commit only themselves. Staged change in home → blocked before step 2. Ignored file at a path T adds → blocked. `assume-unchanged`/`skip-worktree` on a changed path → blocked. Agent-staged extra entry in the lane → G6 inequality blocks before commit. Main moved after approval → fresh approval required, nothing committed. Dry-run outcome ≠ approved → stop before main moves. Kill after step 7 before step 9 → `merged · not verified`, Continue completes, never `verified` without the record. `commit.gpgSign=true` → M signed or the step stops. |
| Preservation | Before/after hashes of `.yallaflow/work`, `context`, `sources`, the developer's uncommitted files and the index entries of unrelated paths, around every manager, lane and merge operation. |

### Unresolved Items

D8–D13 were answered by the owner on 2026-11-09 (SRC-0055) and are folded into FR13, FR22–FR24, FR29, FR30 and FR32 (see Confirmed Decisions). No owner decision is open. The unverified safety guarantees are listed as open risks R1–R10 in *Git Transaction Validation*. They are not treated as proven.

Follow-ups verified during implementation (not owner decisions): the Codex ACP permission-timeout experiment (D4); the codex-acp permission payload fields; a squash/rebase integration done by hand is not an ancestor, so YallaFlow will not remove that lane; more than two lanes stays experimental (D5).

**Checkpoint C — exact proposed Git allowlist (revised for SRC-0054).**

All entries are in `src/execution/git-ops.js` only. Every call has these properties:
- prefix `git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.untrackedCache=false`;
- env `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`;
- argv only, no shell, a timeout;
- `<path>` is absolute and validated, `<oid>` matches `^[0-9a-f]{40,64}$`, `<branch>` is `yf/<slug>`;
- `<pf>` is a private NUL-separated pathspec file and `<msg>` a private message file, both under `.yallaflow/local/execution/tmp/`.

| # | Exact shape | Runs in | Effect | When |
|---|---|---|---|---|
| G1 | `worktree add -b <branch> <path> <oid>` | home | new branch ref + new checkout | lane creation (D2) |
| G2 | `worktree remove <path>` | home | deletes a clean lane folder; branch kept | explicit Clean up only (D12) |
| G3 | `merge-tree --write-tree --name-only --no-messages -z <oid> <oid>` | home | objects only | preview and step 3 |
| G4 | `read-tree <oid>` with `GIT_INDEX_FILE=<tmp>` | lane | private temp index only | preview, re-validation |
| G5 | `add -A --pathspec-from-file=<pf> --pathspec-file-nul` with `GIT_INDEX_FILE=<tmp>` | lane | private temp index + blobs | preview, re-validation |
| G6 | `write-tree` (temp index, or the real index for the equality check) | lane/home | objects only | preview; before every commit |
| G7 | `commit-tree <oid> -p <oid> [-p <oid>] [-S] -F <msg>` | lane/home | unreferenced commit object | preview C′; merge commit M |
| G8 | `add -A --pathspec-from-file=<pf> --pathspec-file-nul` (real index) | lane; home (YallaFlow paths only) | stages listed paths only | steps 2 and 10, after approval |
| G9 | `commit -F <msg>` (no pathspec; only after the G6 equality check) | lane; home | commits exactly the verified index | steps 2 and 10, after approval |
| G10 | `merge --ff-only <oid>` | lane, then home | fast-forward only; refuses to overwrite local changes | steps 4 and 7, after approval |

Every call also uses `--literal-pathspecs`. `commit --only` is no longer used: verify-before-commit (G6 equality, then G9) gives a checkable guarantee, instead of relying on how `--only` handles a partially staged index.

Additional rules:
- G8–G10 are callable only with an approval record whose plan hash matches (asserted in code and tests).
- G4–G6 refuse to run without `GIT_INDEX_FILE` pointing into `tmp/`.
- G8/G9 in home accept only paths inside the YallaFlow-owned set written by steps 8–9.
- Read-only commands already allowed stay as they are: `status, rev-parse, diff, ls-files, ls-tree, check-ignore, symbolic-ref, config (--get only), cat-file, merge-base`.

Declined or still forbidden everywhere: `push`, `pull`, `fetch`, `rebase`, `reset`, `revert`, `cherry-pick`, `stash`, `clean`, `checkout`, `switch`, `restore`, `branch` (any form), `tag`, `update-ref`, `gc`, `prune`, `worktree prune`, `merge` without `--ff-only <oid>`, `commit -a`, `add .`/`add -A` on a real index without a pathspec file, `--force`/`-f`, `--no-verify` (hooks are already off), `config` writes, `remote`.

## Implementation Plan

Final plan for the approved specification (approved 2026-11-09, SRC-0056). Release target **v1.5.0**: Run Now, Queue, Parallel, Review & Merge, the Agents view with approvals, safe recovery, Git isolation and Shared Project integration. The plan answers the seven plan requirements of SRC-0056; section P1–P7 below maps each one.

### Global rules (apply to every milestone)

- Work happens on `feature/execution-modes`. Nothing is committed, pushed, tagged or published unless the owner asks; the owner's checkpoints are B (this gate), C (Git permissions), D (publishing).
- Each milestone ends with: `npm run check` green (Node 20/22/24 in CI later), `yallaflow doctor` healthy, the packed tarball reinstalled globally for the owner's local testing, and a progress checkpoint on PF-0112 with evidence.
- No mutating Git code (`src/execution/git-ops.js`) and no change to test 51 before Checkpoint C is approved.
- Every unproven safety assumption stays an open risk (R1–R10 plus any found later) until an M3a experiment and a permanent test prove it.
- **Stop rule:** when any safety assumption fails, the work stops at that point, the finding is recorded on PF-0112 (limitation or ruling), and the affected design goes back to the owner before any workaround. The stop conditions are listed in P5.

### Sequence

`Plan gate (B) → M3a experiments → Checkpoint C → M0 → M1 → M2 → M3 → M4 → Checkpoint D`

- M3a runs first, because its results can change the Git design. If an experiment refutes an assumption, the design change returns to the owner at Checkpoint C before any Git code exists.
- M0 and M1 contain no mutating Git. They may start while Checkpoint C is waiting for the owner. M2 and M3 never start before C is approved.

### M3a — Git transaction experiments (disposable repositories only; done 2026-11-09, V-001)

**Objective.** Turn R1–R10 and the plan requirements on filters, helpers, signing, hooks and configuration into executed evidence, then into permanent regression tests.

**Isolation.**
- Each experiment creates its own throwaway repository with `git init` under `<scratchpad>/m3a/<run-id>/<experiment>/`, never in or near a project checkout.
- It runs with `HOME`, `XDG_CONFIG_HOME` and `GIT_CONFIG_GLOBAL` pointed at experiment-local files, and `GIT_CONFIG_NOSYSTEM=1`, so the owner's real Git configuration, keys and credentials are never read or changed.
- Throwaway GPG/SSH signing keys are generated inside the experiment folder.
- There is no network access and no remote.
- The scripts are plain Node (argv `spawnSync`, no shell). They live in the scratchpad during the experiment. A summary with commands, exit codes and observed results is recorded on PF-0112 as runtime evidence (`yallaflow verify` / checkpoint evidence). Raw experiment folders are deleted only by removing the run's own scratch directory.

**Experiments.** Each returns PASS/FAIL against a stated expectation:

| # | Proves | Expectation | Risk |
|---|---|---|---|
| E1 | Temp index vs real index ids | Tree from `GIT_INDEX_FILE` temp index (`read-tree`, `add -A --pathspec-from-file`, `write-tree`) equals the real-index tree for text, binary, CRLF with `core.autocrlf`/`.gitattributes eol`, executable bit, symlink, empty and deleted files | R1 |
| E2 | Agent-staged extra entries | Staging approved paths in a real index that already holds extra staged entries makes `write-tree` ≠ approved tree; nothing is committed by the procedure | R2 |
| E3 | Fast-forward preserves unrelated work | `merge --ff-only <oid>` keeps unrelated modified, untracked and ignored files byte-identical; refuses (exit ≠ 0, no change) when a modified file overlaps; refuses or overwrites for an untracked file at an added path (observed result recorded); ignored file at an added path (observed); `assume-unchanged` and `skip-worktree` on changed paths (observed); staged changes present (observed) | R3 |
| E4 | Deterministic knowledge integration | `shared integrate --dry-run` in a lane at M equals the real `shared integrate` result in the home checkout at M, for two lanes and for a parallel fact change (blocked case) | R4 |
| E5 | Hook isolation | Planted `post-checkout`, `pre-commit`, `prepare-commit-msg`, `commit-msg`, `post-commit`, `post-merge`, `reference-transaction` hooks (in `.git/hooks`, in a repo-config `core.hooksPath`, and in a `.husky/` path) write marker files; with `-c core.hooksPath=/dev/null` no marker appears for `worktree add`, `commit`, `merge --ff-only`, `worktree remove` | R5 |
| E6 | Signing | With `commit.gpgSign=true` and a throwaway key: `commit` and `commit-tree -S` produce signed commits; with a failing `gpg.program`, both fail with no ref change; `commit-tree` without `-S` under `commit.gpgSign=true` (observed, to decide whether `-S` must always be explicit) | R6 |
| E7 | Kill during fast-forward | Kill `merge --ff-only` while it updates the working tree (large tree, process killed at intervals); record resulting states (HEAD, index, files, leftover `index.lock`) to define the detection and manual-recovery text | R7 |
| E8 | Literal pathspecs | Files named `*.js`, `a?b`, `[x]`, `:(top)y`, `-n`, with spaces and newlines: `--literal-pathspecs` + NUL pathspec files stage exactly those paths | R9 |
| E9 | Git version gate | `merge-tree --write-tree` absent on Git < 2.38 is detected by a version probe (simulated with a wrapper that reports an old version) | R10 |
| E10 | Filters | A `filter.x.clean/smudge/process` driver writing a marker: confirms when `add`, `write-tree` (no), `merge-tree` (observed), `merge --ff-only` (smudge) and `worktree add` (smudge) execute it; LFS-style pointer behaviour without the LFS binary (fails cleanly?) | new R11 |
| E11 | Merge drivers and diff helpers | A `merge.x.driver` in config + `.gitattributes merge=x` — does `merge-tree --write-tree` run it? `diff.external`, `diff.x.textconv`, `GIT_EXTERNAL_DIFF` are never run with `--no-ext-diff --no-textconv` | new R12 |
| E12 | Other external helpers and environment | With hostile `core.pager`, `core.editor`, `GIT_EDITOR`, `GIT_PAGER`, `core.askPass`, `credential.helper`, `core.sshCommand`, `include.path`, `GIT_CONFIG_PARAMETERS`, `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` set in the parent environment: the sanitised git-ops environment runs none of them and operates on the intended repository only | new R13 |
| E13 | Commit content | `commit -F` after the equality check records exactly the approved tree; the developer's identity is used; the message is byte-exact (no cleanup surprises with `#` lines — `--cleanup=verbatim` evaluated) | R2 |
| E14 | Concurrency at Git level | Two processes attempting the knowledge commit or fast-forward on one checkout: one wins, the other fails on `index.lock`/ref check without corruption | — |
| E15 | Worktree remove | `worktree remove` refuses dirty and untracked trees; observed behaviour for ignored files (deleted?) to confirm the FR13 ignored-file guard is required | — |

**Permanent regression tests.** Every PASS becomes a test in the repository:
- `test/git-transaction.test.js` runs raw Git in temp repositories inside the test's own temp directory, with the same isolated environment.
- After M3, the same properties are asserted again through `src/execution/git-ops.js` in `test/execution-merge.test.js`.
- A FAIL triggers the stop rule: the dependent guarantee is withdrawn or the design is changed, and Checkpoint C presents the change.

**Added by Checkpoint C (SRC-0058):** permanent OpenPGP signing test with an isolated `GNUPGHOME` (A5, AC-047); verified-platform gate test (AC-045); filter and merge-driver blocking tests (AC-046); argument-validation table test (AC-050).

**Done when:** all experiments have a recorded result, every PASS has a test planned with its file and name, and every FAIL has a proposed design change. AC-043 tracks this.

### Checkpoint C — Git permissions (owner)

Presented after M3a. Contents:
- the M3a results;
- the final `git-ops.js` API: one named function per allowed shape G1–G10, plus the read-only helpers;
- the sanitised environment and `-c` set;
- the trust policy for filters and merge drivers;
- the exact diff to test 51.

Only after the owner approves are `src/execution/git-ops.js` and the test 51 change written.

### M0 — Foundation; Run Now through the manager

- **New `src/execution/model.js`.** Pure state machines for task, run, lane and integration (FR5, FR5a, FR23 states), with no I/O.
- **New `src/execution/store.js`.**
  - `runs.json` (`yallaflow.execution/1`) and `events.jsonl`, written atomically through `safeWriteFile` and `safeAppendFile` (`src/agents/local-files.js`).
  - Single writer: only the holder of the home checkout lock (`src/agents/checkout-lock.js`).
  - Unreadable files are reported and never overwritten.
  - On load, everything `starting`/`working` becomes `interrupted`.
- **New `src/execution/manager.js`.**
  - Write-ahead task claims with attempt numbers.
  - Calls into the bridge: `activate`, `startCodex`, `resumeCodex`, `message`, `end`, `cancel`.
  - Refreshes snapshots on workspace `change`.
  - DONE + `cleanup.complete` detection.
- **`src/agents/bridge.js`.**
  - A manager subscription for agent events and cleanup results.
  - `permissionTimeoutFor(project)` reading a per-project setting; the default stays 5 min (D4).
  - Behaviour is otherwise unchanged.
- **`src/agents/codex.js`, `src/agents/events.js`.** Permission `paths[]` and `command` from ACP `toolCall.locations` / `rawInput`, when present.
- **`src/console/server.js`.**
  - Manager wiring and `GET /api/execution`.
  - `EXEC_ROUTE` for `run`, `pause`, `resume`, `cancel`, `reorder`, `skip`, `retry`, `next`, with the same token, Origin, Content-Type and `confirmed` checks as `WRITE_ROUTE`.
  - Refused in `--read-only` mode.
- **`resources/console/app.js`, `app.css`.**
  - Agents tab (S5): lanes across projects, the inbox, and session controls (FR19).
  - Richer `permCard` with paths, command and time left.
  - The bell counts all lanes.
  - Start keeps its 1.4.2 path and records a one-task run.
- **Experiment (real Codex, owner's subscription).** Hold a permission request open for 5, 15, 30 and 60 minutes. Record whether codex-acp or app-server times out or cancels. Capture one real edit-permission payload. The results feed D4 and AC-015.
- **Tests.**
  - `test/execution-model.test.js`: the full transition table.
  - `test/execution-store.test.js`: atomic writes, corrupt file, restart → interrupted, single writer.
  - `test/console-execution.test.js`: routes, auth, Origin, read-only.
  - A recorded call-sequence test proving that Start is identical to 1.4.2 (AC-001).
  - The existing agent and console tests stay unchanged.
- **Verify:** `npm run check`; the browser check of the Agents tab in AR/EN.

### M1 — Queue

- **`manager.js`.**
  - Sequential scheduler with a fresh session per task.
  - Advances only on snapshot DONE + session ended + cleanup complete (D7).
  - Block mapping (FR6–FR8), cancel after current / now, reorder, skip, retry.
  - Provider-wide usage-limit pause; switching the remaining tasks to another provider.
  - Claude tasks are "assisted" and never advanced automatically.
- **`app.js`.** Selection checkboxes, the action bar (S2), the run sheet (S3, timeout choices only as proven in M0), the queue line on the item page (S7), the limit banner (S8).
- **Tests (fake ACP adapter, `test-support/fake-acp-agent.mjs`).**
  - 3-task queue.
  - Gate, question and approval blocks.
  - Limit pause.
  - Crash after claim / mid-turn / during cleanup.
  - Double Resume.
  - Two consoles.
  - Same item queued twice.
  - Preservation hashes.
  Covers AC-003…AC-007, AC-017 and AC-044.

### M2 — Parallel lanes (after Checkpoint C)

- **New `src/execution/git-ops.js`.**
  - G1–G3 plus the read-only helpers.
  - Sanitised environment (P2).
  - `-c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.untrackedCache=false`, `--literal-pathspecs`, `--no-pager`.
  - A timeout on every call.
  - Argument validators for slug, absolute path and oid.
- **New `src/execution/lanes.js`.**
  - Preconditions: Git ≥ 2.38, Shared Project enabled at the base commit (`cat-file`), lanes dir `<repo-parent>/<repo>.lanes/` validated by realpath, no symlinks, outside the repo.
  - Lane markers.
  - The configuration fingerprint (P2) pinned at creation.
  - Registry `parent`/`lane`.
  - Setup hand-off to `src/console/setup.js`.
  - FR13 Clean up guards; never automatic (D12).
- **Shared enable from the console (FR13a).** Runs `yallaflow shared enable --dry-run`, then the confirmed `shared enable`, with refusals while sessions are live, off the integration branch, or with dirty tracked `.yallaflow`.
- **`src/console/registry.js`** (optional fields); **`src/console/worktrees.js`** (lane metadata, `diff --name-only <base>`).
- **`app.js`.** S4, lanes in the Agents view, Projects grouping, "experimental" above 2 lanes.
- **Tests.** The test 51 extension, and `test/execution-worktree.test.js`: path, slug and oid injection, planted hooks, lanes-dir refusals, `maxLanes` race, Clean up guards, no automatic removal. Covers AC-008…AC-013 and AC-035 (lane part).

### M3 — Review & Merge (after Checkpoint C)

- **`git-ops.js`** adds G4–G10, each callable only through `merge.js` with a matching approval.
- **New `src/execution/review.js`.** Readiness FR20 (all eight checks), the change set with Node-computed blob ids, the secret scan (`containsSecret`), the approved-tree build, the conflict preview, home pre-checks (staged, overlap, `lstat`, `ls-files -v -t`), detected hooks and CI, and the plan with its hash.
- **New `src/execution/merge.js`.** The approval record, the journal (FR23 steps 1–11 with before/after records), the merge lock and FIFO queue, D8 re-approval, outcomes FR25–FR28, and recovery (P4).
- **New CLI commands** (`src/cli.js` + `src/commands/integration.js`, `src/commands/execution.js`):
  - `yallaflow integration record <work-id> --merge <oid> --target <branch> --verification <file>`: atomic, append-only `work/<id>/integration.yaml`;
  - `yallaflow execution checks set --file <checks.json>`: `config.yaml` `execution.mergeChecks`.
  - Both go into state ownership, `doctor`, `work show`/snapshot (additive), and `docs/cli.md`.
  - Both raise the project's `yallaflow.minimumVersion` to 1.5.0 only with explicit confirmation (`--accept-minimum-version 1.5.0`, as hold/close did for 1.4.0). The console asks with a tick.
- **Server routes:** `review/prepare`, `merge/approve|continue|abandon|cancel`, `GET merges`.
- **`app.js`:** S6, S9 and S10, the DONE vs MERGED & VERIFIED badges, the merge queue, the merge-checks screen (FR32), the trust prompts for filters and merge drivers (P2).
- **Tests.**
  - `test/execution-merge.test.js`: every negative-matrix row, a crash after every journal step (P4), and the full ordering invariants (P3).
  - `test/integration-record.test.js`.
  - The M3a property tests re-asserted through `git-ops.js`.
  - Covers AC-018, AC-021…AC-035 and AC-037…AC-042.

### M3b — Disposable demonstration (REQ-036)

After M3, the complete Review & Merge implementation and its safety suite are demonstrated in disposable repositories (the same isolation as M3a), recorded on PF-0112, before automated merge is used on any real project. A newly discovered safety issue is reported to the owner before the affected operation proceeds.

### M4 — Hardening, documentation, end-to-end acceptance

- **Docs.**
  - `docs/execution-modes.md`: lifecycle Start → Execute → Review → Approve → Merge → Verify; states; recovery; manual recovery for R7.
  - `docs/security.md`: threat model T1–T18, allowlist, trust policy, open risks.
  - `docs/console.md`, `docs/agents.md` (Claude Team limitation), `docs/shared-projects.md`, `docs/cli.md`.
  - A new `docs/upgrading-to-v1.5.0.md`, `CHANGELOG.md`, README.
  - `package.json` → 1.5.0.
- **Browser checks:** S1–S10 in Arabic and English, light/dark, phone width.
- **E2E acceptance:** P7.
- **Release checks:** `npm audit` (the residual stays documented), pack, isolated-prefix smoke, delivery convergence for AC-001…AC-044, code review.
- Then **Checkpoint D**.

### M5 — Checkpoint D release blockers (owner, 2026-11-10, SRC-0060)

The owner did not approve v1.5.0 for release at Checkpoint D. Two blockers remain: an independent review and a real E2E.

1. **Phase 1, independent review (REQ-041, AC-057).**
   - Independent reviewers in a separate context. Each works on its own isolated copy of the repository, and the real repository is made read-only while they run (the isolation rule).
   - They review the areas the owner listed.
   - The author verifies each finding by reproducing it. Confirmed findings are fixed with a regression test, and the relevant tests are rerun.
2. **Phase 2, release preparation (REQ-042, AC-058).**
   - Arabic for the execution server messages.
   - README for 1.5.0.
   - A backward-compatibility check against 1.4.2 workflows.
   - A packed install checked with agents off and on.
   - A full suite run on the final tree.
3. **Phase 3, real E2E (REQ-040, AC-056).** Runs once the Codex subscription limit resets, and only in disposable repositories. It needs no API keys and incurs no API charges.
4. **No commit or push until the owner approves** the findings, the fixes and the test results. No merge to main, tag, GitHub Release or npm publish. Then return to Checkpoint D.

### P1 — M3a experiments and permanent regression tests

Covered by M3a (E1–E15 in disposable repositories with isolated Git configuration). Each PASS becomes a permanent test in `test/git-transaction.test.js` and is re-asserted through `git-ops.js` in M3. Each FAIL triggers the stop rule. The experiments run only after this plan gate is approved.

### P2 — Filters, external helpers, signing, hooks and repository configuration

| Mechanism | Policy |
|---|---|
| Hooks (all types, any location) | `-c core.hooksPath=/dev/null` on every call (E5). Detected hooks are listed. Required equivalents are declared as merge checks (FR32). Merging is blocked while hooks or CI exist and no checks are declared (D9). |
| fsmonitor, untracked cache | `-c core.fsmonitor=false -c core.untrackedCache=false`. |
| Clean/smudge/process filters (incl. LFS) | **Blocked, no override in v1.5.0 (A4, FR34).** Detected read-only from the effective config and the repository's attribute files; when referenced, automated lanes and merge are refused and the manual alternative is shown. E10 showed that filters run during worktree add, add and fast-forward. |
| Custom merge drivers | **Blocked, no override in v1.5.0 (A4, FR34).** E11 showed that `merge-tree` executes them. |
| Diff helpers | Diffs run with `--no-ext-diff --no-textconv`. `GIT_EXTERNAL_DIFF` is removed from the environment. |
| Pager, editor, prompts | `--no-pager`, `GIT_PAGER=cat`, `GIT_EDITOR=:` and `-F <msgfile>` (never an editor), `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS`/`SSH_ASKPASS` removed. |
| Network helpers (credential, ssh, proxies) | Never reachable: no network subcommand exists in the allowlist (test 51). Credential and SSH variables are stripped anyway (E12). |
| Inherited Git environment | Removed: `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` (except our temp index), `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT/KEY_*/VALUE_*`, `GIT_EXEC_PATH`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`. `LC_ALL=C` is set. `cwd` is always the validated checkout (E12). |
| Signing | `-S` is passed explicitly to `commit-tree` when `commit.gpgSign` is true (E6: `commit-tree` ignores the config). SSH signing is allowed. OpenPGP is allowed only with the permanent GPG test in the shipped suite (A5, FR35). Other formats are blocked. A failure stops with no ref change. |
| Repository configuration | A **configuration fingerprint** is a SHA-256 over `git config --list --show-origin --show-scope -z` (all scopes, includes resolved) plus `info/attributes` and the root `.gitattributes`. It is pinned at lane creation and checked at review preparation, at approval (part of the plan hash), and before every mutating step. Any change → stop (S2). |

### P3 — Ordering of merge, verification, knowledge integration and records

The order is fixed (FR23). Each arrow is a precondition enforced in `merge.js` and asserted by tests:

1. approval (plan hash)
2. → re-validate
3. → lane commit (index tree = A; then HEAD tree = A)
4. → merge commit M (tree = T)
5. → lane fast-forward to M
6. → required checks on M pass
7. → `shared integrate --dry-run` on M equals the approved outcome
8. → **main fast-forward to M** (HEAD = M, tree = T, unrelated files unchanged)
9. → post-merge checks (`doctor`, `shared check`)
10. → `shared integrate` (equals the dry run)
11. → `integration record` (state `verified`, atomic)
12. → knowledge commit (index tree = HEAD + YallaFlow paths; then diff check)
13. → state `verified`.

Invariants:
- main never moves before the checks pass on M and the integration outcome matches;
- the integration record is never written before the merge and knowledge integration succeed;
- `verified` is never shown before the knowledge commit is verified;
- Clean up is never part of this sequence (D12).

### P4 — Crash recovery and idempotency at every Git boundary

| Boundary (crash after…) | Detected on restart by | Continue does |
|---|---|---|
| approval recorded | journal | re-validate (fresh approval if anything material changed) |
| lane staging | lane index ≠ HEAD | re-run step 2 from the equality check |
| lane commit | `HEAD^{tree}` = A and `HEAD^` = reviewed lane HEAD | skip the commit |
| merge commit object | M not referenced; recomputed from T and parents | recreate M (object-only; unreferenced duplicates are harmless) |
| lane fast-forward | lane `HEAD` = M | skip |
| required checks | journal results; none recorded → re-run (read-only for Git) | run again |
| integration dry-run | recomputed (deterministic) | recompute |
| **inside the main fast-forward** | HEAD ≠ M but files on M's paths match M, or `index.lock` present | **stop** (S7); manual recovery text from E7; never reset or delete locks |
| main fast-forward | home `HEAD` = M | skip |
| post-merge checks | re-run (read-only) | re-run |
| `shared integrate` | existing bookkeeping (re-runnable by design) | re-run; must still equal the dry run |
| integration record | entry for M present | skip |
| knowledge commit | HEAD is a commit after M with the trailer and only YallaFlow paths | skip |
| queue claim/start/end | `runs.json` attempt, bridge session records, snapshot | `interrupted` → manual Resume; an item already DONE is marked done |

Rules:
- Every journal write is atomic.
- Nothing continues without the developer's Continue.
- A corrupt or missing journal → "state unknown", read-only diagnosis, fresh confirmation required.
- Every resumed step first checks "already done".
- Tests kill the process after every boundary and assert final ref values and commit counts (AC-033, AC-041).

### P5 — Stop conditions

On any of these, YallaFlow stops before the next mutating step. It leaves everything as it is (no reset, revert, checkout, lock deletion or ref move), records the reason in the journal, and shows it with the next safe action.

- **S1** Git < 2.38, or an unexpected Git exit code or output format from any command.
- **S2** The configuration fingerprint changed, or an untrusted filter or merge driver is present.
- **S3** Any equality check fails: approved tree, merged tree, HEAD/tree after a commit or fast-forward, the commit path set, or unrelated-file hashes.
- **S4** Main moved, or any material plan field changed (D8: fresh approval).
- **S5** Staged changes, an overlapping modification, an existing file at an added path, `assume-unchanged`/`skip-worktree`, an in-progress Git operation, a detached or sparse HEAD, or the wrong branch in home.
- **S6** A required check fails or cannot run; hooks or CI exist with no declared checks (D9).
- **S7** `index.lock` present, or partial fast-forward state detected.
- **S8** The integration dry-run outcome differs from the approved one, or the real integrate differs from the dry run.
- **S9** A signing failure, or a missing `user.name`/`user.email`.
- **S10** An unconfirmed secret-flagged file; a submodule change; a symlink out of the repo.
- **S11** A journal or store that is unreadable, or a single-writer violation (another console).
- **S12** An M3a experiment refutes a planned guarantee. This is a project-level stop: the design goes back to the owner.
- **S13** Agent side: a usage limit, permission timeout, crash or incomplete cleanup (queue blocks per D7).
- **S14** Unverified platform or Git version (A2, FR33): fail closed, manual operations only.
- **S15** A filter or merge driver is referenced (A4, FR34), or the signing format is not covered (A5, FR35).
- **S16** Any detected inconsistent Git state, before or after a mutation (A1, A3, FR37): stop with no automatic repair.

### P6 — Backward compatibility with v1.4.2

- **Run Now** keeps the same API calls and chat. This is proven by the AC-001 call-sequence test, and all existing tests pass unchanged.
- **Run Now and Queue** never commit or merge (AC-044, D11).
- **No migration** of existing state. New local files appear only when the features are used. `console.json` fields are additive and ignored by 1.4.2.
- The Agent Contract moves to **v12** (D14): it names `work/<id>/integration.yaml`. Existing projects are told to run `agent refresh`, which keeps content outside the managed block.
- **New tracked formats** (`integration.yaml`, `config.yaml execution.mergeChecks`) are written only after the developer confirms raising the project's minimum to YallaFlow 1.5.0. That uses the existing `minimumVersion` mechanism, so a teammate on 1.4.2 gets a clear "requires 1.5.0" message instead of misreading state.
- **Parallel and Review & Merge** require Shared Project Mode and Git ≥ 2.38. Projects without them see exactly the 1.4.2 console plus the Agents tab.
- **The checkout lock** and its file name are unchanged, so a 1.4.2 console and a 1.5.0 console still exclude each other on one checkout.
- **Upgrade notes:** `docs/upgrading-to-v1.5.0.md`.

### P7 — End-to-end acceptance with two real Codex agents (AC-036)

- **Environment.**
  - A disposable repository created for the test, outside any project: Node app with tests, Shared Project enabled, one declared merge check.
  - The packed 1.5.0 candidate installed in an isolated prefix.
  - The owner's ChatGPT subscription through codex-acp (no API key).
  - The console in a dedicated config (`YALLAFLOW_CONSOLE_CONFIG`).
- **Scenario.**
  1. Run Now: one task to DONE.
  2. Queue: three small tasks to DONE in order.
  3. Parallel: two lanes at once.
     - Lane A changes `src/price.js` function `total()`.
     - Lane B changes the same lines differently: the **deliberate conflict**.
     - Both reach DONE with independent approvals in the inbox.
  4. Review & Merge A: prepare → approve → checks on M → main fast-forward → knowledge integrated → MERGED & VERIFIED.
  5. Review B: **blocked: conflict** (main moved) → *Send back to the agent* (reopen). The agent integrates main into the lane and resolves under its own approvals → DONE → fresh review (D8) → approve → MERGED & VERIFIED.
  6. Clean up both lanes explicitly (D12). Branches remain.
- **Measured and recorded on PF-0112:**
  - the user typed no Git command;
  - timings per phase;
  - number of approvals;
  - unrelated-file hashes in home before and after;
  - `git log --graph` showing one merge commit per lane and the knowledge commits;
  - `shared check` PASS;
  - both `integration.yaml` records;
  - the usage-limit state if hit (it is not forced).
- **Pass:** every listed AC observed. **Fail:** the stop rule applies and the issue is fixed before Checkpoint D.

### Affected files (final)

- **New:**
  - `src/execution/{model,store,manager,lanes,git-ops,review,merge}.js`
  - `src/commands/{integration,execution}.js`
  - `test/execution-{model,store,worktree,merge}.test.js`
  - `test/{console-execution,integration-record,git-transaction}.test.js`
  - `docs/execution-modes.md`, `docs/upgrading-to-v1.5.0.md`
- **Changed:**
  - `src/agents/{bridge,codex,events}.js`
  - `src/console/{server,registry,worktrees}.js`
  - `src/cli.js`
  - the state-ownership map and `doctor`
  - `src/flow/snapshot.js` (additive)
  - `resources/console/app.{js,css}`
  - `test/shared-project.test.js` (test 51, after Checkpoint C)
  - `docs/{security,console,agents,shared-projects,cli}.md`, `CHANGELOG.md`, `README.md`, `package.json`
- **Unchanged:** the Agent Contract (v11), existing commands and workflows, existing state formats.

### Risks

- The open risks R1–R13 are tracked until M3a closes them.
- **Subscription usage:** two lanes plus the E2E use the owner's ChatGPT plan.
- **Approval fatigue.**
- **Lane setup cost.**
- **Shared Project prerequisite.**
- **Squash-merged lanes** need manual removal.
- **Console must stay open.**
- **Claude Team channels** are off: lanes there are assisted only.
- **Only two lanes are proven;** 3–4 are labelled experimental.
- **`app.js` growth:** handled with separate render functions and no framework.
- **Schedule:** M3 is the largest milestone, and M3a may move work into a design change (S12).

## Implementation Notes (M0–M3, 2026-11-09)

Status: M0, M1, M2 and M3 are implemented on `feature/execution-modes` (uncommitted). M3b (disposable demonstration) is done in the browser on throwaway repositories. M4 and Checkpoint D remain.

**Code.**
- New `src/execution/`:
  - `model` (task/run state machine);
  - `store` (runs.json);
  - `manager` (Run Now recording, queue scheduler, Agents view, provider-neutral);
  - `messages`;
  - `git-ops` (the only mutating-Git module, G1–G10);
  - `lanes` (sibling `<repo>.lanes`, marker, Clean up guards);
  - `review` (readiness FR20, plan hash);
  - `merge` (11-step journal, idempotent resume, merge lock, no rollback);
  - `integration` (integration.yaml, execution.mergeChecks).
- New `src/commands/integration.js`: `integration record|show` and `execution checks set|show`.
- Bridge additions: subscribe, glance, ownsCheckout, claimFor, a provider-neutral face, permission scope. Codex `toolScope`.
- Console: routes for execution, parallel, lane-cleanup, shared-enable and merge-*, plus GET for execution, lanes, review, merges and the shared preview. Lane identity comes from the lane's marker.
- UI: the Agents tab, inbox, queue sheet, parallel sheet, Review & Merge (S6/S9/S10), Clean up.
- Version moved to 1.5.0 (in progress).

**Tests added:** `git-transaction` (18, incl. OpenPGP), `execution-model`, `execution-queue`, `execution-gitops`, `execution-lanes`, `execution-merge` (incl. a crash after each of the 11 steps), `console-execution`, test 51 strengthened plus 51b scanner self-test (`test-support/git-scan.js`).

**Defects found by tests or the demo and fixed before use:**
1. A failed task could turn done on a later DONE signal (final states now stay final).
2. Resuming a merge did not recognise a lane commit below the merge commit, nor main already containing M under the knowledge commit.
3. A merge interrupted in state `merged` was not recovered as interrupted.
4. **git-ops trimmed NUL-separated Git output**, so the first status record (" M path") lost its first path character. The approved path set would have missed a file. Found in the browser demo; all `-z` reads are now untrimmed, with a regression test (leading-space file names).
5. The literal `'clean'`/`'checkout'` labels were caught by the new test 51; labels renamed.
6. Lane requests created with `start -- text` kept `--` in the title (an existing CLI behaviour, out of scope); lanes use `start --keep-active -- text`.

**Open owner decision:** the Agent Contract must name `work/<id>/integration.yaml` (test 54), which needs contract v12 against plan P6. See the ruling.

**M0 experiment (D4):** a real codex-acp 2.5.0 edit-permission request carries the file path (absolute; shown relative). The request stays open with the session working for at least 45 minutes (run in progress; result recorded when it ends).

## Implementation Notes (M4, 2026-11-10)

- **D14:** Agent Contract v12 names `integration.yaml`; this repository's AGENT.md was refreshed with the command. **D15:** approval wait of 5/15/30/60 minutes per project, default 5, expiry denies.
- **Docs:**
  - new `docs/execution-modes.md` and `docs/upgrading-to-v1.5.0.md`;
  - `docs/security.md`: the "no source-control mutation" guarantee is restated for 1.5.0, and a new "Review & Merge and Git" section lists the G1–G10 operations, the fail-closed rules and the residual risks;
  - additions to `docs/console.md`, `docs/agents.md`, `docs/cli.md` and `docs/shared-projects.md`;
  - CHANGELOG 1.5.0 entries.

  The README is left for the release.
- **Evidence:**
  - V-006: full suite 1094/1094 after the post-V-005 UI changes;
  - V-007: pack smoke into an isolated prefix and HOME (294 files, no test or state files; version, doctor, contract v12, and the minimum-version confirmation for merge checks).
  - In the smoke console, execution POST routes answer 405 while agents are off.
- **Not done:** the real two-Codex E2E. It is blocked by the Codex subscription usage limit until 2026-11-14 02:42 (a recorded limitation). The safety tests ran in disposable repositories with the fake ACP agent. A demonstration with real agents is still owed before automated merge is used on a real project (Checkpoint C additional rule).

## Independent Review Findings (Phase 1, 2026-11-10, SRC-0060)

**Review setup:**
- Four independent reviewers, each in its own context and on its own isolated copy of the repository.
- Their areas: Git layer, merge and review, manager and agents, console and compatibility.
- The real repository was read-only while they ran. Afterwards its HEAD, refs, reflog, index, status and content were verified unchanged.

**Incident:** one reviewer's SSH-signing repro added a throwaway key to the user's real ssh-agent. The reviewer removed it, and `ssh-add -l` shows only the user's 4 keys. Future reviewers will also be isolated from SSH and GPG agents.

Status legend:
- **R:** reproduced by a reviewer.
- **r:** reasoned only.
- **Fix:** the regression test that proves the fix (filled in as fixed).

### High
- **H1 (R) Merge checks come from a file the lane agent can write.** Merge checks are taken from the lane's own `evidence/verification.json`, and only the program's base name is shown. An agent can therefore make an arbitrary executable run with the developer's privileges after approval. (review.js argvChecks, app.js prog)
- **H2 (R) A lane can replace its `.git`.** Git probes (status, add, read-tree) then run against a foreign repository, and its filters execute in the console. There is no common-dir check except in G2. (git-ops statusEntries/approvedTree/head)
- **H3 (R) Filter and driver detection fails open.** It misses these sources: an ignored `.gitattributes`, an index-only `.gitattributes`, the default XDG/HOME attributes file, the system attributes file, and `core.attributesFile` without `--type=path`. (git-ops outOfTreeAttributes/externalDrivers)
- **H4 (R) "Read-only" Git operations run filters and drivers.** `previewMerge` (merge-tree driver), `approvedTree` (`add`) and `statusEntries` run them without `assertAutomationAllowed`, and review keeps going after a driver block.
- **H5 (R) Clean up deletes hidden local edits.** Local edits to skip-worktree or assume-unchanged files are deleted, because `status` and `worktree remove` do not see them. (lanes cleanupCheck)
- **H6 (R) A staged deletion is mishandled.** A staged deletion (`git rm`) is dropped from the approved tree, either silently or as a misleading block later. Non-UTF-8 paths are dropped silently. (git-ops stageablePaths)
- **H7 (R) A repository can commit `runs.json`.** A committed `.yallaflow/local/execution/runs.json` is loaded and run, with its own first message to the agent. `lanes.json` and `lane.json` are not guarded either. (store loadRuns, lanes readMarker/readLanes)
- **H8 (R) Checks run in the lane folder, not on the exact merged tree.** Uncommitted or excluded lane files can make a merge VERIFIED that fails on main. (merge checks step)
- **H9 (R) Committed secret-looking files are merged without a warning or tick.** (review.js approved/secrets)
- **H10 (R) Continue and target-ff do not re-run the main-checkout readiness checks.** `merge --ff-only` overwrites ignored files, in both main and the lane. (merge revalidate/target-ff/lane-ff, git-ops fastForward)

### Medium
- **M1 (R)** Markup injection in the Agents view from unvalidated `runs.json` and journal fields. CSP blocks scripts, but a click-hijack is possible through delegated `data-*` actions. (app.js xRun/xLane fallbacks)
- **M2 (R)** A `--read-only` or second console runs `recover()` and rewrites journals. This also breaks a merge another console is running.
- **M3 (R)** A queued, resumed or retried task starts without re-checking whether its item is DONE, closed or on hold.
- **M4 (R)** A failed write-ahead claim does not stop the session from starting.
- **M5 (R)** Concurrent lane creation breaks the lane limit and loses `lanes.json` records.
- **M6 (R)** The usage-limit pause leaks on skip or cancel and is forgotten after a restart.
- **M7 (R)** File names from the repository go verbatim into the conflict send-back prompt, which allows instruction injection. `integrationBranch` is not validated.
- **M8 (R)** Clean up has a time-of-check/time-of-use gap: `worktree remove` deletes ignored files written after the check.
- **M9 (R)** Test 51's static scan is bypassable: double quotes, shell strings, variables, other wrappers. `config` and `symbolic-ref` are not option-restricted.
- **M10 (R)** `gitEnv` strips `SSH_AUTH_SOCK`, so signing with an agent-held key is impossible. This is functional and fails closed.
- **M11 (R)** The knowledge step integrates every pending delta in main, not only this lane's.
- **M12 (R)** The developer's edits to YallaFlow-owned files made during a merge are swept into the knowledge commit.
- **M13 (R)** Lock contention leaves a merge stuck in `queued`.
- **M14 (R)** After a crash at the knowledge step, the VERIFIED record says `knowledge: []`.
- **M15 (r)** Canonical memory and the integration record are written without the workspace lock.

### Low
- **L1 (r)** `merge-sendback` has no server-side confirmation, and its reopen is not atomic.
- **L2 (r)** The lane marker can be forged in a repository.
- **L3 (r)** A `null` JSON body returns 500.
- **L4** The approver name is the repository's `user.name` (document it).
- **L5 (R)** Console Shared enable fails without a detectable default branch.
- **L6** The flaky "Queue end to end" test (5 s wait).
- **L7 (R)** A rename in the second status column is misparsed.
- **L8 (r)** `inProgress` misses `sequencer/`, `HEAD.lock`, ref locks and `REBASE_HEAD`. There is a race in `commitIndex`. `assertPaths` accepts directories.
- **L9 (R)** The permission card truncates long commands and path lists without a marker, and argv quoting is lost.
- **L10 (r)** Events are attributed per checkout, not per session. Minor manager issues: a stale run in the end-failure path, head-of-line blocking, `cancelAfter` on a paused run, and Run Now `paused/session-ended` blocking a queue.
- **L11 (r)** A target-ff failure after main moved is labelled `failed`.
- **L12 (r)** The integration record says `verified` before the knowledge commit succeeds.
- **L13 (r)** The same lane can be approved again while an earlier journal is resumable.
- **L14 (r)** `yallaflow integration record` accepts a record without checking the merge commit.
- **L15 (r)** Abandon on an unreadable journal overwrites it and throws.

### Fix status (2026-11-10)

Each fix has a regression test that reproduces the reviewer's scenario:
- `test/execution-review-fixes.test.js`
- `test/execution-queue.test.js` ("review …")
- `test/shared-project.test.js` 51b
- `test/execution-model.test.js`
- `test/console-execution.test.js`

The full suite passed afterwards: V-009, 1119/1119.

**High**

| Finding | Fix | Regression test |
|---|---|---|
| H1 | Agent-recorded checks are off by default, shown in full, and each needs its own tick. The plan records the source of each check. Declared checks come from the main checkout. | `review H1`; console e2e |
| H2 | `assertLaneOf`: the lane's `.git` pointer is checked both ways, and Git must report the same common dir and top level. It runs before any Git work in review, approvedTree, cleanupCheck and G2. | `review H2` |
| H3 | Attribute sources now include index blobs, untracked and ignored `.gitattributes`, `git var GIT_ATTR_GLOBAL/SYSTEM`, the XDG default, and `--type=path`. Every Git call neutralises each configured `filter.*` and `merge.*.driver` through `GIT_CONFIG_*`. | `review H3`, `review H3/H4` |
| H4 | approvedTree runs `assertAutomationAllowed`. Review does no Git object work after a platform or driver block. Neutralisation covers status and merge-tree. | `review H3/H4` |
| H5 | Hidden (skip-worktree or assume-unchanged) entries block Clean up, and G2 too. | `review H5` |
| H6 | Stageability is judged against the private index. Non-UTF-8 names stop with GIT_PATH_ENCODING. | `review H6` ×2 |
| H7 | `runs.json`, `lanes.json` and `lane.json` must pass `personalLocalFile`, and their shapes are validated. A lane's runs are stored in its home checkout (`lane-runs/<id>`). A lane's identity is confirmed by the home's lane list. | `review H7` ×2 |
| H8 | Unticked files block the review. The checks step requires a clean lane. | `review H8` |
| H9 | Committed secret-looking files block until ticked. The tick is bound in `plan.secretsAccepted`. | `review H9` |
| H10 | `homeBlockers` runs again right before target-ff, also on Continue. `merge --ff-only --no-overwrite-ignore`. | `review H10` ×2 |

**Medium**

| Finding | Fix | Regression test |
|---|---|---|
| M1 | Store validation. Every UI label fallback is escaped. | `review H7` |
| M2 | No recovery in read-only. Recovery is skipped while a live merge-lock holder exists. | `review M2/M13` |
| M3 | A fresh snapshot is read before each start. DONE, closed and on-hold items are skipped with a reason. | `review M3` |
| M4 | The claim must be saved before any bridge call. | `review M4` |
| M5 | Lane creation is serialised per home. | `review M5` |
| M6 | Limits are derived from tasks paused for usage-limit. | `review M6` |
| M7 | Repository names in the prompt are quoted data. Control characters are refused. The branch name is validated, and the agent lists the conflicts itself. Everything that can refuse is checked before the first reopen. | function check, console e2e |
| M8 | G2 lists the lane again immediately before removal. | `review M8` |
| M9 | The scan covers all quote styles, any function taking `'git'`, any wrapper first argument, shells, run-time programs (a reviewed list) and config/symbolic-ref/--output write forms. | 51b |
| M10 | The signing agent socket is passed for commit and commit-tree only. | Reasoned; no signing agent in the tests |
| M11 | `onlyWorkIds`. | `review M11/M14` |
| M12 | Owned files are checked clean before the knowledge step. The knowledge commit stages only files whose content hash matches what YallaFlow wrote. | `review M12` |
| M13 | Lock contention makes the journal interrupted. | `review M2/M13` |
| M14 | Integrated knowledge is read back from the memory records. | `review M11/M14` |
| M15 | The knowledge, record and commit steps run under the workspace lock. | Reasoned |

**Low**

| Finding | Status | Regression test |
|---|---|---|
| L1 | Fixed: confirmation, and pre-checks before any reopen. | console e2e |
| L2 | Fixed: `laneIdentity`. | — |
| L3 | Fixed: 400 for non-object bodies. | console e2e |
| L4 | Documented. | — |
| L5 | Fixed: the current branch is used when Git names no default. | — |
| L6 | Fixed: wider wait bounds. | — |
| L7 | Fixed. | `review L7` |
| L8 | `inProgress` markers and `assertPaths` fixed. **Accepted:** the `commitIndex` check-then-commit gap; a mismatch afterwards is still detected and stops. | — |
| L9 | Fixed: counted cut markers and quoted argv. | model test |
| L10 | **Accepted, not fixed** (low): per-checkout event attribution, a stale run in the end-failure path, head-of-line blocking, `cancelAfter` on paused runs, and Run Now `session-ended` blocking a queue. | — |
| L11 | Fixed: "moved" is decided from HEAD. A mismatch of unrelated files is not resumable (`noContinue`). | — |
| L12 | Mitigated: the stop reason says the integration record is uncommitted and not verified. | — |
| L13 | Fixed: only verified or abandoned journals allow a new approval. | `review M2/M13` |
| L14 | Fixed: the merge commit, its tree and the target ancestry are verified. | `review L14` |
| L15 | Fixed: unreadable journals are refused for abandon, and they block approval. | — |

**Phase 2**
- Arabic copies of every console-facing execution message (`src/execution/arabic.js`; coverage in `test/execution-arabic.test.js`). Latin runs are isolated left-to-right in the UI.
- README for 1.5.0 and a limitations section.
- Compatibility and packed install with agents off and on: V-008.

### Re-verification round 1 (independent, isolated copy, 2026-11-10)

**Held:** fixes 1, 4, 6, 7, 9, 10, 11 and 13 held.

**Bypassed (High, both reproduced):**
- **Code outside git-ops ran Git in a replaced-`.git` lane:** `personalLocalFile` and the console runner, through the CLI's plain `git status`/`diff`. A planted fsmonitor command ran.
- **`git status` recursed into a submodule** whose own config, which the lane agent can write, ran a clean filter.

**Partial:**
- `changedBetween` passed non-UTF-8 names through.
- Secrets in intermediate lane commits were not seen.
- Scanner gaps: Git or a shell by path, `cp['execSync']`, unchecked `-c` values.

**New:**
- Checks run in the lane next to ignored files that are not reviewed (Medium, owner decision).
- U+202E and other bidi characters in names (Low).

**Fixes:**
- `src/utils/git-safety.js` `SAFE_GIT` (`core.fsmonitor=false`, `core.hooksPath=/dev/null`, `diff.ignoreSubmodules=all`) on every Git call outside git-ops. git-ops' `GIT_PREFIX` also gets `diff.ignoreSubmodules=all`. This is a stricter prefix than the one approved at Checkpoint C; recorded as a ruling.
- The console runner `guard` runs `assertLaneOf` before any CLI child in a lane.
- Submodules (`gitlinks`) block lanes, review, Clean up and every mutating operation (`GIT_SUBMODULES`).
- `changedBetween` refuses U+FFFD.
- `blobsIntroduced` and `blobBytes` scan every blob the lane's commits introduced. History secrets need a tick, which is bound in `plan.secretsAccepted`.
- The lane's ignored entry names are shown and bound in `plan.laneIgnored`; the checks step stops if they changed.
- Bidi and line characters are refused in the send-back prompt and block the review.
- Scanner: Git or shells by path, exec by name, and an allowlist of `-c` values.

**Tests:** 6 regression tests ("re-verification: …"). Full suite V-011, 1125/1125. V-010 failed once on a timing wait under load; the fixture wait was raised.

**Still open (owner decision):** content of ignored files in the lane, such as `node_modules/.bin`, can be used by merge checks with the developer's permissions. The full fix runs checks in a fresh temporary worktree with dependencies installed from the lockfile. That is a new Git operation outside G1–G10 and needs owner approval.

**Accepted (low):**
- The G2 archive of `.yallaflow/local` happens before the final re-list (millisecond window).
- One extra `git config` read per git-ops call.
- Generic Arabic rules can translate phrases inside repository-supplied names (cosmetic).

### Re-verification round 2 (independent, isolated copy, 2026-11-10)

**Incident:** a reviewer's failed `cd` made three read-only Git commands run in the real repository. The repository was read-only, so nothing was written; the snapshot check afterwards shows HEAD, refs, reflog, index, status and content unchanged.

**Bypassed:**
- **High:** a `.gitmodules` entry with `ignore = none` overrode `-c diff.ignoreSubmodules=all`, so a submodule filter ran.
- **Medium:** the runner guard was disabled when the lane marker was deleted, because a lane was recognised from the marker.
- **Medium:** the secret scan missed three cases: a committed secret later edited without a commit, a merge commit adding the secret, and NUL-first content.
- **Low:** more invisible characters (U+061C, U+200B, C1).

**Fixes:**
- `--ignore-submodules=all` on every `status` and `diff` command line. Test 51 enforces it.
- Review and Clean up stop at a gitlink before any work-tree Git call.
- A lane is recognised from where it is (`<home>.lanes/<slug>`) and the home's `lanes.json`, never from the marker.
- `assertLaneOf` runs again in stage, commit, fast-forward and the checks step.
- The secret scan uses `git rev-list --objects --filter=object:type=blob <laneHead> ^base ^target`: every blob the lane adds to history is scanned (the first 1 MB, NUL-tolerant).
- One shared `INVISIBLE` character class, applied to changes, history names, ignored names and the send-back prompt.

**Tests:** 4 regression tests ("re-verification 2: …"). Full suite V-012, 1129/1129.

### Re-verification round 3 (independent, isolated copy, 2026-11-10)

The round ran with no isolation incident.

**Bypassed (reproduced):**
- **High:** the Team view of a lane trusted the lane's `.git` pointer, so a filter in a planted repository ran.
- **High:** a secret in an uncommitted file (NUL or 1 MB or larger) was merged.
- **Medium-High:** a committed `.env` was hidden when the same blob was also committed under another name.
- **Medium:** secrets in commit messages were not scanned.
- **Partial:** `SAFE_GIT` does not neutralise filters in CLI reads; this mattered for a redirected lane.
- **Partial:** the INVISIBLE class missed tag characters, variation selectors and space look-alikes.
- **Low:** tracked `.yallaflow/local` files escaped the approval.

**Fixes:**
- The console pins a verified lane's `GIT_DIR`/`GIT_WORK_TREE` for every CLI child (runner guard, structural lane identity, also for lanes not open in this console).
- git-ops pins verified lanes for all later calls (`PINNED`).
- The Team view of a lane lists the home's worktrees with pinned admin dirs.
- `describe()` uses the history scan rules.
- `pathsTouched` (`log --name-only --diff-merges=separate`) checks every path name.
- Every committed secret-looking change needs a tick.
- `commitTexts` scans messages and author fields; the lane commit message is checked.
- The INVISIBLE class is broadened (`u` flag).
- Tracked `.yallaflow/local` files block the review.

**Tests:** 3 regression tests ("re-verification 3: …"). Full suite V-013, 1132/1132.

**Open questions for the owner:**
1. **Threat-model assumption.** In a Git worktree, committing writes the home repository's common `.git` (objects, refs, config). If the Codex sandbox lets a lane agent write there, it could change the shared config and the config-based defences would not hold. This must be checked with real Codex in the E2E, after the limit resets. If writes are possible, the options are: deny lane agents write access to the common dir (they never need to commit), or accept the risk with documentation.
2. **Ignored-file content in merge checks** (see round 1).

### Owner decision SRC-0061 and the final focused review (2026-11-10)

**Implemented (REQ-043, AC-059):**
- Only declared merge checks run; agent-recorded commands are never run, even when a request names them.
- A lane with ignored files makes Automated Merge unavailable for that task, and the review shows manual steps.
- The checks step stops on ignored files.
- Agent Contract v12 carries the lane rules (behavioral guidance only); this repository's AGENT.md was refreshed.
- V-014: 1132/1132.

**Final focused review (one reviewer, isolated):**
- **Boundary C (data loss):** held for the main checkout.
- **Boundaries A and B: broken by H1 (High, reproduced).** Files the agent writes in `.yallaflow/local/` or inside any folder named `.git` are invisible to Git. They were present while the declared checks ran, and the merge still reached `verified`.

**Owner rule applied (stop the affected functionality):** Automated Merge is **off** in the shipped console.
- `MergeService` defaults to `automatedMerge: false`. approve and continue refuse with AUTOMATED_MERGE_OFF.
- Review shows the reason and "Merge by hand".
- The engine and its tests stay, switched on explicitly in the tests only.

**Also fixed:**
- **M1:** a nested `.git` folder blocks Clean up, which would otherwise delete its files unseen.
- **Low:** execution routes refuse a lane given as the home project.

**Accepted or open (Medium/Low):**
- **M2:** checks run in an agent-writable folder (moot while Automated Merge is off).
- Secret heuristic limits: the first 1 MB, UTF-16 content, raw commit headers.
- Agent-made symlinks are copied into the `.yallaflow/local` archive, and a FIFO there may stall Clean up.
- Codex and Claude may read lane-written agent configs (`.codex/config.toml`, `.claude/settings.json`). This depends on each tool's own folder trust.

**Tests:** V-015, 1134/1134.

**Remaining blockers:**
- The real two-Codex E2E, after the Codex limit resets. It must include the shared-Git-metadata write check (owner requirement 2).
- The owner's decision on whether 1.5.0 ships with Automated Merge off.

### Release scope freeze (owner, 2026-11-10)

**Changes:**
- Automated Merge is off on every path: the console's approve and continue, and the `yallaflow integration record` CLI.
- **Parallel is off** (`PARALLEL_OFF`) until the real-agent E2E. There are two reasons:
  - Codex's own help text says a project's `.codex/config.toml` (sandbox, MCP servers, hooks) is loaded for trusted folders.
  - Whether a lane agent can write the home repository's shared Git metadata cannot be verified without real Codex.

  The E2E's disposable console turns Parallel on with `YALLAFLOW_EXPERIMENTAL_PARALLEL=1`.
- **Queue:** the next session never starts automatically if the project's agent configuration (`.codex/`) changed since the queue began. It is paused with reason `agent-config`. The fingerprint lives in `src/agents/bridge.js` (provider boundary, AC-108).

**PF-0113** (DONE, another session) is reconciled in the same tree.

**Tests:**
- V-016 failed on the AC-108 provider boundary; fixed.
- V-017: 1141/1141.
- Browser smoke: Overview (with PF-0113's branch and Shared Mode status), Work, Agents and Setup render with no console errors (`m4shots/rel-*.png`).

## Verification Evidence

### M3a — Git transaction experiments (2026-11-09, SRC-0057 boundaries)

**Environment.**
- Git 2.43.0 on Linux.
- The harness lived at `<scratchpad>/m3a/m3a.mjs`, with launcher `run.sh` (`env -i`).
- `HOME`, `XDG_CONFIG_HOME`, `GIT_CONFIG_GLOBAL`, `TMPDIR` and `GNUPGHOME` all pointed inside the run's own disposable root, with `GIT_CONFIG_NOSYSTEM=1` and no `SSH_AUTH_SOCK`.
- The harness refuses to start otherwise; this refusal was verified by running it un-isolated.
- Every repository was created with `git init` inside that root. Signing keys were throwaway keys generated there. There was no remote and no network.

**After the runs:**
- The YallaFlow checkout still has HEAD `3b34fa9`, no new worktree or branch, and the same stash count.
- No `yf/*` branch exists in any real repository.
- `~/.gitconfig` was last modified 2026-01-27, and `~/.gnupg` before the runs.

**Evidence.** The final run is recorded as **V-001**: 13 PASS, 2 OBSERVED, 0 FAIL, 0 ERROR. Earlier runs (`full1`, `full2`) found harness defects:
- the markers folder was never created, so "no marker" checks were vacuous; the control checks exposed it;
- a staged-deletion re-stage;
- an ignore rule written too early;
- invalid clone tags;
- a vacuous E12 control.
They were fixed and rerun. Those runs are not counted as evidence.

| Exp | Verdict | Finding |
|---|---|---|
| E1 | PASS 8/8 | Temp-index tree = real-index tree (text, binary, CRLF with `text=auto` and `core.autocrlf`, `+x`, symlink, empty, delete, rename, unicode). The real index is untouched by temp-index work. **New:** re-staging a deletion that is already staged fails (`pathspec … did not match`), so staging must skip approved paths absent from both work tree and index. |
| E2 | PASS 3/3 | An agent-staged extra entry makes the index tree ≠ the approved tree, so nothing is committed. An unticked untracked file is never committed. |
| E3 | PASS 4/4 + 5 obs | Fast-forward keeps unrelated modified, untracked and ignored files byte-identical. It refuses, changing nothing, for an overlapping edit, an untracked file at an added path, and assume-unchanged / skip-worktree edits. **Observed:** an *ignored* file at a path the fast-forward adds is **overwritten** (exit 0). **Observed:** with an unrelated staged change, the fast-forward succeeds and keeps it staged; the design still blocks this case. |
| E4 | PASS 4/4 | The dry run in the lane at M equals the real `shared integrate` on the integration branch. Output is byte-identical in an independent clone. A parallel change of the same fact is blocked identically in both. The comparison maps the plan vocabulary (`introduce`, `memory.js:249`) to the applied vocabulary (`introduced`, `memory.js:47`). |
| E5 | PASS 3/3 | The control shows the planted hooks run. With `core.hooksPath=/dev/null`, none of 11 hook types ran for worktree add, read-tree, add, write-tree, commit, merge-tree, commit-tree, fast-forward or worktree remove, whether planted in `.git/hooks` or via a repo `core.hooksPath` (`.husky`). |
| E6 | PASS 5/5 | SSH and OpenPGP signing (isolated) follow `commit.gpgSign` for `commit`. **`commit-tree` ignores `commit.gpgSign`**, so `-S` must be explicit. A failing signer → commit fails with HEAD unchanged, and `commit-tree -S` fails with no object id. |
| E7 | OBSERVED | `kill -9` during a fast-forward that adds 20,000 files, at 5–400 ms: HEAD always stayed at base; `index.lock` was always left behind; after ≥ 50 ms about half the files were already on disk as untracked. There is no corruption, but the checkout is unusable until the lock is removed. **New:** a background `gc --auto` after a large commit raced a local clone ("failed to copy file"). |
| E8 | PASS 1/1 | `--literal-pathspecs` + NUL pathspec file stage exactly the approved names (`*.js`, `a?b`, `[x]`, `:(top)y`, `-n`, spaces, newline). **Control without it: `:(top)y` staged the unrelated file `y` and not itself.** |
| E9 | PASS 6/6 | Version gate works (2.43 accepted, a faked 2.30 refused). merge-tree is object-only (status clean afterwards); clean → exit 0; conflict → exit 1 with the path. **Manual mismatch:** an invalid commit also exits **1** (empty stdout, error on stderr). Pre-validation (`cat-file -e <oid>^{commit}`) plus the classification (exit 1 + a valid tree id = conflict, otherwise error) is proven. |
| E10 | OBSERVED | Repository filters ran during worktree add (smudge), temp-index and real add (clean), the fast-forward (clean + smudge), and once during worktree remove (clean, a racy status check). Not during merge-tree or commit-tree. A required filter whose program is missing makes `worktree add` fail cleanly (exit 128, no folder, no admin entry). |
| E11 | PASS 3/3 + obs | **merge-tree runs a configured custom merge driver** (canary). `diff.external`, textconv and `GIT_EXTERNAL_DIFF` never run with `--no-ext-diff --no-textconv`, `--name-only`, `--name-status` or `--quiet`; the control shows they do run otherwise. |
| E12 | PASS 4/4 | The control shows inherited `GIT_EDITOR`/`GIT_EXTERNAL_DIFF` run. With the sanitised environment, no inherited editor, pager, diff, askpass, credential or ssh helper ran, and a hostile `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE`/`GIT_CONFIG_COUNT` did not redirect the work (the other repo's HEAD and index are unchanged). The config fingerprint (`config --list --show-origin --show-scope -z`) changes with an included file or a repo config change. |
| E13 | PASS 3/3 | `commit --cleanup=verbatim -F` keeps the message byte-exact; author and committer come from Git config; HEAD tree = approved tree. Default `-F` cleanup keeps `#` lines too, but verbatim is used. |
| E14 | PASS 3/3 + obs | Two concurrent fast-forwards in one checkout: 7/10 trials ended with HEAD at one target while **the index and files carried the other** (`cannot lock ref 'HEAD': is at … but expected …`). `fsck` was clean in all trials. The post-step check (index tree ≠ HEAD tree) detected every case. A present `index.lock` makes Git refuse and stay put. |
| E15 | PASS 3/3 + obs | `worktree remove` refuses modified and untracked lanes and keeps the branch, but **deletes ignored files, including `.env`** and `node_modules/`. |

**Permanent regression tests.**
- `test/git-transaction.test.js` (17 tests, isolated Git environment inside the test's temp directory, never touching the checkout) encodes E1 (both variants), E2, E3 (preservation, refusals, ignored-file canary), E4, E5, E6 (SSH; skipped without `ssh-keygen`), E8, E9, E10 canary, E11, E12, E13, E14 detection, and E15.
- E7 has no permanent test (timing-based, 20,000 files). Its recovery behaviour is tested in M3 by simulating its observed end state (base HEAD, `index.lock`, partial untracked files).
- Canary tests assert today's dangerous Git behaviour (ignored files overwritten or deleted, merge drivers and filters executed, `commit-tree` ignoring `commit.gpgSign`). If a Git release changes that behaviour, the suite reports it; the guards stay.

### Checkpoint C — proposal (decided 2026-11-09, see below)

**Confirmed safety properties** (executed + permanent test):
- the approved tree is built without touching the real index (R1);
- extra staged entries are detected before commit (R2);
- unrelated local files survive a fast-forward, and overlapping or hidden edits are refused (R3, except ignored files);
- deterministic knowledge integration and dry-run equivalence (R4);
- hook isolation (R5);
- signing behaviour, including a failing signer (R6, SSH; OpenPGP in the harness);
- literal pathspecs (R9);
- the version gate and merge-tree classification (R10);
- diff-helper isolation (R12 part);
- sanitised environment and config fingerprint (R13);
- detection of concurrent-process inconsistency;
- `worktree remove` refusals.

**Confirmed dangers with mandatory guards** (canary tests):
- ignored files overwritten by fast-forward → `lstat` pre-check (T15);
- ignored files deleted by `worktree remove` → FR13 guard;
- filters executed by add, fast-forward and worktree add → trust policy (R11);
- merge drivers executed by merge-tree → trust policy (R12);
- `commit-tree` ignores signing config → explicit `-S`.

**Required design changes** (each follows from an observed result; none weakens a requirement):
- **C1** Stage only approved paths present in the work tree or the index. Rely on the tree-equality check. This makes recovery re-runs of step 2 safe (E1).
- **C2** Before merge-tree, run `cat-file -e <oid>^{commit}` on both inputs. Classify: exit 0 + tree = clean; exit 1 + valid tree id = conflict; anything else = error (S1) (E9).
- **C3** Add `-c gc.auto=0 -c maintenance.auto=false` to every git-ops call, so YallaFlow never triggers background maintenance in the developer's repository (E7).
- **C4** After every fast-forward and commit, verify HEAD, `HEAD^{tree}` and `write-tree` (index) = `HEAD^{tree}`; otherwise stop (S3/S7) (E14).
- **C5** `commit-tree` gets `-S` exactly when `commit.gpgSign` is true (E6).
- **C6** Commits use `--cleanup=verbatim` (E13).
- **C7** Filters and merge drivers: *proposed* per-project trust; **amended by the owner (A4): no execution and no trust override in v1.5.0** — automated operations are blocked for repositories that reference them (FR34). A missing required filter fails `worktree add` cleanly (E10, E11).
- **C8** The integration comparison maps plan verbs to applied actions (E4).
- **C9** Crash during a fast-forward (E7): recovery detects `index.lock` or (HEAD = base and files on M's added paths). YallaFlow stops (S7) and shows guided manual recovery:
  1. make sure no Git process is running;
  2. remove `.git/index.lock` yourself;
  3. YallaFlow lists the untracked files on M's paths and proves by hash whether each equals M's blob (identical ones are safe to delete, differing ones are listed and never touched);
  4. Continue re-runs the fast-forward.
  YallaFlow never deletes the lock or any file itself.
- **C10** Strengthen test 51 (gap found). Today it only matches `spawnSync('git', ['x'` and `git(root, ['x'`. It does not see:
  - `execFileSync('git', [... 'log'])` (`src/core/collisions.js:73`);
  - `spawn('git', ['--no-optional-locks', …, 'status'])` (`src/console/worktrees.js:80`);
  - `GIT_INIT_ARGV` through `runQuiet`/`runLogged` (`src/console/greenfield.js:99`, `src/newproject/project.js:345`);
  - wrappers with variable `args` (`src/history/source.js:19`, `src/core/workspace.js:47`).

  All of today's calls are compliant: `log` is read-only, `status` read-only, `init` owner-approved in PF-0057, and the wrappers run only `ls-files`/`ls-tree`/`cat-file`. Proposal: one scanner that finds every Git invocation form (`spawn*`, `execFile*`, `runQuiet`/`runLogged`, the `GIT_INIT_ARGV` constant, the known wrappers) and takes the first non-option argument as the subcommand. It enforces:
  - the read-only allowlist **plus `log`** (an explicit addition for an existing read-only call);
  - `init` only via `GIT_INIT_ARGV` in the two approved files;
  - G1–G10 only in `src/execution/git-ops.js`;
  - git-ops' fixed argv shapes asserted by a table;
  - forbidden tokens (`push`, `pull`, `fetch`, `rebase`, `reset`, `revert`, `cherry-pick`, `stash`, `clean`, `checkout`, `switch`, `restore`, `branch`, `tag`, `update-ref`, `gc`, `prune`, `--force`, `-f`, `--no-verify`) absent from git-ops;
  - `config` used only in read forms (`--get`, `--get-regexp`, `--list`).

**Final proposed allowlist.** It applies only in `src/execution/git-ops.js`. Every call uses the prefix `git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.untrackedCache=false -c gc.auto=0 -c maintenance.auto=false --literal-pathspecs --no-pager` and the sanitised environment: `GIT_*`, `PAGER`, `EDITOR`, `VISUAL` and askpass/ssh variables removed; `GIT_TERMINAL_PROMPT=0`, `GIT_PAGER=cat`, `GIT_EDITOR=:`, `LC_ALL=C`; validated `cwd`; a timeout.

| # | Exact argv after the prefix | When |
|---|---|---|
| G1 | `worktree add -q -b yf/<slug> <abs-path> <oid>` | lane creation (filters trusted or absent) |
| G2 | `worktree remove <abs-path>` | explicit Clean up after `verified` + FR13 guards |
| G3 | `merge-tree --write-tree --name-only --no-messages -z <oid> <oid>` | preview, step 3 (after C2 pre-validation) |
| G4 | `read-tree <oid>` (`GIT_INDEX_FILE`=private temp) | preview, re-validation |
| G5 | `add -A --pathspec-from-file=<pf> --pathspec-file-nul` (`GIT_INDEX_FILE`=private temp) | preview, re-validation |
| G6 | `write-tree` (temp or real index) | preview; before and after every commit and fast-forward (C4) |
| G7 | `commit-tree <tree> -p <oid> [-p <oid>] [-S] -F <msg>` | preview C′, merge commit M |
| G8 | `add -A --pathspec-from-file=<pf> --pathspec-file-nul` (real index, C1 list) | steps 2 and 10, after approval |
| G9 | `commit -q --cleanup=verbatim -F <msg>` (only after the G6 equality) | steps 2 and 10, after approval |
| G10 | `merge --ff-only -q <oid>` | steps 4 and 7, after approval |

Read-only helpers already allowed: `rev-parse`, `cat-file -e/-p`, `ls-files -z --cached` / `-v -t`, `ls-tree`, `diff --name-only|--name-status|--cached --quiet` with `--no-ext-diff --no-textconv`, `status --porcelain=v1 -z`, `symbolic-ref`, `merge-base --is-ancestor`, `config --get|--get-regexp|--list --show-origin --show-scope -z`. `log` is added as read-only (C10).

**Risks requiring explicit owner acceptance.**
- **A1 (R7)** A crash inside a fast-forward cannot be made atomic by YallaFlow. Detection and guided manual recovery only (C9).
- **A2 (R8)** Verified on Linux with Git 2.43 only. macOS (case-insensitive filesystems) and Windows are unverified, and so are Git 2.38–2.42 and future versions. The canary tests run wherever the suite runs. Release notes will state the verified platform.
- **A3** Another program running Git in the same checkout at the same moment can leave it inconsistent (E14). YallaFlow detects this and stops (C4); it cannot prevent it.
- **A4** Filters and merge drivers the developer chooses to trust will execute their commands inside YallaFlow operations (by design, after an explicit trust).
- **A5** OpenPGP signing is proven in the harness only; the permanent test covers SSH signing. CI has no GPG key.
- **A6** `worktree remove` deletes ignored files. The guard blocks Clean up while non-dependency ignored files exist. What counts as "dependency" (e.g. `node_modules/`, `vendor/`, `dist/`) comes from the stack scan and is shown to the developer before Clean up.



### Checkpoint C — decision (owner, 2026-11-09, SRC-0058)

**Approved:** design corrections C1–C10 (C7 amended by A4). **Conditionally approved:** the allowlist G1–G10 plus read-only `git log`, under strict command-and-argument validation (FR36).

**Risk register:**

| Risk | Decision | Where it is enforced |
|---|---|---|
| A1 crash inside a fast-forward | Accepted with safeguards: stop immediately; no automatic reset, repair, lock removal or retry; manual guidance | FR37, C9, S7, S16, AC-049 |
| A2 unverified platforms and Git versions | Conditionally accepted: automated mutation only on the verified Linux/Git configuration; fail closed elsewhere with manual operations | FR33, S14, AC-045 |
| A3 concurrent external Git processes | Accepted as residual risk: serialise YallaFlow operations; validate before and after; stop on unexpected change; no claim of prevention | FR24, FR37, AC-052 |
| A4 trusted filters and merge drivers | **Not accepted for v1.5.0:** never executed by automated operations; such repositories are blocked, with a manual alternative | FR34, S15, AC-046 |
| A5 OpenPGP signing coverage | Conditional: a permanent GPG test is required, otherwise the GPG path is blocked | FR35, AC-047 |
| A6 cleanup and ignored files | Accepted with safeguards: delete only positively identified reproducible dependencies; show the exact scope; explicit confirmation | FR13, AC-048 |

**Additional rules** (REQ-030…REQ-037, AC-045…AC-053):
- strict argument validation;
- staged, unstaged, ignored and untracked user data preserved;
- safety checks never weakened to make a test pass;
- approval bound to the exact reviewed content;
- a failed or interrupted integration is never MERGED & VERIFIED;
- every inconsistent state is a stop condition;
- Checkpoint D preserved;
- no commit, push, tag or publish without separate approval;
- a disposable-repository demonstration of the complete implementation and its safety tests before automated merge is enabled on any real project;
- any newly discovered safety issue is reported before the affected operation proceeds.

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0052
**Type:** file
**Name:** execution-modes-request.md

Raw source preserved in: `.yallaflow/sources/SRC-0052/execution-modes-request.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0053
**Type:** file
**Name:** execution-modes-decisions.md

Raw source preserved in: `.yallaflow/sources/SRC-0053/execution-modes-decisions.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0054
**Type:** file
**Name:** execution-modes-review-merge.md

Raw source preserved in: `.yallaflow/sources/SRC-0054/execution-modes-review-merge.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0055
**Type:** file
**Name:** execution-modes-d8-d13.md

Raw source preserved in: `.yallaflow/sources/SRC-0055/execution-modes-d8-d13.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0056
**Type:** file
**Name:** execution-modes-spec-approval.md

Raw source preserved in: `.yallaflow/sources/SRC-0056/execution-modes-spec-approval.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0057
**Type:** file
**Name:** execution-modes-plan-approval.md

Raw source preserved in: `.yallaflow/sources/SRC-0057/execution-modes-plan-approval.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0058
**Type:** file
**Name:** execution-modes-checkpoint-c.md

Raw source preserved in: `.yallaflow/sources/SRC-0058/execution-modes-checkpoint-c.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0059
**Type:** file
**Name:** execution-modes-d14-d15-m4.md

Raw source preserved in: `.yallaflow/sources/SRC-0059/execution-modes-d14-d15-m4.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0060
**Type:** file
**Name:** execution-modes-checkpoint-d.md

Raw source preserved in: `.yallaflow/sources/SRC-0060/execution-modes-checkpoint-d.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0061
**Type:** file
**Name:** execution-modes-security-decision.md

Raw source preserved in: `.yallaflow/sources/SRC-0061/execution-modes-security-decision.md`. Read it directly; it is not duplicated here.
