# Architecture

YallaFlow is an AI-agnostic engineering workflow for Adaptive Spec-Driven Development. It is organized around four independent layers.

## Adaptive SDD model

Spec-Driven Development supplies the engineering contract; routing determines how much contract is appropriate. A bounded change can use a small requirement and verification path, while architectural work adds design exploration, specification, planning, and review. Bugs use evidence-backed root-cause analysis, and investigations remain read-only.

```text
Raw Requirement
→ Preserve Original Request
→ Project Context Discovery
→ Work Type + Scope
→ Adaptive Specification
→ Behavior Contract
→ Implementation / Verification
→ Durable Project Knowledge
```

Plain-text and file intake, and explicit project-knowledge promotion, are implemented. Tracker/message/email requirement-source adapters and automatic semantic extraction remain future architecture (see [`roadmap.md`](roadmap.md)).

### Intake adapters

```text
Source
→ Format Detection
→ Intake Adapter Registry
→ Normalized Intake Contract
→ Workspace Source Storage
→ Pending Work Item
```

**Format detection** (`src/intake/detect.js`) never trusts a file's extension alone for binary container formats: it checks magic bytes/signatures and reports a `mismatch` when they disagree (a fake `.docx` that isn't actually a zip is detected and routed to the generic binary handler, not parsed as if it were valid). Plain-text formats have no fixed signature and are trusted by extension — there is no meaningful "fake .txt".

The **adapter registry** (`src/intake/registry.js`) maps a detected format to exactly one adapter module under `src/intake/adapters/`. Adding a new format family means adding one registry entry and one adapter — never a switch statement scattered through CLI or command code. Each adapter returns `{ contentAvailability, text?, metadata? }`; `src/intake/file.js` is the orchestrator that ties detection, the registry, safety limits, and error handling together into the final **Normalized Intake Contract**: `{ sourceType, sourceName, detectedFormat, contentType, contentAvailability, rawText?, metadata }` — provider/source-neutral, without knowing anything about workspace storage or routing. `src/intake/text.js` does not exist as a separate module for plain-text *intake*; `yallaflow start "<request>"` still writes directly into a work item's `rawRequest`, unchanged since v0.1 (see [Compatibility](#file-intake-compatibility) below).

Workspace storage (`src/core/sources.js`) is a separate step that only runs after the orchestrator produces a normalized contract: it allocates a stable `SRC-####` ID (scanning `.yallaflow/sources/` the same way work IDs scan `.yallaflow/work/`, and never creating that directory merely to compute the next ID), copies the original bytes byte-for-byte under their own sanitized file name, writes any extracted text to its own `extracted.txt`, and writes a validated `source.json` record. A work item is then created exactly like a pending text intake, with a `sources: [{ id, type, name, detectedFormat, contentAvailability }]` reference — always an array, so a work item is never structurally limited to exactly one source. The same routing contract applies from there onward; **intake never infers a work type, scope, or title from a file's contents.**

The source file is evidence. Original Source (the copied file), Extracted Representation (`extracted.txt`, when one exists), Normalized Intake (the in-memory contract that produced it), and Specification (produced later, by the `specification` skill) are four distinct artifacts that may exist independently — file intake never silently collapses one into another, and never claims to have understood content it could not extract.

#### Support tiers

| Tier | Formats | `contentAvailability` |
| --- | --- | --- |
| 1 — Native text | `.txt .md .markdown .rst .csv .tsv .json .jsonl .yaml .yml .xml .html .htm .toml .ini .cfg .conf .properties .log .sql` and common source files (`.js .ts .tsx .jsx .php .py .java .cs .go .rs .rb .sh`, treated as plain text — language semantics are never interpreted) | `native-text` |
| 2 — Office / rich documents | `.docx .pptx .xlsx .rtf .odt .ods .odp` | `extracted` |
| 3 — PDF | `.pdf` | `extracted` |
| 4 — Images | `.png .jpg .jpeg .webp .gif .bmp .tif .tiff .svg` | `original-only` (no OCR/vision performed or claimed) |
| 5 — Generic binary | anything else, plus recognized-but-not-yet-implemented `.odg`/`.epub`, plus dangerous containers `.zip .tar .gz .tgz .7z .rar` (never auto-unpacked — zip bombs, path traversal, nested archives, executable payloads) | `original-only` |

`.docx`/`.pptx`/`.odt`/`.ods`/`.odp` extraction and generic PDF text go through `officeparser`; `.xlsx`/`.pptx` additionally get a structured pass (`src/intake/extractors/xlsx.js`, `pptx.js`) that reconstructs real sheet names and grid/slide sections — worth the extra parsing because that shape is part of the requirement, not incidental formatting. `.rtf` and `.pdf` are handled by small first-party extractors (`src/intake/extractors/rtf.js`, `pdf.js`); see "Parser decisions" in the release notes for why PDF specifically isn't routed through officeparser's own PDF path. If extraction fails for a format that should support it (a corrupt `.docx`, a malformed `.pdf`), intake does not fail the whole operation — it prints a warning, preserves the original file, and records `contentAvailability: 'original-only'` with the failure reason in `metadata.extractionError`. A file larger than the extraction size limit is preserved the same way, with `metadata.extractionSkipped` explaining why, rather than being parsed or silently truncated.

Each source also records a SHA-256 checksum of the *original* bytes for traceability and accidental-change detection (not semantic identity), and re-ingesting identical content never overwrites a prior source — it gets a new ID, with only a checksum-match warning.

#### File intake compatibility

`createPendingIntake(root, rawRequest, options)` grew a third, optional `options.sources` (array) / `options.titleHint` — existing two-argument callers (`yallaflow start`, and the majority of the test suite) are unaffected. A pending or routed work item without a `sources` field is exactly the pre-v0.3 shape; `guide`, `resume`, and `status` show a `Source:` line, with format and content availability, only when one is present. Nothing under `.yallaflow/sources/` is created merely by reading a workspace — not `doctor`, not `source list`, not `guide`/`resume`/`status` — only `yallaflow intake`/`intake add` create it, lazily, on first use; older workspaces without it remain fully valid with zero sources.

`source.json` itself is versioned independently of the package: schema v1 (v0.3.1) is still read and displayed correctly by every command — `loadSourceText()` in `src/core/sources.js` abstracts the version difference away from display code — and is never migrated or rewritten. New sources are always written as the current schema version.

### Architectural-feature lifecycle

Architectural work (`scope: architectural`) is the deepest lifecycle YallaFlow supports today:

```text
Raw Requirement
→ Discovery            (context-discovery)
→ Clarification         (requirement-clarification)
→ Design                (design-exploration)
→ Specification          (specification)
→ Planning               (implementation-planning)
→ Implementation          (implementation)
→ Verification            (verification)
→ Review                  (code-review)
→ Knowledge               (knowledge propose / promote)
```

Each named stage requires its corresponding skill's checkpoint to be `completed` before the work item can leave that stage — see [Durable execution progress](#durable-execution-progress). Bounded and spike work use a shorter workflow with fewer required skills; see `src/behavior/policy.js` for the exact capability set per work type and scope.

### Not every work item reaches implementation

Adaptive SDD does not require every work item to be implemented. A work item may legitimately stop once its specification or plan is reviewable, without pretending implementation happened:

- **`SPEC_READY`** — the specification is complete enough for stakeholder/engineering review; nothing has been planned or implemented yet.
- **`PLAN_READY`** — specification and implementation plan are both complete enough to hand off; implementation has not started.
- **`DONE`** — the workflow's requested outcome is complete, including verification and knowledge review where applicable.

See [Delivery readiness](#delivery-readiness) for how this is computed and reported.

## 1. Project Memory
Durable facts about the software: purpose, architecture, stack, database, integrations, environments, conventions, and ADRs.

## 2. Work Engine
Persistent work items with explicit type, scope, stage, evidence, decisions, verification, and knowledge-update lifecycle.

## 3. Skill Engine
Versioned package-owned engineering behavior contracts selected from workflow capabilities. The current foundation resolves and exposes guidance; it does not invoke agents or execute skills.

## 4. Execution Engine
Runs approved work with a configurable policy: native, reviewed, or multi-agent. Execution must be isolated when appropriate, recoverable from durable state, and independently verifiable.

## Authority hierarchy
1. Product/business intent and approved specification
2. Durable YallaFlow project knowledge and ADRs
3. Current work contract
4. Execution plan
5. Agent judgment, recorded as explicit rulings when needed

## Core invariants
- Discover before asking.
- Understand before changing.
- Prove before claiming.
- Remember after finishing.
- Investigation is read-only.
- Durable state beats conversational memory.
- Stage and readiness never silently contradict checkpoint state.
- Asking for help never mutates YallaFlow state, in any command namespace.
- Initializing a workspace never silently discards prior tracked state (filesystem or Git).

"Discover before asking" means technical unknowns are resolved from the repository whenever possible. User questions are reserved for business ambiguity, policy choices, acceptance criteria, and information the project cannot provide.

## Intent routing foundation

```text
User Request
→ YallaFlow Intake
→ Agent Classification
→ YallaFlow Validation
→ Workflow Selection
→ Work Execution
```

The coding agent owns semantic understanding, classification, and the reason for its decision. YallaFlow owns the allowed routing contract, deterministic validation, policy resolution, durable routing state, and auditability. The CLI does not call model providers or infer intent from request keywords.

Routing decisions are canonical in each work item's `meta.yaml`. `state/current.yaml` remains the active-work and stage pointer and does not duplicate routing decisions. `yallaflow route ... --title "<concise title>"` records an explicit, agent-supplied short title separately from the raw request; the raw request is preserved unmodified and title generation is never inferred by YallaFlow itself.

## Behavior model

> Skills define engineering behavior. Work items pin the behavior they were created with.

```text
Routing Decision
→ Workflow Policy
→ Required Capabilities
→ Skill Resolver
→ Pinned Behavior Contract
→ Agent Guidance
```

- **Workflow:** the authoritative lifecycle and transition sequence for the work.
- **Capability:** a stable policy identifier for required engineering behavior.
- **Skill:** versioned package-owned metadata and instructions implementing one capability contract.
- **Behavior contract:** the dependency-ordered skill IDs and registry version pinned when work is routed.

The registry validates metadata, ownership, prerequisites, dependency cycles, and instruction files deterministically. The resolver inserts prerequisites, removes duplicates, and preserves dependency-safe order without semantic inference.

New routed work stores only behavior identity in `meta.yaml`: registry version plus ordered skill IDs. Instruction Markdown remains package-owned and is retrieved with `yallaflow skill <skill-id>`; it is not copied into project metadata. Routed work from an earlier registry version that has capabilities but no snapshot receives a derived legacy view in memory; reading it never mutates project state, and its pinned contract is never rewritten to a newer registry version.

### The specification skill

Design, specification, and planning are three distinct concerns and remain three distinct skills:

```text
Design        — how should the solution be shaped?
Specification — what exactly must the system do?
Planning       — how will engineers implement the approved specification?
```

`specification` (capability `specify`) is read-only, requires `design-exploration` as a prerequisite, and is included in architectural work's Behavior Contract. It covers only the areas relevant to the work — goal/scope, actors, functional requirements, business rules, workflows, data/integration requirements, validation and error behavior, security/privacy, UI expectations, acceptance criteria, and unresolved items — without forcing empty sections or inventing missing business decisions. Its checkpoint distinguishes a `completed` specification from one recorded `blocked` on unresolved owner decisions; a draft specification can still be a valid, reviewable deliverable (`SPEC_READY`) even while blocked from becoming implementation-ready.

## Durable execution progress

```text
Behavior Contract
→ Skill Checkpoints
→ Work-scoped Progress Ledger
→ Resume
```

The Behavior Contract remains the identity of required engineering behavior. `.yallaflow/work/<id>/progress.yaml` records execution of that contract: per-skill status, timestamps, summaries, structural evidence references, local rulings, and a correction history. It is created only after an explicit checkpoint command. Missing ledgers resolve to an in-memory pending view and are never created by reads.

`state/current.yaml` remains only the active-work/stage pointer. It never contains skill progress, evidence, rulings, questions, or knowledge state. `meta.yaml` remains canonical for routing and Behavior Contract identity. This avoids competing sources of truth.

Checkpoint dependencies come from Skill Registry prerequisites, not arbitrary sequence enforcement. For architectural work, a workflow stage additionally cannot be exited until the checkpoint it requires is `completed` (`DISCOVERY` requires `context-discovery`, `CLARIFICATION` requires `requirement-clarification`, `DESIGN` requires `design-exploration`, `SPECIFICATION` requires `specification`, `PLAN` requires `implementation-planning`). `yallaflow advance` reports exactly which checkpoint or unresolved material decision is blocking the transition instead of failing silently. Before entering implementation, routed work must also complete every pre-implementation skill in its Behavior Contract. Investigation remains read-only even after every checkpoint is complete. The existing `verify` command remains the source of verification evidence; the verification checkpoint does not create a second verification system.

Local rulings can be recorded through `checkpoint` with a decision, reason, and cost if wrong. A local ruling explains execution choices for one work item. An ADR belongs in project decisions and records a durable architectural choice. A decision candidate may explicitly use `--from-ruling` to seed its ADR fields; the ruling remains unchanged.

### Checkpoint revision and history

A checkpoint recorded as `completed` in error, or invalidated by later findings, can be corrected explicitly and auditably:

```bash
yallaflow checkpoint revise PF-0001 --skill specification --status blocked \
  --reason "Material business decisions remain unresolved."
```

`checkpoint revise` accepts only `pending`, `in_progress`, or `blocked` as the corrected status — completion always goes through the normal `checkpoint --complete` path. Every correction appends a `{ skill, from, to, reason, changedAt }` entry to the ledger's `history`; prior state is never deleted. A correction requires an explicit, non-empty `--reason`.

If the corrected skill gates a workflow stage the work item has already advanced past, YallaFlow reconciles the workflow stage backward to the stage that skill's checkpoint gates, so stage and checkpoint state can never silently contradict each other. Correcting a checkpoint does not retroactively discard other, unrelated completed checkpoints — only the workflow stage pointer moves.

### Delivery readiness

Workflow **stage** ("where work currently is") and delivery **readiness** ("what deliverable is ready") are deliberately independent concepts. `yallaflow ready [work-id]` reports readiness derived from checkpoint and question state, without ever auto-starting implementation:

```text
PF-0001 — Contract Management System
Delivery status: SPEC_READY

Specification readiness: READY

Plan readiness: BLOCKED
- implementation-planning checkpoint is pending

Application implementation: NOT STARTED
Open material decisions: 0
```

- **Specification readiness** is `READY` once the `specification` checkpoint is `completed` and no material question remains open; otherwise it is `BLOCKED` with the specific reasons.
- **Plan readiness** additionally requires specification readiness and the `implementation-planning` checkpoint to be `completed`.
- **Delivery status** is `SPEC_READY`, `PLAN_READY`, or `DONE` in that order of precedence, or unset ("not ready") when neither readiness has been reached.
- **Application implementation** status (`NOT_STARTED` / `STARTED` / `COMPLETE`) reports separately from readiness and from whether code modification is currently authorized; reaching `PLAN_READY` never itself authorizes or starts implementation.

### Work decomposition

`Agent orchestrates. YallaFlow governs.` A work item may become a **parent** once — and only once — its own planning reaches `PLAN_READY` (reusing delivery readiness above rather than inventing a second "ready" concept):

```text
Raw Sources → Discovery → Clarification → Design → Specification → Planning → PLAN_READY
→ Work Decomposition (propose → validate) → Review (interaction-mode dependent) → Execute
→ Feature-by-feature Execution
```

`src/decomposition/store.js` never performs semantic requirement splitting — the Agent proposes the child breakdown (`yallaflow decompose propose <parent-id> --file decomposition.json`, structured input exactly like an intake file); YallaFlow only validates structure (non-empty unique keys, valid work type/scope, no self-dependency, no unknown dependency, no dependency cycle via DFS) and persists it. `yallaflow decompose validate` re-checks the stored proposal and reports requirements/acceptance-criteria traceability coverage: referenced, cross-cutting (referenced by more than one child — reported, never rejected, since a requirement may legitimately span several children), and unassigned (only computed when a `requirementsUniverse`/`acceptanceCriteriaUniverse` was declared — YallaFlow never invents what the total set of requirements is). `yallaflow decompose execute` is the one explicit, one-time boundary between planning and executing: it creates one normal, fully-routed work item per child (own type, scope, pinned Behavior Contract — reusing `routeWorkItem`'s exact contract-construction logic rather than a second, lighter task engine) and only then advances the parent into its write stage.

**Canonical ownership**: the parent's `decomposition.yaml` is the single source of truth for the child graph — keys, requirements/acceptance-criteria references, `dependsOn` (referencing sibling keys, resolved to work IDs once created), and `required`. Each child's own `meta.yaml`/`progress.yaml`/evidence remain that child's own lifecycle's single source of truth; a child carries only a `parent`/`decompositionKey` back-reference, never a duplicated dependency list or checkpoint mirror. `yallaflow progress <parent-id>` and `yallaflow next <parent-id>` derive their view live from this graph plus each child's current `meta.status` — a child is `done` (its own status is `DONE`), `blocked` (an unmet dependency), `active` (the workspace's current active work), or `ready` (dependencies satisfied); `next` reports every ready child without YallaFlow ever choosing one for the Agent.

A decomposed parent's `IMPLEMENTATION`-stage exit gate is replaced by "every required child is `DONE`" (see `decompositionBlockers` in `core/decomposition/store.js`, consulted by `core/transitions.js`'s stage-exit resolver) instead of its own `implementation` checkpoint, which is never meant to complete for a parent — the required children are the implementation. Its `VERIFICATION`, `code-review`, and knowledge stages are unchanged, so a decomposed project still gets a final, project-level verification/review/knowledge pass once every required child is `DONE`.

### Interaction modes and review gates

A durable per-project policy (`config.yaml`'s `interaction: { profile, mode, gates }`, `src/behavior/interaction.js`) controls which of 8 named boundaries (`discovery, clarification, design, specification, plan, decomposition, implementation, verification`) stop for explicit human/team review before the workflow may cross them. A `mode` (`autonomous` / **`adaptive`**, the default / `gated`) only selects the *default* preset for those 8 booleans; any project can override an individual gate without adopting a different mode's whole preset — this is how "not every project uses every boundary" is satisfied without special-casing per mode elsewhere in the codebase.

Review state is durable, in `.yallaflow/work/<id>/reviews.yaml` (`src/reviews/store.js`): `awaiting_review`, `approved`, or `changes_requested`, with full history — this is workflow evidence that a review step occurred, never a cryptographic or authentication claim about who ran the command. The same stage-exit resolver that checks checkpoint completion (`core/transitions.js`) also checks the matching gate (via `SKILL_TO_GATE`) once its checkpoint is complete, auto-requesting review the first time a configured boundary is hit and reporting an actionable, specific error. **Hard correctness gates — checkpoint completion, verification evidence, knowledge review, dependency completion for children — are never routed through the gate system, so no interaction mode can ever bypass them**, including `autonomous`.

A material revision to the reviewed artifact (`checkpoint revise`, `reopen`, or re-proposing an already-approved decomposition) invalidates that gate and every downstream gate in the same post-implementation dependency chain (see v0.3.3's `CASCADE_CHAIN`) back to `awaiting_review`; the prior approval is preserved in history, never deleted.

### Agent handoff

Conversation history is not authoritative project state. `yallaflow handoff [work-id]` (`src/commands/handoff.js`) assembles one compact, strictly read-only report from the same shared resolvers `guide` and `resume` already use — `loadWorkProgress`, `evaluateReadiness`, `buildBehaviorGuidance`, `discoverGitState` — rather than a fourth, competing lifecycle interpretation. `resume`, `guide`, and `handoff` intentionally answer three different questions: *what should I continue doing* (resume), *what workflow/skill behavior applies* (guide), and *compact, complete context for another agent or session* (handoff). For a decomposed parent, handoff additionally reports child DONE/active/blocked/ready counts, next executable candidates, and unresolved traceability gaps, reusing the decomposition primitives above rather than a separate parent-specific resolver.

### Primary unresolved objective (v0.3.5)

A pilot found that a replacement agent could recover stage/state after a reopen but still drifted into secondary regressions before addressing the actual reason the work was reopened. `src/behavior/objective.js`'s `resolvePrimaryObjective` is a small, shared resolver — consumed by both `handoff` and `resume`, never duplicated — that surfaces one durable fact as the `PRIMARY UNRESOLVED OBJECTIVE`: the most recent of (a) a reopen reason (`meta.lifecycleHistory`), or (b) a checkpoint-revision reason (the progress ledger's `history`), whichever timestamp is later; falling back to (c) the active write-authorization blocker when neither exists. It never infers an objective from code semantics — only from durable workflow facts already recorded elsewhere.

### Brownfield Baseline (v0.3.5)

Deterministic bootstrap (`core/discovery.js`, run at `yallaflow init` for a brownfield project) is cheap, mechanical seed data — package-manager/framework markers, CI/container hints. It is not, and was never meant to be, a reviewed project understanding. Before v0.3.5, an agent could reconstruct a rich understanding of an undocumented repository during a session, but nothing durable captured it unless a later feature happened to promote knowledge — a new agent session had to rediscover the same ground.

```text
Existing repository
→ deterministic bootstrap (seeds, does not replace, the baseline)
→ yallaflow baseline start           (read-only investigation work item)
→ repository/runtime discovery
→ yallaflow baseline draft --file    (evidence-backed facts: confirmed/inferred/unresolved)
→ human review (yallaflow baseline show/status)
→ yallaflow baseline approve          → durable PROJECT.md / context/*.md
   or yallaflow baseline feedback --changes-requested → revise → re-submit
```

`src/baseline/store.js` reuses the normal work-item lifecycle (`type: 'investigation'`, `readOnly: true` — no application code modification is authorized during baseline discovery) rather than a second work engine, and a single new, additive Skill Registry entry (`repository-baseline`, read-only; `REGISTRY_VERSION` bumped 2→3 — existing pinned v2 contracts are read exactly as pinned and are unaffected). Because baseline discovery has no meaningful intermediate investigation stages (`QUESTION`/`EVIDENCE`/`HYPOTHESIS`/...), `baseline approve` is a narrow, documented exception: it is the one deliberate transition straight into `DONE`, rather than forcing an unrelated 8-stage vocabulary onto a fundamentally different flow.

Every baseline fact carries a **confidence level** — `confirmed` (direct repository/runtime evidence), `inferred` (a strong interpretation, not explicitly declared), or `unresolved` (cannot safely be established) — a **provenance** (`repository`, `runtime`, or `user-confirmed`; prior chat/model memory is never evidence), and at least one evidence reference. Review reuses the same durable gate ledger (`reviews.yaml`, a `'baseline'` gate) v0.3.4 introduced for `specification`/`plan`/`decomposition`, rather than a second review mechanism.

**One promotion mechanism, two producers.** `src/knowledge/promotion.js` already had one idempotent, marker-guarded append primitive writing into `context/*.md` for ordinary work-scoped knowledge candidates. Baseline approval reuses that exact primitive (`appendMarkedSection`) for its own facts, through two new knowledge kinds — `project` (→ `PROJECT.md`) and `tech-stack` (→ `context/tech-stack.md`) — added to `CONTEXT_TARGETS` alongside the existing five. Whether a section in `context/architecture.md` came from a feature's `knowledge propose`/`promote` or from an approved baseline fact, exactly one mechanism ever wrote it; the two input pipelines can never produce two competing versions of the same durable document. Unresolved facts are promoted too, under the same marker convention — "this could not be established" is durable knowledge a future agent should not have to rediscover by guessing.

### Reliable verification execution (v0.3.5)

A pilot's compound/quoted verification commands changed meaning because the CLI joined `argv` back into a single string and executed it with `shell: true`. `yallaflow verify` now defaults to **argv mode**: `spawnSync(executable, args, { shell: false })`, preserving exact argument boundaries (including arguments containing spaces) with no shell reinterpretation. Two explicit alternatives cover genuine shell needs without ever guessing shell intent: `--shell "<command>"` (pipes, redirection — `shell: true`, deliberately) and `--script <path>` (a script file executed directly). All three modes use `stdio: ['inherit', 'pipe', 'pipe']` — stdin is inherited from the parent process (fixing a pilot's stdin-fed verification, previously detached) while stdout/stderr are still captured into the append-only evidence log. The verification ledger gained additive fields (`executionMode`, `executable`, `args`, `displayCommand`) on top of the v0.3.3 append-only schema; existing runs, and legacy pre-v0.3.3 single-record files, remain fully readable.

### Structured questions / decision ledger

Material business and architecture decisions are recorded structurally in `.yallaflow/work/<id>/questions.yaml`, not only as prose inside `work.md`:

```bash
yallaflow question add PF-0001 --category business --text "Can a contract receive multiple payments?"
yallaflow question add PF-0001 --category architecture \
  --text "Which document-generation strategy should be used?" --proposal "Server-generated PDF"
yallaflow question answer PF-0001 --id Q-001 --answer "Yes, up to three partial payments."
yallaflow question resolve PF-0001 --id Q-001
yallaflow question list PF-0001
```

Each question has a `category` (`business` or `architecture`), a `status` (`open`, `proposed`, `answered`, `resolved`), and an implicit `material` flag (true by default). Business clarification asks what behavior the product needs; architecture questions/proposals ask how the system should technically satisfy it. Neither is silently invented by YallaFlow. `guide` and `resume` surface open questions directly; reading the ledger never mutates it. An open **material** question blocks specification and plan readiness until it is resolved.

### Resume

Resume combines routing, contract identity, checkpoint state, workflow stage, delivery readiness, open questions, verification status, project-knowledge status, and safely discoverable Git status. A new session can therefore answer, without conversation memory: what is being built, its type/scope, what is completed, what is blocked, which questions are open, what deliverable is currently ready, what to do next, and whether it may modify application code.

### Rulings and ADRs

A local ruling is a task-specific execution decision stored in `progress.yaml` with its reason and cost if wrong. An ADR is a long-lived architecture or project decision stored under `decisions/`. An agent may explicitly seed a decision candidate from a numbered ruling, but promotion never mutates or automatically converts the ruling.

## Project knowledge promotion

```text
Completed Work
→ Agent Reviews Learnings
→ Work-scoped Knowledge Candidates
→ Promote / Reject
→ Project Memory
```

Work progress and project knowledge are separate domains. `progress.yaml` records how one work item was executed. `knowledge.yaml` records only agent-proposed candidates for stable future context, their disposition, and traceability. Neither belongs in `state/current.yaml`.

Knowledge kinds map deterministically:

- `architecture` → `context/architecture.md`
- `database` → `context/database.md`
- `integration` → `context/integrations.md`
- `environment` → `context/environments.md`
- `convention` → `context/conventions.md`
- `business-rule` → `context/business-rules.md`
- `decision` → `decisions/ADR-<work-id>-<candidate-id>.md`

YallaFlow validates structure and disposition but does not infer durable meaning, assess evidence truth, or semantically deduplicate prose. Context promotion is append-only and marker-protected. ADR promotion requires explicit context, decision, reason, and cost-if-wrong content.

New work pins a knowledge policy version, independently of the package and Skill Registry versions. That policy requires a `reviewed` knowledge ledger before `DONE`. Work without the marker is legacy and retains its previous completion behavior. Reads derive a pending in-memory view and never create `knowledge.yaml`.

### Knowledge source: design/spec vs. implementation/runtime

A knowledge candidate proposed against work pinned to registry v2+ must declare its `--source`:

- **`design-spec`** — durable knowledge established by design or specification work (a confirmed business rule, a selected architectural approach, an integration constraint). This may be reviewed and promoted once the work reaches a stable design endpoint (`SPEC_READY` or `PLAN_READY`), without requiring implementation or verification evidence.
- **`implementation-runtime`** — durable knowledge established by implemented, verified behavior. This still requires the work item to be at its normal completion stage (`VERIFICATION`/`DONE`, or `CONCLUSION`/`DONE` for an investigation) with fresh successful verification evidence, exactly as before.

The distinction is declared explicitly by the agent proposing the candidate; YallaFlow does not infer it semantically.

## Behavior gates

Workflow transitions remain authoritative. Guidance combines the current stage, work policy, resolved skill modes, and checkpoint completion to explain whether application-code modification is authorized. Investigations and bug spikes remain read-only. A bounded or architectural bug does not authorize writes before its `IMPLEMENTATION` stage or before discovery/debugging checkpoints are complete, even though its pinned contract includes the implementation skill. Reaching `PLAN_READY` readiness never itself authorizes implementation — the write gate opens only once the actual workflow stage and required checkpoints allow it.

## Core domain terminology

This is the canonical reference for YallaFlow's domain vocabulary. Other documents link here rather than redefining these terms.

| Term | Meaning |
| --- | --- |
| **Work Type** | The category of engineering work: `feature`, `bug`, `investigation`, `change`, `refactor`, or `release`. |
| **Scope** | How much process depth the work needs: `spike`, `bounded`, or `architectural`. |
| **Workflow** | The named, ordered lifecycle (sequence of stages) a work item follows, resolved from its work type (an `investigation`, or a `bug` routed as `spike`, always follows the read-only `investigation` workflow). |
| **Stage** | The work item's current position within its workflow (e.g. `DISCOVERY`, `SPECIFICATION`, `IMPLEMENTATION`, `DONE`). Describes *where work currently is* — distinct from Readiness. |
| **Capability** | A stable, workflow-policy-level identifier for required engineering behavior (e.g. `discover`, `specify`, `plan`, `implement`). |
| **Skill** | Versioned, package-owned instructions implementing exactly one capability, with a declared `mode` and `prerequisites`, retrieved with `yallaflow skill <skill-id>`. |
| **Behavior Contract** | The dependency-ordered set of skill IDs, plus the Skill Registry version, pinned to a work item when it is routed. |
| **Checkpoint** | A durable, explicit record (`pending`/`in_progress`/`completed`/`blocked`) of one skill's status for one work item, stored in `progress.yaml`. Never inferred from conversation. |
| **Readiness** | The deliverable-completeness model (`SPEC_READY`, `PLAN_READY`, `DONE`) derived from checkpoint and question state. Describes *what deliverable is ready* — distinct from Stage. |
| **Question** | A structured, work-scoped business or architecture decision recorded in `questions.yaml`, with a `category`, `status`, and `material` flag. |
| **Ruling** | A task-local execution decision (with reason and cost-if-wrong) recorded in a work item's progress ledger. Not itself durable project knowledge. |
| **ADR** | An Architecture Decision Record: a long-lived architectural decision document under `decisions/`, optionally seeded from a ruling. |
| **Knowledge Candidate** | An agent-proposed, work-scoped, stable fact or decision recorded in `knowledge.yaml`, pending promotion or rejection. |
| **Project Knowledge** | Durable project context under `context/*.md` or `decisions/*.md`, produced only by promoting a reviewed Knowledge Candidate. |
| **Source** | A captured, evidence-preserving intake artifact (`SRC-####`) recorded in `.yallaflow/sources/`, with its original bytes copied byte-for-byte, a detected format, a checksum, and a `contentAvailability` (`native-text`, `extracted`, or `original-only`) describing what text, if any, could be read from it. Linked to, but distinct from, the work item(s) it created. |

## Architecture freeze entering v0.3

The following contracts are **Core-stable** entering v0.3. "Stable" here means v0.3 integrations should consume these contracts rather than bypass or redesign them — it does not mean guaranteed 1.0 backward compatibility, and any breaking change to them is a deliberate, documented decision (see [`releasing.md`](releasing.md)):

- `.yallaflow` workspace ownership and directory layout
- `PF-####` work-item identity and persistence
- the routing contract (`work_type` / `scope` / `confidence` / `reason` / `title`)
- the Behavior Contract model (Skill Registry, capabilities, pinned contracts)
- the checkpoint model (`progress.yaml`, statuses, evidence, correction history)
- the questions/decision ledger (`questions.yaml`)
- the delivery readiness model (`SPEC_READY` / `PLAN_READY` / `DONE`)
- the verification gate (`evidence/verification.json`, fresh-evidence requirement)
- the knowledge model (`knowledge.yaml`, promotion targets, source distinction)

v0.3 integrations (tracker/source intake adapters, agent bootstrap) are expected to read and write through these contracts, not introduce parallel state.
