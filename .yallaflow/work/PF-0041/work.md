# PF-0041 — Work lifecycle status: hold, resume, close without delivery, reopen closed work (Core operations, separate from workflow stage)

## Raw Request

Work lifecycle status: hold, resume, close without delivery, reopen closed work (Core operations, separate from workflow stage)

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** feature
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow feature --scope architectural`.
**Timestamp:** 2026-11-06T21:16:29.110Z
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

## Discovery

## Architecture / Technical Decisions

Classify only relevant decisions as confirmed, proposed, unresolved, or not applicable.

## Design

- **Chosen:**
  - a lifecycle block in `meta`, plus an append-only `lifecycle.yaml` ledger, with the stage untouched;
  - commands under `work` (`hold`, `resume`, `close`), and `reopen` extended for closed items;
  - one central guard;
  - a confirmation-gated, atomic minimum-version raise.
- **Rejected:**
  - CLOSED or HOLD as workflow stages or Flow stations (owner rule 3);
  - a top-level `resume` (the name is taken by session resumption);
  - a silent version raise (owner feedback);
  - per-command DONE-style checks, which drift.

## Specification

### Goal and Scope

Give work items an explicit lifecycle status, kept separate from the workflow stage, so work can be put **on hold**, **resumed**, **closed without delivery** and **reopened from closure**. The scope is Core operations and read surfaces only. The console actions belong to the next work item and will call exactly these operations. Owner decisions: SRC-0028, and the revision requested in this session.

### Actors and Permissions

- **Who triggers it:** a developer (CLI) or, later, the console's local user. An agent may run the commands only as the Agent Contract allows. A lifecycle change is never automatic.
- **The minimum-version raise needs an explicit human confirmation:** `--accept-minimum-version 1.4.0`, or the console's confirmation dialog.

### Functional Requirements and Business Rules

- **Stage untouched.** `meta.status` stays the workflow stage, and no lifecycle operation changes it.
- **`meta.lifecycle`** is absent for open items, so every existing record is open and byte-unchanged.
  - **On hold:** `{state:'on_hold', since, reason}`.
  - **Closed:** `{state:'closed', since, outcome:'cancelled'|'superseded'|'duplicate', reason, by?}`.
- **Hold is temporary.** It preserves stage, checkpoints, requirements, convergence and evidence, and resume returns to exactly the same state.
- **CLOSED is never DONE.** It is not delivered, verified or completed. DONE items cannot be closed.
- **Every change is audited:** one event appended to `work/<id>/lifecycle.yaml` (`{at, action, from, to, reason, outcome?, by?, stage}`) and one line in `progress.md`.

### Workflows and Lifecycle

- **`yallaflow work hold <id> --reason TEXT`** (from open, not DONE)
  - clears the active focus if this is the active item, and records it.
- **`yallaflow work resume <id> [--note TEXT]`** (from on hold)
  - back to open at the same stage;
  - never activates; `yallaflow activate` stays the explicit switch.
- **`yallaflow work close <id> --outcome cancelled|superseded|duplicate --reason TEXT [--by <work-id>]`** (from open or on hold, not DONE)
  - `--by` is required for superseded and duplicate, and must be another existing item;
  - clears the active focus.
- **`yallaflow reopen <id> --reason TEXT`** on a closed item
  - back to open at the preserved stage, audited;
  - the existing rules still apply afterwards (stage exit blockers, gates, the Brownfield understanding gate on routing);
  - `--to` is refused for closed items;
  - `reopen --to` for DONE items is unchanged.
- **Central Core write guard:** a held or closed item refuses every progress mutation, and the message names `work resume` or `reopen`:
  - route, advance;
  - checkpoint (incl. revise and rulings);
  - verify, finish;
  - activate;
  - request revise, intake add, question add/answer;
  - requirement record, convergence record, impact assess;
  - knowledge propose/promote/reject/review;
  - limitation add, purpose set, decompose;
  - approve/feedback, qc/demo records.

  Read-only commands are unchanged.
- **CLI behaviour:** every existing command keeps its arguments and output for open items. The `work` command stays read-only for `show`; `hold`, `resume` and `close` are mutations.

### Data and Integrations

- **New files and fields:**
  - `work/<id>/lifecycle.yaml`, CLI-owned and registered in `STATE_OWNERSHIP`;
  - the `meta.lifecycle` block;
  - in `config.yaml`, `yallaflow.minimumVersion`, raised to 1.4.0 only through the confirmation below.
- **Read surfaces:**
  - **Flow:** `itemState` gains `held` and `closed`, which take precedence over everything except `done`.
  - **Snapshot and work read contracts (additive):** a `lifecycle` object per item.
  - **Completion:** closed items are never 100% and never count as done or delivered in snapshot, status or insights. Held items keep their real progress.
  - **`next`, `status`, `brief`, `guide`, `work show`:** label held and closed items and name the lifting command. `next` skips them.
  - **Integrity/doctor:**
    - validates the lifecycle block and the ledger;
    - lifecycle on a DONE item is an error;
    - an active item that is held or closed is a warning.
- **Compatibility, never silent:**
  - **Confirmation.** When a hold or close would make the project require more than it does now (current minimum below 1.4.0, or none), the operation **refuses without changing anything**. It prints a warning: YallaFlow 1.3.x and older can then read the project but not change it, and in a Shared Project this reaches every teammate once merged. It names the confirmation `--accept-minimum-version 1.4.0`; the console shows the same warning as a dialog. Once the project requires 1.4.0 or more, nothing is asked. A higher value is never lowered.
  - **Atomic.** Everything runs under the workspace lock, and all checks run before any write. The writes are, in order: `config.yaml`, `lifecycle.yaml`, `meta.yaml`, the `progress.md` line. On any failure, the files already written are restored from the bytes read beforehand, so a failed operation never leaves a raised minimum or a half-applied change.
  - **Older CLIs, verified by experiment** (discovery, real 1.1.0/1.2.0/1.3.0 on a project requiring 1.4.0):
    - **refused, project byte-unchanged:** advance, checkpoint, verify, start, route, activate, intake add, question add and finish; Create Work in the 1.2.0 and 1.3.0 consoles; Make it active in the 1.3.0 console;
    - **still working:** status, brief and guide; work show in 1.2.0 and 1.3.0.
    - **Remains possible:** a 1.3.0 Agent Workspace session can still write its own local runtime records under `.yallaflow/local/`. Those are not project state.
  - **Shared Projects:** the raise is a normal `config.yaml` change on the current branch. The shared block is preserved and its minimum is only raised.
  - **Version:** the package moves to 1.4.0 (unreleased). The single-user config schema stays v1.

### Validation and Error Behavior

- **Refusals change nothing.** Invalid transitions (hold when already held or closed, resume when not held, close of DONE, reopen of an open item, a missing reason, a bad outcome, an invalid `--by`) refuse before any write and say what is allowed.
- **Guard refusals** name the item's lifecycle state and the lifting command.
- **Failure injection** after each write leaves every file byte-identical to its state before the operation.

### Security and Privacy

Reasons and notes go through the existing secret redaction before they are persisted. No new network or process behaviour.

### UI / Screens

None in this item. The console actions and the confirmation dialog follow in the next work item, calling these operations.

### Acceptance Criteria

AC-001 to AC-007 in `requirements.yaml`. **Regression tests:**
- hold/resume byte-identity;
- close for each outcome, and refusal on DONE;
- reopen of closed items, and the DONE reopen unchanged;
- the guard per command family;
- active-work clearing;
- completion metrics;
- old records (a frozen 1.1.0 workspace fixture and the repository's own records);
- the confirmation flow;
- failure injection (atomicity);
- a Shared Project;
- frozen older CLIs refusing mutations on a project at 1.4.0.

### Unresolved Items

None. The older-CLI behaviour was verified as discovery evidence.

## Implementation Plan

1. **`src/core/lifecycle.js` (new):**
   - `lifecycleOf(meta)`;
   - `assertProgressAllowed(meta, operation)`, the central guard;
   - `holdWork`, `resumeWork`, `closeWork`, `reopenClosedWork`, each validating first and then making the write sequence;
   - an atomic multi-file writer with byte-level rollback;
   - `requireMinimumVersion(root, '1.4.0', { accept })` with the warning text.
2. **Guard wiring:**
   - mutation entry points call `assertProgressAllowed`: routing/route, `evaluateAdvance` and `advanceActiveWork` in transitions, progress checkpoint recording, evidence/verify recording, finish closure, `activateWorkItem`, request revise, intake add, questions, requirements, convergence, impact, knowledge, limitation, purpose, decompose, review approve/feedback, quality records;
   - one helper, checked by a test that enumerates the command families.
3. **CLI:**
   - `work hold|resume|close` parsing in `cli.js`;
   - `reopen` extended for closed items;
   - `READ_ONLY_COMMANDS`: `work` is read-only only for `show`;
   - usage text and docs/cli.md.
4. **Read surfaces:**
   - `flow/stations` `itemState` (held, closed);
   - `flow/snapshot` and work show (additive `lifecycle`) and their schemas in `resources/schemas`;
   - completion and insights exclusions;
   - `next`, `status`, `brief`, `guide`;
   - integrity/doctor checks;
   - `STATE_OWNERSHIP` entry for `lifecycle.yaml`.
5. **Version and docs:**
   - package 1.4.0 (unreleased): `package.json`, lock, `version.js`;
   - CHANGELOG [1.4.0];
   - docs/workflows.md (lifecycle), docs/limitations.md, docs/upgrading note on the minimum version.
6. **Tests:** `test/work-lifecycle.test.js`, covering the specification's regression list, plus frozen-older-CLI checks via Git tags (v1.1.0 is available; v1.2.0 and v1.3.0 are not tagged yet, so the installed 1.2.0/1.3.0 packages are used when present, skipped otherwise, and the result is recorded).
7. **Verification:** the full suite on Node 22 and 20.16, then convergence, independent review on an isolated copy, finish. Feature branch `feature/workspace-1.4` only; nothing pushed or released without the owner's word.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0028
**Type:** file
**Name:** owner-decision-workspace-lifecycle.md

Raw source preserved in: `.yallaflow/sources/SRC-0028/owner-decision-workspace-lifecycle.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0029
**Type:** file
**Name:** DESIGN.md

Raw source preserved in: `.yallaflow/sources/SRC-0029/DESIGN.md`. Read it directly; it is not duplicated here.
