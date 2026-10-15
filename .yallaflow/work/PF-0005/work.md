# PF-0005 — Route engineering work before the first edit (v1.0.1)

## Raw Request

Fix v1.0.0 automatic work-routing bypass: agents must route engineering edits through YallaFlow before the first edit, never offer tracking as optional afterwards; keep small changes lightweight and operational help frictionless; document recovery of untracked edits (target v1.0.1)

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** bug
**Scope:** bounded
**Confidence:** high
**Reason:** Defect in the agent-facing contract: v1.0.0 AGENT.md/bootstrap never require a routed work item before the first engineering edit, so a Sekaya agent edited code untracked and offered tracking afterwards as optional. The fix is confined to contract/bootstrap text, its versioning, recovery docs and regression tests; existing refresh/upgrade paths carry it, no schema, data-model or lifecycle-semantics change.
**Timestamp:** 2026-10-15T09:13:06.429Z
**Workflow:** bug
**Required capabilities:** discover, systematic-debugging, implement, verify
**Behavior contract:** registry v8
**Skills:** context-discovery, systematic-debugging, implementation, verification
**Read-only:** no

## Intake

The original user request was pasted in full. Target: v1.0.1, pending compatibility review. Constraints: minimum effective fix. Do not add Git drift detection or provider hooks (record them as follow-ups). Do not commit, tag, push or publish. Stop for approval.

## Known Facts

- Agent Contract v8 (src/agent/contract.js) and bootstrap v2 (src/agent/bootstrap.js) are the only agent-facing instructions. Projects pick up new versions through `yallaflow agent refresh`, which `brief` and `upgrade plan` already recommend when the installed contract is outdated.
- Bounded work has no human review gates. Spec and plan gates fire only under architectural readiness (src/core/workflows.js requiredSkillForStage, src/core/transitions.js reviewGateBlocker). A change/bounded item reaches DONE with checkpoints, verify, a knowledge review and finish, and no approvals (scratch simulation, see Reproduction).
- Application code modification is authorized only at a write stage of a routed work item.

## Open Questions

## Reproduction

- Field report (Sekaya, v1.0.0): "Move the project's Edit and Delete buttons into a three-dots ActionGroup at the end of the table". The agent ran the orientation and loaded project memory. It then edited application code without a work item, and afterwards offered YallaFlow tracking as optional.
- Text reproduction against v1.0.0: no sentence in AGENT.md v8 or bootstrap v2 requires a work item before an edit. The only edit rule is conditional: "never modify application code while guidance says it is not authorized" (bootstrap step 6, contract Behavior contract sequence). With no work item there is no guidance, so nothing says "not authorized". The vacuous condition reads as permission.
- Scratch simulation (greenfield, v1.0.0 CLI): `change "<Sekaya request>" --scope bounded` → advance/checkpoints → verify → knowledge review --none → finish succeeded with no human approval. The lightweight path already exists in the CLI. Only the contract never routes small work into it.

## Evidence

- src/agent/bootstrap.js bootstrapBody step 6 (conditional edit rule).
- src/agent/contract.js agentContractBody: "Core rules" 2 is abstract ("Route the request…"). The project-understanding section says "You interpret which one a request is", which leaves small edits to discretion. The finish protocol assumes a work-id exists and says nothing for the untracked case. Nothing forbids offering tracking after the fact, and there is no recovery procedure.
- src/commands/brief.js primaryConcern: with no active work it says "none — ready for new work / yallaflow start" and never ties that to editing.

## Hypothesis

The bypass is a contract gap, not a CLI defect. The contract gates edits on guidance that only exists after routing, and it never says that every intentional engineering edit, however small, needs a routed work item first. So the agent treated a small UI change as outside YallaFlow.

## Root Cause

Confirmed. The bootstrap and Agent Contract word the edit rule negatively and conditionally ("don't modify while guidance says not authorized"). They never state the positive precondition: a routed, active work item at an authorized stage before the first engineering edit. They also never say that small changes use the same, lightweight path (bounded: no human gates). Prediction checked: with no work item, nothing in v8 or v2 forbids the edit, and the CLI path for the same change is approval-free. Competing explanation ruled out: the CLI did not force heavy approvals that would push an agent to bypass it (bounded has no review gates).

## Discovery

## Specification / Expected Behavior

- An intentional edit to any engineering artifact (tracked project file other than YallaFlow state, including docs, temporary debug edits, and command-generated changes) happens only inside a routed work item whose guidance authorizes modification.
- A covering active item is reused, never duplicated. Read-only investigations and DONE items are never edited under.
- Small changes are bounded. In adaptive mode there are no spec/plan reviews. Mode-enabled gates stay human decisions.
- Operational help creates no work item.
- Tracking is never offered as optional.
- Untracked edits are recovered: kept, disclosed, routed, ruling recorded, verified fresh, never backdated.

## Implementation Plan

1. Agent Contract v9: add a "Work routing before editing" rule. Route an intentional engineering edit (source, tests, migrations, configuration, other durable engineering artifacts) to an active work item at an authorized stage before the first edit. Reuse an active work item that covers the request; never duplicate one. Small changes are bounded (no human approval gates). Operational assistance stays outside. Never present tracking as optional after an edit. Add the recovery procedure for edits that were already made untracked.
2. Bootstrap v3: add the same precondition as a step, plus the "never optional / recover" line.
3. brief: when no work is active, say that an engineering change is routed before its first edit.
4. Docs: an upgrading-to-v1.0.1 note with recovery and upgrade steps, a CHANGELOG entry, and the version table. Package version 1.0.1.
5. Tests: contract/bootstrap text, lightweight UI change path, active-work reuse, operational requests, no optional-tracking language, finish requirements, brownfield/greenfield, legacy v8/v2 refresh, recovery.

## Verification Evidence

- Full suite 680/680, 0 skipped (includes test/work-routing.test.js, 16 tests, and the real v1.0.0-tag CLI compatibility test). Recorded as governed evidence via `yallaflow verify PF-0005 -- npm test`.
- npm pack --dry-run: 177 files. git diff --check clean. No new secrets.
- Independent review (separate agent): one high finding (gated-mode gate claim) and medium findings on loopholes, recovery and reuse. All were addressed before verification. The reviewer confirmed: upgrade path, fixtures byte-identical to the v1.0.0 tag, no CLI gate change, semver PATCH, scope control.
- Real-agent Sekaya acceptance check: NOT yet run against 1.0.1 (requires a real agent session).

## Decisions / Rulings

## Knowledge Updates

## Result

Contract v9 + bootstrap v3 + brief line. Package 1.0.1 candidate, uncommitted, awaiting owner approval. Follow-ups (not implemented): Git drift detection for uncovered engineering changes; optional provider hooks; a real-agent Sekaya acceptance run.
