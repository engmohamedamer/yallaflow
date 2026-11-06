# PF-0032 — Console Create Work: one authenticated create-work action through Core intake/routing, with a backward-compatible no-activate Core option

## Raw Request

Console Create Work: one authenticated create-work action through Core intake/routing, with a backward-compatible no-activate Core option

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** feature
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow feature --scope architectural`.
**Timestamp:** 2026-11-06T11:09:06.865Z
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

- Owner (2026-11-06, SRC-0018): Create Work ships in 1.2.0; Q-003 revised (PF-0024 Q-005). Other console mutations, approvals, agent execution and chat stay out of scope.
- Owner: creating from the console must not replace an existing active task; activation needs explicit, well-defined semantics; existing CLI behavior unchanged.
- Owner (2026-11-06, SRC-0019): console-created work items never become the active work item automatically, even when no other item is active. The console reports each attachment's actual content availability.

## Discovery

See the context-discovery checkpoint. Today every creation (`start`, `intake <file>`, direct commands) and `route` set `activeWork`; `advance` only updates the stage of the item that is already active; `resume`/`guide <id>` inspect without changing focus; no command switches focus explicitly.

## Architecture / Technical Decisions

- Confirmed: the console creates work only by spawning this package's own CLI with an argv array (no shell): `start`, then `route` when the user classified it, then `intake add` per attachment. No second work engine.
- Confirmed: activation semantics (below) live in Core, not in the console.
- Proposed: two-step HTTP flow (create, then upload each file) so a failed attachment never hides the created item.

## Design

**Activation (Core).** The active work item is the checkout's default focus (what `guide`, `status` and `brief` show without an ID). Agents can always work on any item by ID.
- `start --keep-active -- <request>` (new, opt-in): the new item is created **without** becoming active and is recorded as `activation: {deferred: true, keptActive: <the unfinished active item, or null>}`. This holds whether or not another item is active (owner decision 2026-11-06, SRC-0019: creation and activation are separate actions). Without the option, `start` behaves exactly as before.
- A deferred item never takes focus by itself: `route`, `advance` and `checkpoint` on it leave `state/current.yaml` unchanged.
- `yallaflow activate <work-id>` (new, explicit): makes the item the active work item (stage from its record), prints the previous focus, and clears the deferral. Refuses DONE or unknown items.
- Without `--keep-active`, every command behaves exactly as before.

**Provenance (Core, Q-004).** `start --via console --request-id ID` records `attestation: {recordedVia: 'console', verified: false, requestId, at}` in meta and a ledger line "Created from the YallaFlow console (local user, identity not verified)". No identity is invented. `intake add --via console` adds the same note to the source line. Under the lock, `start --request-id` first looks for an item with that request ID and, if found, reports it and creates nothing: a retried request never duplicates.

**Console server.**
- `POST /api/p/:pid/work` — JSON `{requestId, request, type?, scope?}`. Runs `start --keep-active --via console --request-id ID -- <request>`; when the user chose a type, `route ID --type T --scope S --confidence high --reason "Classified by the user in the YallaFlow console." --title <first line of the request, ≤ 90 chars>`. Returns the created item from `work show --json` (with its real `nextAction`), plus `activated` and the kept active item.
- `POST /api/p/:pid/work/:PF/sources` — raw bytes (`application/octet-stream`), `X-File-Name`, `X-Request-Id`. Only for an item whose attestation carries that same request ID. Streams to a private temp dir (0700, file 0600), runs `intake add PF FILE --via console`, removes the temp dir in `finally`. A file whose SHA-256 is already linked to the item returns that source instead of a duplicate.
- Creates are serialized per project; reads are re-read after a write.

## Specification

### Goal and Scope

One narrowly scoped, authenticated Create Work action in the console. Out of scope: approvals, answers, any other mutation, starting or controlling agents, chat.

### Actors and Permissions

The local user who started `yallaflow console` and holds its per-run token. Identity is never verified; it is recorded as an unverified console attestation.

### Functional Requirements and Business Rules

REQ-001…REQ-005 (`yallaflow requirement list PF-0032`). Type options: feature, bug, change, investigation, or "let my agent classify it" (default; leaves routing pending). Scope options appear only after a type is chosen and have no default: Small (bounded), Large (architectural), Exploratory (spike). Core decides which combinations are valid and its message is shown.

### Workflows and Lifecycle

Create → (route if classified) → attach files → open the item. The item then follows its normal workflow through the agent. Brownfield projects without approved understanding: Core refuses, and the dialog shows Core's message.

### Data and Integrations

Meta gains `attestation` and, for deferred items, `activation` (additive, CLI-owned). Snapshot/work schemas are unchanged except additive fields. `/api/projects` gains `readOnly`.

### Validation and Error Behavior

- **Request text:** 1–20,000 characters.
- **Request ID:** 8–64 `[A-Za-z0-9-]`.
- **Type and scope:** checked against the lists above; Core validates again.
- **JSON body:** 64 KB at most (413).
- **Upload size:** Core's own extraction limit per file, imported from `src/intake/constants.js` (`MAX_EXTRACTION_INPUT_BYTES`, 50 MB; 413), so every attached file can still be read as text. Core's absolute source limit is 200 MB. (Owner approval note and ruling, 2026-11-06.)
- **Upload formats:** the documents, images and data formats intake extracts or previews (`.md .txt .rst .pdf .docx .pptx .xlsx .rtf .odt .ods .odp .csv .json .yaml .yml .png .jpg .jpeg .gif .webp`); anything else is 415.
- **Upload content:** an empty file is 400. The file name is reduced to a safe base name.
- **Error replies:** every failure is `{error:{code,message}}`.
- **Attachment failure after creation:** the reply includes the created item, so the user can open it.

### Security and Privacy

- **Writes:** `POST` on these two routes only. Every other route stays `GET`/`HEAD`.
- **Every POST needs:**
  - the Bearer token (401);
  - an `Origin` equal to the console's own (missing or foreign → 403);
  - the loopback `Host` (421);
  - the exact `Content-Type` (415).
- **CSRF:** cross-site requests can't set the `Authorization` header without a CORS preflight, and the server never answers one.
- **No shell:** user text is passed as one argv element after `--`, never interpolated.
- **Temp files:** created under `os.tmpdir()` with `mkdtemp` (0700), and removed even on failure.
- **`--read-only`:** the console flag disables both routes (405) and hides the button.

### UI / Screens

- **Entry point:** one "＋ Create work" button in the top bar (and the CTA in the empty-project welcome).
- **Dialog:**
  - project (shown only with more than one project);
  - requirement;
  - "What kind of work?" segmented control;
  - size, after a type is chosen;
  - optional files;
  - Create.
- **After creating:** the item page opens with the real next step, plus a one-line note: "Continue in Claude Code or Codex: ask your agent to continue PF-…".
- **Attachment results:** each file is listed with what YallaFlow could do with it: text read natively, text extracted, or the original preserved without readable text (with the reason when extraction failed). The Attachments tab shows the same.
- **Focus:** "Not made active. PF-0007 stays the active work item" (or "No work item is active"). Ask your agent to activate it or work on it by ID.
- **No new command buttons.** The command appears only in the existing "For developers" panel.

### Acceptance Criteria

AC-001…AC-006 (`yallaflow requirement list PF-0032`).

### Unresolved Items

None. Desktop Safari, Windows/macOS hosts and screen readers stay untested (documented limitation).

## Implementation Plan

1. **Core.**
   - Parse `start [--keep-active] [--via console --request-id ID] [--] <request>`. Legacy parsing applies when no new flag leads.
   - Record attestation/deferral in `createPendingIntake`.
   - Request-ID lookup under the lock.
   - `routeWorkItem` skips focus for deferred items.
   - New `activate` command.
   - `intake add --via console`.
   - Help, `docs/cli.md`.
2. **Console server.** The two POST routes with the guards above. The runner gets an uncached, serialized `write()`; `--read-only` flag; `/api/projects.readOnly`.
3. **UI.** Dialog, create flow, attachment progress and failure state, item-page next step, toast; Arabic/English, light/dark, keyboard.
4. **Tests.**
   - Core: activation and backward compatibility, request-ID idempotency, concurrent starts, attestation.
   - Server security: 401/403/421/415/413/405, shell metacharacters, temp cleanup, attachment failure keeps the item, retry, read-only.
   - Browser smoke tests and screenshots in Chromium, Firefox and WebKit.
5. **Docs.** `console.md`, `cli.md`, `architecture.md`, `limitations.md`, CHANGELOG, upgrade notes.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0017
**Type:** file
**Name:** owner-acceptance-findings-2026-11-06.md

Raw source preserved in: `.yallaflow/sources/SRC-0017/owner-acceptance-findings-2026-11-06.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0018
**Type:** file
**Name:** owner-approval-2026-11-06.md

Raw source preserved in: `.yallaflow/sources/SRC-0018/owner-approval-2026-11-06.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0019
**Type:** file
**Name:** owner-focus-decision-2026-11-06.md

Raw source preserved in: `.yallaflow/sources/SRC-0019/owner-focus-decision-2026-11-06.md`. Read it directly; it is not duplicated here.
