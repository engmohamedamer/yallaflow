# PF-0043 — Console Work Management: work-item actions through canonical Core commands (activate, advance, reopen, revise, answer, hold, resume, close), blocked explanations, Core-validated drag and drop; 1.4.0 roadmap

## Raw Request

Console Work Management: work-item actions through canonical Core commands (activate, advance, reopen, revise, answer, hold, resume, close), blocked explanations, Core-validated drag and drop; 1.4.0 roadmap

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** feature
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow feature --scope architectural`.
**Timestamp:** 2026-11-06T22:24:09.503Z
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

- **Confirmed: every console action is a CLI invocation through the existing runner** (argv, no shell, one write at a time per project). Core keeps all rules: the lifecycle guard, stage blockers, the version check and validation. The console never writes `.yallaflow` itself.
- **Confirmed: console review-gate decisions use Option B, confirmation only** (owner decision SRC-0032).
  - **What it is:** an explicit **local-user** approval, not a trusted-identity system.
  - **What gives access:** the console token. It proves access to the terminal that started the console, not who the person is.
  - **What a decision is:** the person reviews the gate's real material, then confirms by typing the exact gate name and a mandatory note.
  - **How it's recorded:** Core's unchanged `approve`/`feedback` command records it, with provenance `{ via: 'console', identity: 'not verified', host, claimedGitName }`. YallaFlow never claims a verified or independently trusted human.
  - **Unchanged:** CLI approvals keep exactly their current behaviour and records.
  - **No automatic approval** by an AI agent or through the Agent Workspace.

## Design

## Specification

### Goal and Scope

The console gains work-item actions that run the canonical Core commands:
- activate, advance;
- reopen (DONE with a target; closed at its preserved stage);
- request revise, question answer;
- hold, resume, close without delivery.

Blocked actions are explained, and drag and drop on the Flow is controlled by Core.

The 1.4.0 roadmap is updated. The console also supports explicit review-gate decisions under Option B.

Later 1.4.0 milestones, not in this item:
- the Project Overview with existing-project onboarding (including baseline approval under the same provenance model);
- development runtime management (Start/Stop/Logs);
- the New Project Wizard.

### Actors and Permissions

The console's local user, holding the per-run token. Identity is not verified, as for Create Work today. A read-only console (`--read-only`) refuses every action. Actions are recorded by Core exactly as the same CLI command would record them.

### Functional Requirements and Business Rules

**Route:** `POST /api/p/<project>/work/<work-id>/actions/<action>`. It requires the token, the console Origin and `Content-Type: application/json`, and takes a small JSON body.

| Action | Body | CLI argv |
|---|---|---|
| activate | – | `activate <id>` |
| advance | – | `advance <id>` |
| reopen (DONE) | `to`, `reason` | `reopen <id> --to <to> --reason <reason>` |
| reopen (closed) | `reason` | `reopen <id> --reason <reason>` |
| revise | `text`, `reason` | `request revise <id> --text <text> --reason <reason>` |
| answer | `question`, `answer` | `question answer <id> --id <Q-###> --answer <text>` |
| hold | `reason`, optional `confirmMinimumVersion` | `work hold <id> --reason <reason> [--accept-minimum-version 1.4.0]` |
| resume | optional `note` | `work resume <id> [--note <note>]` |
| close | `outcome`, `reason`, optional `by`, optional `confirmMinimumVersion` | `work close <id> --outcome … --reason … [--by …] [--accept-minimum-version 1.4.0]` |
| decide (gate) | `gate`, `decision` (approve, request_changes), `confirmGate` (typed), `note`, `requestedAt`, `digest`, `requestId` | `approve <id> --stage <gate> --note <note>` or `feedback <id> --stage <gate> --changes-requested --note <note>` |

**Validation:**
- The id must match the work id pattern, and `to`, `outcome` and `question` must match their enums or patterns.
- Text is limited to 10,000 characters.
- An unknown action returns 404.
- Text values are always passed as separate argv elements, never through a shell or as option-like tokens: `--opt=value` is used so a value starting with `--` cannot become an option.

### Workflows and Lifecycle

**Review-gate decisions (Option B):**
1. **Review screen:** `GET /api/p/<project>/work/<id>/gates/<gate>`. It is read-only and shows:
   - the gate's material from `work.md`: the Specification for `specification`, the Implementation Plan for `plan`, Design and Architecture for `design`, Discovery for `discovery`, and the requirements with acceptance criteria for `clarification`;
   - the requirements and acceptance criteria;
   - the latest verification run and the convergence status;
   - open material questions, a pending impact, and the item's integrity warnings;
   - the gate's status, `requestedAt` and history;
   - `digest`, a sha256 over everything shown.
2. **Decision:** `POST …/gates/<gate>/decision`. The checks run inside the runner's `exclusive` step, so a read and the write are never split by another console write:
   - `confirmGate` must equal the gate name, case-sensitive;
   - `note` must be non-empty (up to 10,000 characters);
   - the gate is `awaiting_review`;
   - `requestedAt` is unchanged, and the recomputed digest equals the one shown.

   Otherwise: 409 `STALE` ("the gate or its material changed since you reviewed it"), 422 for confirmation and note errors, and nothing is written. Baseline and reconciliation are refused: they keep their own commands.
3. **Idempotency:** a `requestId` already processed returns the first result without writing again. A second, different request for an already-decided gate is `STALE`.
4. **Recording:** the console runs the unchanged CLI (`approve`/`feedback`). Only for that child process, the runner adds `YALLAFLOW_DECISION_PROVENANCE` to the environment, as JSON `{via:'console', host, claimedGitName}`.
   - Core's `setGateStatus` validates it and stores `provenance: {via:'console', identity:'not verified', host, claimedGitName}` on the gate entry and its history entry.
   - Without the variable, the record is exactly as today (CLI decisions).
   - The variable is never set on the console process itself, so the Agent Workspace's adapter and agents never inherit it.

**Responses:**
- **Success:** 200 `{ ok, output }`, with Core's stdout lines.
- **Refusal:** Core's text with a status:
  - 409 `REFUSED` for blockers, the lifecycle guard and invalid transitions;
  - 422 for validation;
  - 409 `CONFIRM_MINIMUM_VERSION` when hold or close needs the version confirmation. The UI then shows Core's warning in a dialog and resends with `confirmMinimumVersion: true`.
- **Cache:** the snapshot cache is refreshed after every write (the runner already does this).

**Drag and drop on the Flow:**
- **Next station:** the item's `currentStation` + 1 runs `advance`, and Core may refuse with its blocker.
- **Earlier station:** offered only for DONE items, mapped to `reopen --to implementation|verification|review` with a reason dialog.
- **Any other target:** dimmed while dragging, and refused with an explanation.
- **Keyboard and pointer alternative:** the same actions are in the item's "⋯" menu.

### Data and Integrations

**New stored data:** `reviews.yaml` gate entries and history entries carry an optional `provenance` object for console decisions only. It is additive: older CLIs ignore it, and doctor validates it when present.

**Read surfaces:** the work read contract (`work show --json`) exposes the gate provenance additively. `status` and `work show` print "via console, identity not verified".

No new stored data. The snapshot already carries `blocker`, `nextAction`, `lifecycle`, `currentStation` and `waitingFor`.

### Validation and Error Behavior

Core's message is shown as-is. A busy workspace returns Core's `WORKSPACE_BUSY` text, and the user can retry. Network failure leaves the form open with the text kept.

### Security and Privacy

The same guards as Create Work:
- loopback;
- the token, checked in constant time;
- Host and Origin;
- the JSON content type;
- a body size limit;
- 405 on a read-only console.

No shell. Values never become options.

**Gate decisions:**
- **Reachability:** only from the browser routes, never from the agent bridge routes or the Agent Workspace's message path. An agent has neither the console token nor the provenance channel.
- **What provenance means:** the provenance names the console as the channel, the host, and the Git `user.name` as a *claimed* name.
- **What is never written:** "verified", "authenticated" or "approved by <person>". The UI states "Recorded as a console decision: identity not verified."
- **Documented limitation:**
  - anyone who holds the per-run link on this machine can make a console decision;
  - an agent running shell commands can still run the CLI `approve`, as it always could, which the Agent Contract forbids;
  - neither path proves identity.

### UI / Screens

**Item page:** an action bar with:
- Make it active;
- Advance, disabled with Core's blocker shown;
- Hold or Resume;
- Close…;
- Reopen…;
- Edit request…

Questions get an Answer form. Dialogs collect the reason, the outcome and the target, plus the version confirmation.

**Gate waiting for review:** a "Review and decide" panel shows the material, a decision choice (Approve, or Request changes), a required note, and a field to type the gate name. Submit stays disabled until the typed name matches. After submitting, the panel shows "Recorded as a console decision: identity not verified".

**Board:** a "⋯" menu on each card with the same actions, and drag and drop as specified.

Arabic and English, light and dark themes, and phone width, consistent with the existing console.

### Acceptance Criteria

AC-001 to AC-004 and AC-006 to AC-010 in `requirements.yaml` (AC-005 is withdrawn, replaced by AC-007 to AC-010).

### Unresolved Items

None. Option B was decided by the owner (SRC-0032).

## Implementation Plan

1. `src/console/actions.js`: action table, validation, argv mapping, and refusal classification (from the CLI exit code and stderr).
2. The server route, with token, Origin, JSON and read-only checks.
3. UI in `resources/console/app.js` and `app.css`: action bar, dialogs (reason, outcome, `--by`, version confirmation), the board "⋯" menu, drag and drop with allowed-target highlighting and refusal messages, in both languages.
4. **Gate decisions:**
   - `src/console/gates.js`: the gate-to-material map, the digest, the review payload, decision validation, the stale and duplicate checks inside `runner.exclusive`;
   - a runner `env` option, used only for the provenance variable;
   - in `src/reviews/store.js`, `setGateStatus` reads and validates the provenance variable (additive), and doctor validates the stored provenance;
   - status and work show print it.
5. **Tests** in `test/console-actions.test.js`:
   - every action against a real project gives the same result as the CLI;
   - refusals and the confirmation flow;
   - security: token, Origin, content type, read-only;
   - gate decisions: unauthorized requests, a wrong typed name, an empty note, a stale gate, changed material, duplicate submissions (same request id and second request), audit integrity;
   - CLI decisions stay byte-identical without provenance, and baseline and reconciliation are refused.
6. Browser check in Chromium, Firefox and WebKit, light and dark, desktop and phone, English and Arabic.
7. `docs/console.md` (actions, gate decisions and their limitation) and `docs/roadmap.md` (1.2.0, 1.3.0, 1.4.0 with all five milestones).
8. Full suite, then convergence and an independent review.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0031
**Type:** file
**Name:** owner-1.4-continue.md

Raw source preserved in: `.yallaflow/sources/SRC-0031/owner-1.4-continue.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0032
**Type:** file
**Name:** owner-option-b.md

Raw source preserved in: `.yallaflow/sources/SRC-0032/owner-option-b.md`. Read it directly; it is not duplicated here.
