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

Plain-text intake and explicit project-knowledge promotion are implemented. External requirement-source adapters and automatic semantic extraction remain future architecture (see [`roadmap.md`](roadmap.md)).

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
