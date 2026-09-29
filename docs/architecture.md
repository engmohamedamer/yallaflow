# Architecture

YallaFlow is an AI-agnostic engineering governance layer for coding agents, providing durable project memory, adaptive workflows, and evidence-backed delivery. Adaptive Spec-Driven Development is the workflow philosophy it applies according to work type and scope — not ceremony for every task. The Agent orchestrates; YallaFlow governs state transitions; project memory persists. It is organized around four independent layers.

```text
Understand → Decide → Change → Verify → Remember → Revalidate when evidence changes
```

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
Durable facts about the software: purpose, architecture, stack, database, integrations, environments, conventions, and ADRs. Since v0.3.6 the canonical form is one structured ledger, `.yallaflow/context/index.yaml`; `PROJECT.md` and `context/*.md` are its human-readable projection of current facts. See [Living Project Memory](#living-project-memory-v036). Since v0.3.7, legacy knowledge enters it only through [reviewed reconciliation](#context-reconciliation--upgrade-intelligence-v037).

> **Work records preserve history. Project memory preserves current understanding.**

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
- Revalidate before trusting stale knowledge.
- Work history is immutable; project memory evolves (supersede, never rewrite).
- Legacy knowledge becomes current truth only through explicit, reviewed reconciliation — migration is not reconciliation.
- Passing verification is not delivered intent: where a delivery contract applies, DONE requires evidence-backed convergence on every active acceptance criterion.
- A change of approved intent is assessed before work continues; invalidation never deletes evidence.
- Requirement identity, convergence, and impact are work-delivery state, never project-memory facts.
- Agents never edit CLI-owned YallaFlow state directly when a supported command exists.
- Exactly one canonical structured source of truth for durable project knowledge, with exactly one writer.
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

A material revision to the reviewed artifact (`checkpoint revise`, `reopen`, or re-proposing an already-approved decomposition) invalidates that gate and every downstream gate in the same post-implementation dependency chain (see v0.3.3's `CASCADE_CHAIN`, which v0.3.8 extends with `delivery-convergence`) back to `awaiting_review`; the prior approval is preserved in history, never deleted.

### Agent handoff

Conversation history is not authoritative project state. `yallaflow handoff [work-id]` (`src/commands/handoff.js`) assembles one compact, strictly read-only report from the same shared resolvers `guide` and `resume` already use — `loadWorkProgress`, `evaluateReadiness`, `buildBehaviorGuidance`, `discoverGitState` — rather than a fourth, competing lifecycle interpretation. `resume`, `guide`, and `handoff` intentionally answer three different questions: *what should I continue doing* (resume), *what workflow/skill behavior applies* (guide), and *compact, complete context for another agent or session* (handoff). For a decomposed parent, handoff additionally reports child DONE/active/blocked/ready counts, next executable candidates, and unresolved traceability gaps, reusing the decomposition primitives above rather than a separate parent-specific resolver.

### Primary unresolved objective (v0.3.5)

A pilot found that a replacement agent could recover stage/state after a reopen but still drifted into secondary regressions before addressing the actual reason the work was reopened. `src/behavior/objective.js`'s `resolvePrimaryObjective` is a small, shared resolver — consumed by both `handoff` and `resume`, never duplicated — that surfaces one durable fact as the `PRIMARY UNRESOLVED OBJECTIVE`: the most recent of (a) a reopen reason (`meta.lifecycleHistory`), or (b) a checkpoint-revision reason (the progress ledger's `history`), whichever timestamp is later; falling back to (c) the active write-authorization blocker when neither exists. It never infers an objective from code semantics — only from durable workflow facts already recorded elsewhere.

### Brownfield Baseline (v0.3.5)

Deterministic bootstrap (`core/discovery.js`, run at `yallaflow init` for a brownfield project; since v0.3.9 it also lists nested manifest hints from the repository inventory under an *init-time snapshot* label) is cheap, mechanical seed data — package-manager/framework markers, CI/container hints. It is not, and was never meant to be, a reviewed project understanding. Before v0.3.5, an agent could reconstruct a rich understanding of an undocumented repository during a session, but nothing durable captured it unless a later feature happened to promote knowledge — a new agent session had to rediscover the same ground.

```text
Existing repository
→ yallaflow inspect                  (v0.3.9: bounded read-only inventory; never persisted)
→ deterministic bootstrap (seeds, does not replace, the baseline)
→ yallaflow baseline start           (read-only investigation work item)
→ material documents: yallaflow intake add <id> <doc>
→ repository/runtime discovery
→ yallaflow baseline draft --file    (evidence-backed facts: confirmed/inferred/unresolved)
→ human review (yallaflow baseline show/status)
→ yallaflow baseline approve          → durable PROJECT.md / context/*.md
   or yallaflow baseline feedback --changes-requested → revise → re-submit
```

`src/baseline/store.js` reuses the normal work-item lifecycle (`type: 'investigation'`, `readOnly: true` — no application code modification is authorized during baseline discovery) rather than a second work engine, and a single new, additive Skill Registry entry (`repository-baseline`, read-only; `REGISTRY_VERSION` bumped 2→3 — existing pinned v2 contracts are read exactly as pinned and are unaffected). Because baseline discovery has no meaningful intermediate investigation stages (`QUESTION`/`EVIDENCE`/`HYPOTHESIS`/...), `baseline approve` is a narrow, documented exception: it is the one deliberate transition straight into `DONE`, rather than forcing an unrelated 8-stage vocabulary onto a fundamentally different flow.

Every baseline fact carries a **confidence level** — `confirmed` (direct repository/runtime evidence), `inferred` (a strong interpretation, not explicitly declared), or `unresolved` (cannot safely be established) — a **provenance** (`repository`, `runtime`, or `user-confirmed`; prior chat/model memory is never evidence), and at least one evidence reference. Review reuses the same durable gate ledger (`reviews.yaml`, a `'baseline'` gate) v0.3.4 introduced for `specification`/`plan`/`decomposition`, rather than a second review mechanism.

**One promotion mechanism, two producers.** *(v0.3.6: the shared mechanism is now the project-context ledger writer — see [Living Project Memory](#living-project-memory-v036); the paragraph below describes the v0.3.5 design it replaced.)* `src/knowledge/promotion.js` already had one idempotent, marker-guarded append primitive writing into `context/*.md` for ordinary work-scoped knowledge candidates. Baseline approval reuses that exact primitive (`appendMarkedSection`) for its own facts, through two new knowledge kinds — `project` (→ `PROJECT.md`) and `tech-stack` (→ `context/tech-stack.md`) — added to `CONTEXT_TARGETS` alongside the existing five. Whether a section in `context/architecture.md` came from a feature's `knowledge propose`/`promote` or from an approved baseline fact, exactly one mechanism ever wrote it; the two input pipelines can never produce two competing versions of the same durable document. Unresolved facts are promoted too, under the same marker convention — "this could not be established" is durable knowledge a future agent should not have to rediscover by guessing.

### Reliable verification execution (v0.3.5)

A pilot's compound/quoted verification commands changed meaning because the CLI joined `argv` back into a single string and executed it with `shell: true`. `yallaflow verify` now defaults to **argv mode**: `spawnSync(executable, args, { shell: false })`, preserving exact argument boundaries (including arguments containing spaces) with no shell reinterpretation. Two explicit alternatives cover genuine shell needs without ever guessing shell intent: `--shell "<command>"` (pipes, redirection — `shell: true`, deliberately) and `--script <path>` (a script file executed directly). All three modes use `stdio: ['inherit', 'pipe', 'pipe']` — stdin is inherited from the parent process (fixing a pilot's stdin-fed verification, previously detached) while stdout/stderr are still captured into the append-only evidence log. The verification ledger gained additive fields (`executionMode`, `executable`, `args`, `displayCommand`) on top of the v0.3.3 append-only schema; existing runs, and legacy pre-v0.3.3 single-record files, remain fully readable.

## Living Project Memory (v0.3.6)

The YaSchools Brownfield pilot proved the baseline → durable context → fresh-agent-reuse loop, and exposed the next problem: project knowledge goes stale as the repository evolves, and append-only Markdown can end up holding two competing truths ("replica inactive" and "replica active") with no canonical indication of which is current.

```text
Work item (immutable history)          Project memory (evolves)
work/PF-0010/knowledge.yaml   ──K-001──▶  context/index.yaml  ──render──▶  context/database.md
  candidate: supersedes CTX-0017            CTX-0017 superseded → CTX-0048     (current facts only)
                                            CTX-0048 current (supersedes CTX-0017)
work/PF-0001/…  unchanged
```

**Ownership.** `src/context/ledger.js` owns the canonical ledger and is its only writer (`mutateContextLedger`: load → validate → apply transitions → validate → write the ledger → re-render affected projections). Only the ledger write is atomic — nothing is written if the result is invalid, and `index.yaml` is replaced via temp-file + rename. Ledger and projection are **not** one filesystem transaction: if rendering fails after the ledger write, canonical knowledge is intact, `doctor` reports the drift, `yallaflow context render` regenerates it deterministically, and retrying the originating `knowledge promote`/`baseline approve` is idempotent (`appliedTransition` recognizes a transition the same candidate or baseline fact already applied, so no fact, history entry, or lineage link is duplicated). There are two producers, both pre-existing: `knowledge promote` (`src/knowledge/promotion.js`) and `baseline approve` (`src/baseline/store.js`). Neither writes Markdown itself any more. `src/context/projection.js` owns exactly one managed block per durable document. Work items keep their own history (`knowledge.yaml` records the candidate, its declared relation, and the resulting `factId`; `baseline.yaml` keeps its `BF-###` facts) and are never edited when project understanding changes. There is no second knowledge system: candidates are still the only way knowledge enters or evolves.

**Fact schema** (`schemaVersion: 1` as introduced in v0.3.6 — v0.3.7 adds schema v2, see below; JSON-compatible YAML like every other ledger):

```json
{
  "id": "CTX-0048",
  "area": "database",
  "state": "current",
  "confidence": "confirmed",
  "summary": "Read replica is active for reporting.",
  "provenance": "repository",
  "origin": { "workId": "PF-0010", "candidateId": "K-001" },
  "evidence": [
    { "type": "repository", "path": "common/config/db.php", "contentHash": "sha256:…", "gitCommit": "abc123…" },
    { "type": "runtime", "description": "phpunit ReportingTest (passed)", "workId": "PF-0010", "verificationRunId": "V-002" }
  ],
  "verifiedAt": "2026-09-23T10:00:00.000Z",
  "verifiedAtCommit": "abc123…",
  "supersedes": ["CTX-0017"],
  "supersededBy": null,
  "history": [{ "action": "introduced", "at": "…", "workId": "PF-0010", "candidateId": "K-001", "supersedes": "CTX-0017" }],
  "createdAt": "…",
  "updatedAt": "…"
}
```

- **Identity** — `CTX-####`, global, sequential, never reused or renumbered. Areas are exactly the existing `CONTEXT_TARGETS` kinds (project, tech-stack, architecture, database, integration, environment, convention, business-rule); `decision` stays an ADR.
- **State vs confidence** — `state` (`current` | `superseded` | `disputed`) says whether the project currently believes it; `confidence` (`confirmed` | `inferred` | `unresolved`) says how strongly it was established. Two fields, not one overloaded vocabulary. A `disputed` fact carries a `dispute` record (summary, conflicting evidence, raisedBy); a `superseded` fact names its successor.
- **Evidence** — normalized from ordinary `--evidence` strings: an existing repository path (optionally `#symbol` / `:range`) records location, a sha256 content hash, and the current Git commit — never file contents, so secret values are never copied; `runtime:` / `verification:V-###` / `user:` record runtime and user-confirmed evidence; anything else is a free-text `reference` with no verification point. Knowledge *evolution* (supersede/reconfirm/dispute) requires at least one non-reference entry.
- **Provenance** — `repository` / `runtime` / `user-confirmed`, declared (`--provenance`, or the baseline fact's `source`) or derived from evidence types; `unspecified` exists only for reference-only legacy facts.

**Transitions** — declared by the Agent, validated by YallaFlow (the referenced fact must exist and be in a legal state; semantic equivalence is never inferred):

| Candidate relation | Allowed from | Result |
|---|---|---|
| none | — | new `current` fact |
| `reconfirms` | current, disputed | same ID and summary; evidence + verification point replaced, prior evidence kept in history; a dispute is resolved into history |
| `supersedes` | current, disputed | new `current` fact with `supersedes`; old fact `superseded` with `supersededBy`; excluded from Markdown |
| `disputes` | current | fact `disputed` with the conflicting evidence; rendered under "Disputed project knowledge" until reconfirmed or superseded |

A second candidate superseding an already-superseded fact is rejected, so two current successors can never exist for one fact.

**Mechanical freshness** (`src/context/freshness.js`, read-only, computed never stored): per repository evidence entry, compare the recorded content hash with the file now (or, for directory evidence, `git diff <recorded commit> -- <path>` plus untracked files). Any missing → `stale-evidence`; any changed → `may-be-stale`; all unchanged → `fresh`; no repository verification point → `unknown`; superseded → `historical`. Changed evidence means revalidation is needed, never that the fact is false — nothing is rewritten, invalidated, or superseded automatically. `factsAffectedByPaths` maps changed paths (explicit, working tree, or `--since REF`) to the facts citing them, for `context affected`. Revalidation itself is Agent work: targeted rediscovery, then reconfirm/supersede/dispute. There is no semantic refresh engine and no full re-baseline.

**Markdown projection.** One managed block per document, rendered deterministically from the ledger (current facts, then disputed facts under an explicit warning; superseded facts never). Everything outside the block is preserved byte-for-byte. Freshness is deliberately not rendered, so the projection changes only when the ledger does and drift is deterministic. `doctor` compares each block with what the ledger renders; `yallaflow context render` regenerates blocks explicitly.

**Discovery limitations** (`src/limitations/store.js`). A limitation (`not-inspected`, `unavailable`, `out-of-scope`, `runtime-unavailable`, `insufficient-evidence`; area; summary; reason) describes what one investigation could not inspect. It lives in `work/<id>/discovery.yaml` (created only by `yallaflow limitation add`) or a baseline draft's `limitations` array, is shown by `handoff` and `baseline show`, and never enters the ledger: `knowledge propose` refuses a candidate that restates a limitation of the same work item, a baseline draft refuses a fact that restates one of its limitations, and `doctor` fails if any ledger fact restates any recorded limitation.

**Compatibility.** No migration on read: a v0.3.5 workspace opens, reports, and passes `doctor` unchanged (unadopted legacy sections are a warning). The ledger is created lazily by the first new baseline approval or promotion; new facts then render into a managed block while legacy sections remain. `yallaflow context adopt [--dry-run]` is the explicit upgrade: it reads approved `baseline.yaml` facts and promoted `knowledge.yaml` candidates (never the Markdown prose), creates `adopted` facts with no verification point (`UNKNOWN` freshness until reconfirmed), removes only legacy sections that still exactly match the v0.3.5 template, and reports hand-edited ones. Baseline integrity accepts either a ledger fact originating from each approved `BF-###` or its legacy marker. A second approved baseline is still refused; living memory replaces baseline refresh.

**Integrity** (`src/context/integrity.js`, surfaced by `doctor`, never auto-repaired). Errors: malformed ledger/fact fields, duplicate IDs, unknown supersession targets, one-directional lineage, cycles, impossible states (superseded without successor, current with `supersededBy`, disputed without a dispute record), missing origin work items, malformed evidence or provenance, projection drift or a superseded fact still projected, and a discovery limitation recorded as a fact. Warnings: `MAY_BE_STALE`/`STALE_EVIDENCE`/disputed facts and unadopted v0.3.5 context — stale knowledge is a revalidation signal, not corruption.

**Handoff/resume** add a compact "Relevant project context" block from one shared summary (`src/context/summary.js`): totals, the stale/disputed facts, and any fact this work item's own candidates relate to that is stale — never the whole ledger — plus the work item's discovery limitations.

### Sparse workspace and `execution/` (v0.3.6)

Work creation (`createWorkItem`, `createPendingIntake`, decomposition children, `baseline start`) no longer creates `attachments/`, `evidence/`, or `execution/`. A new work item is `meta.yaml`, `work.md`, `progress.md`; `progress.yaml`, `questions.yaml`, `knowledge.yaml`, `discovery.yaml`, `reviews.yaml`, and `evidence/` appear when first written. **Decision:** `execution/` had no producer or consumer anywhere in the code, so it is reserved for a future structured execution-artifact feature and no longer created (rather than being filled with command dumps, which would add noise, duplication, and secret risk). `attachments/` likewise had no writer and is **retired**: the canonical `SRC-####` source system is the single home for user-provided inputs.

### Durable user-provided artifacts (v0.3.6)

The YaSchools pilot's bounded change came with text *and* a UI screenshot; the Agent used the screenshot in conversation, but nothing durable held it, so a later agent could recover the words but not the visual requirement. No new mechanism was needed: `yallaflow intake add <work-id> <file>` already copies the original byte-for-byte into an immutable, checksummed `SRC-####` (images as `original-only`), and links work item ↔ source both ways. v0.3.6 closes the remaining gaps without a parallel attachment system: the Agent contract and `requirement-clarification` skill now require registering *material* artifacts the Agent can access; `handoff`/`resume` list each linked source with the path of its preserved original; `doctor` fails when a referenced source is missing, does not link back, or its original is missing or no longer matches the checksum recorded at capture (sources are immutable — a new version is a new `SRC-####`); and an artifact the Agent could not access is recorded as a work-scoped `uncaptured-artifact` discovery limitation (area `requirement`) rather than implied to be preserved. Existing directories remain valid and are never deleted.

### One canonical work-creation path (v0.3.6)

**Every newly created routed work item is governed by the same workflow policy, Skill Registry, Behavior Contract, knowledge policy, and integrity rules regardless of which public CLI entry path created it.** `createRoutedWork` (`src/behavior/routing.js`) is exactly `start` → `route`: it validates the routing decision and resolves the workflow policy before writing anything, then calls `createPendingIntake` and `routeWorkItem`. The direct shortcuts (`feature|bug|investigate|change|refactor|release`) use it with the user's explicit classification (type from the command, scope from the now-required `--scope`, confidence `high`, reason naming the command); without `--scope` they create nothing. The legacy `createWorkItem`, which wrote contract-less work, was removed from product code; contract-less items written by earlier versions remain readable and keep their stage-only behavior (tests build such fixtures with `test-support/legacy-work.js`, kept outside `test/` so the runner does not load it as a test module).

### Lifecycle invariant (v0.3.6)

**Any state reachable through supported YallaFlow commands satisfies YallaFlow's own integrity rules.** The pre-freeze audit found two violations, both fixed at the transition rather than by weakening `doctor`: (1) an investigation (no VERIFICATION stage) could advance CONCLUSION → DONE with its pinned `verification` checkpoint pending — DONE now requires that checkpoint for every workflow whose contract includes it; (2) read-only work could complete `verification` without evidence — completing it now requires fresh successful evidence for all work (`yallaflow verify` runs a read-only proof command). Two related paths were closed the same way: a failing `verify` recorded after the verification checkpoint was completed returns the checkpoint to `in_progress` through the audited revision path (history entry, cascade, freshness boundary), and `verify` on DONE work is refused with the reopen path (or, for investigation workflows that cannot be reopened, a new-work-item hint). Evidence stays append-only; failed runs are never hidden.

### Agent contract versioning (v0.3.6)

`src/agent/contract.js` owns the package agent guidance. `AGENT.md` is project-owned; YallaFlow manages only a marked block recording the contract version and a hash of its body. `inspectAgentContract` (read-only; used by `doctor` warnings, `status`, `agent status`) classifies the file as current / outdated / modified / newer / legacy-generated / legacy-customized / broken / missing. Pre-v0.3.6 files are recognized as unmodified only by byte-exact fingerprints of every template YallaFlow ever generated (recovered from git history: v0.1–v0.3.4 and v0.3.5). `agent refresh` is the only writer: it updates only the managed block, replaces only unmodified generated files, refuses customized or hand-edited guidance unless `--preserve-existing` (kept verbatim under *Preserved project instructions*), refuses downgrades, supports `--dry-run`, and is idempotent. Bump `AGENT_CONTRACT_VERSION` whenever the guidance changes.

### Recovered sources (v0.3.6)

Every new source link records `linkedAt`, `workStatusAtLink`, and `relationship` on the work item's `sources` entry (`work-input`, or `recovered-source` for DONE work, which also requires a `reason`). A recovered link leaves the work DONE, does not append to `work.md` (the record of the work as executed) — only the append-only `progress.md` — and is labelled in `handoff`, `resume`, and `source show` as not available during the original execution. The `SRC-####` record and its bytes are unchanged; `doctor` checks recovered links for their audit metadata and every linked original for its capture checksum. Links made before v0.3.6 have no timing metadata and are shown as work inputs.

### Next valid action (v0.3.6)

`evaluateAdvance` (`src/core/transitions.js`) is now the single interpretation of "may this work item leave its stage?", used by `advance` (which may still record a newly requested review gate) and, read-only, by `guide` and by `advance`'s post-transition report. It returns the first blocker and the exact next valid command (checkpoint, `verify … -- <command>`, `approve … --stage`, question resolution, knowledge disposition, or `advance`), so an agent no longer needs repeated advance/guide round-trips. `advance`'s error messages are unchanged; stage transitions were not redesigned.

## Context Reconciliation & Upgrade Intelligence (v0.3.7)

The clean YaSchools v0.3.5 → v0.3.6 upgrade exposed the next problem. `context adopt` could find all 53 legacy sections, but several were the same durable truth recorded by different work items in different words, and blind adoption would have turned each into its own current fact. Deciding sameness, refinement, supersession, or contradiction takes engineering reasoning, and the CLI never performs semantic inference.

```text
Work history (immutable)      Reconciliation (interprets, never rewrites)          Project memory (evolves)
PF-0001 baseline.yaml BF-013 ─┐                                                    ┌▶ CTX-0002 current
PF-0002 knowledge.yaml K-002 ─┴▶ PF-0006 reconciliation.yaml                       │   origins: PF-0001 BF-013,
                                 RC-0013 new · RC-0053 merge-with RC-0013 ──apply──┘            PF-0002 K-002
                                 approval: sha256 of candidates + decisions         PF-0006 legacy-context.md (archive)
```

**Reused primitives, no second memory system.**

- A reconciliation is an ordinary read-only work item (`reconciliation: true`, the Brownfield Baseline shape), so the work lifecycle, `guide`/`resume`/`handoff`, `questions.yaml` (unresolved ambiguity), `discovery.yaml` (limitation outcomes), and the `reviews.yaml` gate ledger (new `reconciliation` gate) all apply unchanged.
- The plan (`work/<id>/reconciliation.yaml`) is the durable reconciliation history. It is never part of the canonical ledger.
- Canonical memory changes only through `mutateContextLedger`. Preview uses `simulateContextLedger`, which runs the same operations against a deep copy with no I/O, so preview and apply share one application model (`buildApplication`).

**Plan model** (`src/reconciliation/plan.js`, pure).

- Candidates are frozen at `start` with deterministic IDs.
- `resolvePlan` resolves every relation to a *node*: a candidate that becomes its own fact this round, or an existing CTX fact, including the fact an earlier round produced.
- It separates structural errors (unknown, self, cyclic, conflicting, undecided, or non-fact-producing targets) from state issues (a target the ledger has since moved past).
- `planHash` fingerprints candidates and decisions and excludes apply bookkeeping, so applying an approved plan never invalidates its own approval, while any content change does.

**Apply semantics** (all candidates of one round, one atomic ledger write).

- Fact-producing candidates (`new`, `supersedes`) are created in supersession-dependency order. Their merge/reconfirm members join at creation, with evidence taken as the union of the members' legacy evidence and `verifiedAt` as the latest recorded time.
- Members joining an existing fact get `attachOrigin`: provenance only, with evidence, verification point, and freshness unchanged.
- Disputes run last.
- Idempotency is keyed on origins (`appliedTransition` now also checks `origins` and `merged` history), so a crash between the ledger write and plan bookkeeping is finished by a plain retry.

**Multi-origin facts.**

- **Storage contract.** Schema v1 facts record `origin`. Schema v2 facts record only `origins`, which v0.3.6 cannot read (its reader requires `schemaVersion: 1`). There is one canonical field per schema, never both, and `validateContextLedger` rejects divergent or cross-schema provenance.
- **Reads.** A ledger is read exactly as stored (no migration on read) through one accessor, `factOrigins()`. A schema newer than v2 is refused up front by `loadContextLedger`, and `probeContextSchema` reports it read-only for `upgrade status`/`brief`.
- **Writes.** `applyToDraft` converts the draft to the working form (`origins` on every fact, keys renamed in place), runs the operations, and writes at `max(current, minSchema, requiresSchemaV2 ? 2 : 1)`. Ordinary work on a v1 ledger stays v1 and byte-stable. Reconciliation apply passes `minSchema: 2`. A ledger is never downgraded.
- **Normalizing vs. keeping both fields.** Normalizing to a single field per schema was chosen over keeping both `origin` and `origins`, because two fields could diverge silently.
- An origin may carry `{ reconciliation: { workId, candidate } }`.
- The ledger rejects duplicate origins within a fact and across facts.

**Legacy Markdown.** A reconciled section is retired only when it is byte-for-byte what v0.3.5's `factSection`/`contextSection` generated from the candidate's own record (`generatedLegacySectionPattern`; only the timestamp value is a wildcard). It is archived verbatim first. Any hand edit keeps the section, and `doctor` flags it for review. A still-generated reconciled section left in a document is an error: parallel current truth.

**`context adopt`** is kept for the provably trivial case only (one legacy item, no current facts). Everything else is refused with zero mutation and points to reconciliation. No shortcut bypasses review.

**Upgrade intelligence and orientation.**

- `collectDoctorReport` (extracted from `doctor`) is the single interpretation of workspace health.
- `assessWorkspace` (`src/core/assessment.js`) aggregates it with agent-contract state, project memory, pending legacy items, reconciliation status, sources, and Git durability. This backs the read-only `upgrade status`, `upgrade plan`, and `brief`.
- None of these migrate, repair, or infer anything.

**State ownership** (`src/core/ownership.js`).

- An explicit table classifies every file YallaFlow writes: CLI-owned, projection, shared (`work.md`), or human.
- A test asserts that a full lifecycle writes no unclassified file.
- The agent contract names every CLI-owned file.
- `doctor` checks what is deterministic: strict schemas, approval fingerprints, projection drift, checksums, and the `work.md` Routing Decision against `meta.yaml`.
- This is guidance plus integrity checks, never locking.

**Merge vs. reconfirm.**

- `merge-with` collapses candidates that are the same statement into one canonical fact. Its target must be another candidate, and cross-area merges are allowed for misfiled duplicates.
- `reconfirms` records one more historical observation of a truth already represented (a CTX fact or another candidate's fact). It must be the same area, the rule `knowledge --reconfirms` already applies.
- Both use `attachOrigin`, but history keeps `merged` vs `reconfirmed`, and preview labels every member with its action.

**Versions.** Agent Contract v3 (new behavior rules). Skill Registry v4 (new `context-reconciliation` skill; pinned work unaffected). Context ledger schema v2, written only when needed. Reconciliation plan `schemaVersion: 1`.

## Delivery Convergence & Agent Continuity (v0.3.8)

Every pilot so far could prove that tests passed; none could prove that what was delivered is what was asked for. v0.3.8 connects the approved intent to delivery evidence, keeps that connection honest when intent changes mid-flight, and lets a cold agent session find all of it.

```text
Original intent (request, SRC-####, answered Q-###)
      ↓
Specification (work.md — authoritative)       → requirements.yaml   REQ-### / AC-###
      ↓
Implementation → Verification (V-###)         → convergence.yaml    CV-### findings, UR-###
      ↓
DONE only when every active AC is currently satisfied
      ↓                                          impact.yaml        IM-### when intent changes
Durable project knowledge (knowledge flow, unchanged) → next agent session (brief / AGENT.md)
```

> **Verification ≠ review ≠ convergence.** Verification: do the recorded technical checks pass? Review: is the implementation technically acceptable? Convergence: does the delivered implementation satisfy the approved requirement and acceptance intent? **The Agent determines semantic meaning; YallaFlow validates and records it.**

**Delivery state is not project memory.** Requirement identity, convergence, and impact assessments are work-delivery records under `work/<id>/`. They never enter the CTX ledger; only stable knowledge learned as a consequence of the work goes through the existing knowledge-review/promotion flow. Intent, delivery evidence, and current project truth stay three distinct concepts.

**Policy — the Behavior Contract is the authority.** Skill Registry v5 adds one skill, `delivery-convergence` (capability `converge`, review-only, prerequisite `verification`), pinned by workflow policy for `feature/bounded`, `feature/architectural`, and `change/architectural`. Convergence, requirement identity, and impact assessment apply exactly when a work item's pinned contract includes it (`src/delivery/policy.js`). Bounded changes, bugs, refactors, releases, investigations, and anything pinned to registry ≤ v4 are untouched — there is no configurable delivery policy and no ceremony for work without a meaningful acceptance contract. The *intent checkpoint* is `specification` when the contract has one, otherwise `requirement-clarification`.

**Requirement identity** (`src/delivery/requirements.js`, `requirements.yaml` schema v1). Work-scoped `REQ-###` and `AC-###`, proposed by the Agent, never renumbered or reused; cross-work references are `PF-0001/AC-004`. Each entry is a short statement plus provenance (`request`, a `specification` section, a linked `source` SRC-####, an answered `question` Q-###) and a status (`active`, `withdrawn`, `deferred` — the last two with a reason and kept visible). Recording is an upsert with whole-file validation; revisions keep the previous content in history. The ledger holds no implementation or convergence status — that is derived from `convergence.yaml`. Completing the intent checkpoint requires at least one active criterion. A decomposed child whose parent owns a ledger answers for the parent's criteria assigned to it (read through, never copied), and `decompose propose` resolves child references against the parent's ledger (the coverage universe is derived from the ledger's active set at read time and never copied); a criterion a not-yet-DONE child answers for cannot be withdrawn or deferred on the parent; parents without a ledger keep the v0.3.4 free-form labels.

**Convergence ledger** (`src/delivery/convergence.js`, `convergence.yaml` schema v1, append-only). An assessment `CV-###` records, per assessed criterion, one Agent-declared finding — `satisfied` (implemented and demonstrated by the cited evidence), `partial` (some but not all of it), `missing` (not implemented), or `contradicts` (the implementation behaves contrary to it) — with a reason and evidence, plus unrequested behavior `UR-###` (`open` → `accepted` with a reason, or `removed`). Evidence reuses the context evidence normalizer (repository path + content hash + commit, `verification:V-###`, runtime/user observations, references) plus `convergence:PF-####/CV-###` for a direct child's assessment that recorded the criterion as satisfied (stale whenever the child's current finding is); `satisfied` needs more than free-text references and cannot rest on a failed run; `.yallaflow/` paths are never evidence. Assessment requires a completed verification checkpoint. Assessments may cover some criteria; the *current* view is derived per active criterion from its latest finding. A finding is **stale** — history intact, current reliability gone — when it was recorded before `lastInvalidationAt` (reopen/revision), before an impact assessment that invalidated convergence, before its criterion was revised, or when a repository file it cites changed or disappeared, or it cites a verification run from before the latest invalidation. Nothing is ever converted or deleted.

**The delivery gate.** For delivery-convergence contracts, `evaluateAdvance` (the single "may this leave its stage?" resolver) blocks DONE until every active criterion is currently satisfied, no unrequested behavior is open, the `delivery-convergence` checkpoint is completed, and every pinned checkpoint is completed again (an impact can reopen a pre-implementation checkpoint without a stage of its own); completing the checkpoint requires the same convergence. The blocker lists each gap (`AC-003 → partial`, `AC-007 → stale (evidence src/x.php changed since CV-002)`) and the next valid action. `CASCADE_CHAIN` becomes `implementation → verification → delivery-convergence → code-review`, so reopen (to implementation or verification), checkpoint revision, and a failing verification after the checkpoint was completed invalidate convergence through the existing path (`reopen --to review` now leaves the verification freshness boundary where it was); revising `delivery-convergence` alone does not move the verification freshness boundary. A gap recorded after the checkpoint was completed returns it to `in_progress` through the audited revision path, exactly as a failing verification does. SPEC_READY and PLAN_READY are unchanged.

**Change impact** (`src/delivery/impact.js`, `assess.js`, `impact.yaml` schema v1). Once the intent is fixed on in-flight work — the intent checkpoint completed, or any later checkpoint already started, so revising the intent checkpoint back cannot open a bypass — two events change approved intent: a source attached with `intake add`, or a change recorded with `requirement record`. YallaFlow raises a pending `IM-###` deterministically (further triggers join it) and never judges what the change means. While it is pending, `advance`, checkpoint completion, and `convergence record` are refused, and guidance withholds write authorization. The Agent assesses every completed stage `affected`/`unaffected` with a reason; YallaFlow enforces the mechanical rules (an affected post-implementation stage makes every later one affected; any affected stage, or a changed acceptance criterion, makes convergence affected) and revises the affected checkpoints through `reviseCheckpoint` + `reconcileStageAfterCheckpointRevision` — progress history, stage correction to the earliest affected stage, review-gate invalidation, verification freshness boundary. There is no second lifecycle engine, and no verification, review, or convergence evidence is deleted. DONE work is unchanged: a source attached to it stays a recovered source, and changed intent means a reopen.

**Continuity.** `guide`, `resume`, and `handoff` share one compact delivery block (`src/delivery/summary.js`): intent size, convergence counts, up to five blocking criteria, open unrequested behavior, and any pending impact — never the ledgers; `brief` shows its first lines for the active work and `status` notes a pending impact. A pending impact becomes the primary unresolved objective (and `brief`'s primary next concern).

**First-party agent bootstrap** (`src/agent/bootstrap.js`). `.yallaflow/AGENT.md` stays the only behavioral contract (Agent Contract v4 adds the delivery sequence). `agent setup codex|claude` adds a thin, versioned, hash-checked managed block to the provider's repository-root session file — `AGENTS.md` for Codex, `CLAUDE.md` for Claude — holding only the session-start sequence (detect → AGENT.md → `brief` → `resume`/`guide` → follow the pinned contract → record through YallaFlow) and a pointer to AGENT.md. Claude Code expands `@path` imports in CLAUDE.md, so the Claude block imports `@.yallaflow/AGENT.md`; Codex has no import syntax, so its block names the file. Content outside the block is project-owned and preserved byte-for-byte (the block is appended); installed providers are detected from markers alone; `agent status` reports each block's state, `agent refresh` updates unmodified outdated blocks, hand-edited blocks need `--preserve-existing`, newer blocks are never downgraded, and `doctor`/`upgrade plan` report stale blocks as warnings. Provider knowledge lives only in `src/agent/` and the agent command surface (tested).

**Integrity** (`src/delivery/integrity.js`, surfaced by `doctor`). Errors: malformed ledgers, duplicate IDs, a criterion naming an unknown requirement, impossible statuses, satisfied without supporting evidence, findings naming unknown criteria, missing verification runs or child assessments, provenance naming unlinked sources or missing questions, delivery state on work without a delivery contract, impact revisions without the matching audited progress entry, DONE with a pending impact, and a DONE/completed-checkpoint state the recorded findings never supported. Warnings: findings that were current when recorded but have gone stale since (evidence drift, a criterion revised later — for example by a parent), and specification provenance that `work.md` no longer mentions. History is never rewritten because of either.

**Versions.** Package `0.3.8-internal.1`. Agent Contract v4. Skill Registry v5. `requirements.yaml`, `convergence.yaml`, `impact.yaml` schema v1. Provider bootstrap block v1. Knowledge policy unchanged. New delivery ledgers are written atomically (temp file + rename, the context ledger's helper, now shared); no existing file changes schema, and nothing is migrated on read.

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

YallaFlow validates structure and disposition but does not infer durable meaning, assess evidence truth, or semantically deduplicate prose. Since v0.3.6, context promotion writes a canonical fact into `context/index.yaml` (optionally reconfirming, superseding, or disputing an existing fact the Agent names explicitly) and re-renders the document's managed block; the v0.3.5 append-only, marker-protected sections that already exist remain valid until explicitly adopted. ADR promotion requires explicit context, decision, reason, and cost-if-wrong content.

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
| **Requirement / Acceptance Criterion** | Work-scoped, Agent-proposed stable identities (`REQ-###`, `AC-###`, cross-work `PF-####/AC-###`) for approved intent, recorded in `requirements.yaml` with provenance and status (`active`/`withdrawn`/`deferred`). The specification stays authoritative. |
| **Convergence** | Whether the delivered implementation satisfies the approved intent: per active criterion an Agent-declared, evidence-backed finding (`satisfied`/`partial`/`missing`/`contradicts`) in append-only `convergence.yaml` assessments (`CV-###`), plus unrequested behavior (`UR-###`). Distinct from verification and review. Current or stale is derived, never stored. |
| **Impact assessment** | The Agent's per-stage `affected`/`unaffected` verdicts (`IM-###`, `impact.yaml`) after approved intent changed on in-flight work; YallaFlow applies them through audited checkpoint revision. |
| **Readiness** | The deliverable-completeness model (`SPEC_READY`, `PLAN_READY`, `DONE`) derived from checkpoint and question state. Describes *what deliverable is ready* — distinct from Stage. |
| **Question** | A structured, work-scoped business or architecture decision recorded in `questions.yaml`, with a `category`, `status`, and `material` flag. |
| **Ruling** | A task-local execution decision (with reason and cost-if-wrong) recorded in a work item's progress ledger. Not itself durable project knowledge. |
| **ADR** | An Architecture Decision Record: a long-lived architectural decision document under `decisions/`, optionally seeded from a ruling. |
| **Knowledge Candidate** | An agent-proposed, work-scoped, stable fact or decision recorded in `knowledge.yaml`, pending promotion or rejection. |
| **Project Knowledge** | Durable project context, produced only by promoting a reviewed Knowledge Candidate or approving a Brownfield Baseline: context facts in the canonical ledger `context/index.yaml` (projected into `PROJECT.md`/`context/*.md`), and ADRs under `decisions/*.md`. |
| **Project Context Fact** | One canonical unit of project memory (`CTX-####`) in `context/index.yaml`, with an area, a *state* (`current`/`superseded`/`disputed`), a *confidence* (`confirmed`/`inferred`/`unresolved`), a provenance, its originating work item, structured evidence, a verification point, and supersession lineage. |
| **Freshness** | A mechanical, read-only comparison of a fact's repository evidence with the working tree: `fresh`, `may-be-stale` (evidence changed since verification — revalidate, not "false"), `stale-evidence` (evidence missing), or `unknown` (no verification point). Never stored and never changes a fact. |
| **Evidence** | Proof produced or captured during engineering/verification (verification runs and logs under `work/<id>/evidence/`, checkpoint evidence references). Never a Source. |
| **Generated Artifact** | An optional output created by the work itself (e.g. an export, a report); lives with the application, not under `sources/`. |
| **Discovery Limitation** | A work-scoped record (`discovery.yaml` or a baseline draft's `limitations`) of what an investigation could not inspect (`not-inspected`, `unavailable`, `out-of-scope`, `runtime-unavailable`, `insufficient-evidence`). Describes the session, not the project; never promoted into project context. |
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

## Repository inventory and project-first orientation (v0.3.9)

**Inventory** (`src/inventory/`). `inventoryRepository(root)` is the one new primitive: an in-memory, deterministic, bounded walk that is never persisted.
- **Walk:** breadth-first over entries sorted by code point, never following symlinks, skipping `IGNORED_DIRECTORIES`, bounded by `INVENTORY_MAX_DEPTH` and `INVENTORY_MAX_ENTRIES` (truncation is reported).
- **What it records:**
  - recognized manifests (`MANIFEST_FILES`, `MANIFEST_EXTENSIONS`) at any depth;
  - recognized source files counted by extension (`SOURCE_CODE_EXTENSIONS`, never read);
  - documentation candidates, whose extensions are exported by `src/intake/constants.js` (`DOCUMENT_FORMAT_EXTENSIONS`, derived from `EXTENSION_FORMATS`) so inventory and intake never disagree;
  - container/CI files.
- **Bytes read:** only manifests and container/CI files, size-capped.
- **Framework hints** (`src/inventory/frameworks.js`): read from manifest text alone, with no lockfiles and no cross-file POM resolution.

`classifyProject(inventory)` is the deterministic Brownfield rule, and `detectProjectKind` and `init` delegate to it. Brownfield requires one of:
- a manifest plus at least one recognized source file;
- at least `BROWNFIELD_SOURCE_FILE_THRESHOLD` (10) recognized source files;
- meaningful container/CI configuration: a non-whitespace line that is not a full-line `#` or `//` comment.

`yallaflow inspect` renders the inventory as text and derives one next action from workspace state. Its baseline steps come from `baselineNextStep` in `src/baseline/store.js`, which `brief` and `baseline status` share.

**Brief** (`src/commands/brief.js`). `brief` reads in this order: project, then work, then YallaFlow.
- **Project block:** current facts in a fixed area order with fixed caps (`BRIEF_AREAS`, `BRIEF_SAMPLED_AREAS`), in fact-ID order, each rendered by `oneLine` (whitespace collapsed; truncated with an ellipsis only beyond 160 code points).
- **NEEDS CARE** (`needsCare` in `src/context/summary.js`): exactly the non-superseded facts that are unresolved, disputed, `MAY_BE_STALE`, or `STALE_EVIDENCE`. It is mechanical state, not risk; there is no ledger field and no schema change.
- **Without memory:** only then does `brief` run the inventory and show the baseline step.
- **Cap:** `BRIEF_MAX_LINES` (45).

`context status` adds its freshness explanation only when `gitHead(root)` is null.

**Versions.**

| Item | Version |
|---|---|
| Package | `0.3.9-internal.1` |
| Agent Contract | **v5** |
| Skill Registry | v5 (unchanged; only the `repository-baseline` instruction text was refined) |
| Provider bootstrap block | v1 |

No workspace schema changed, and the inventory has no on-disk form.
