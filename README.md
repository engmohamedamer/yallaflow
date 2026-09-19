# YallaFlow

> **Give AI your project, not just your prompt.**

**YallaFlow is an AI-agnostic engineering workflow for Adaptive Spec-Driven Development.**

It gives coding agents persistent project context, structured engineering workflows, explicit behavior contracts, verification gates, and resumable work. YallaFlow does not assume every request is a feature or that every change needs a full specification. It first understands the project and the work, then applies the appropriate depth of discovery, clarification, design, planning, implementation, and verification.

## Getting started

```bash
npm install /path/to/yallaflow-<version>.tgz   # or: npm link, from a checkout
yallaflow init
yallaflow intake SRS.md                         # or: yallaflow start "<a plain-text request>"
```

`yallaflow intake` accepts `.md`, `.txt`, `.json`, `.yaml`, `.yml`, and `.csv` files in this release — not PDF or DOCX. The CLI's own output tells you what to do next; open your coding agent and continue from there.

## Why

Coding agents are good at a task. Software projects live much longer than a task.

Important context is usually scattered across chats, tickets, code, deployment notes, and people's memory. A new AI session often repeats discovery, asks questions the repository could answer, applies a fix before proving the root cause, or declares work done without fresh evidence.

YallaFlow makes the project — not the chat session — the durable unit of engineering work.

## Adaptive Spec-Driven Development

YallaFlow applies Spec-Driven Development across the engineering lifecycle, adapting the work contract to the kind and scope of work rather than imposing one process on every request.

```text
Small bounded change:
Requirement → Discover → Clarify if necessary → Small work contract → Implement → Verify

Architectural feature:
Requirement → Discovery → Clarification → Design → Specification → Planning → Implementation → Verification → Review → Knowledge

Bug:
Symptom → Discovery → Reproduction → Evidence → Root cause → Fix → Verification

Investigation / spike:
Question → Discovery → Evidence → Conclusion
```

Design, specification, and planning stay distinct: design decides *how* the solution is shaped, specification defines *what* the system must do, and planning decides *how engineers will implement* the approved specification.

Investigations and spikes do not automatically authorize implementation. Workflow policy and durable gates decide when application-code modification is allowed.

Not every work item has to reach implementation. A work item may legitimately stop once its specification (`SPEC_READY`) or implementation plan (`PLAN_READY`) is reviewable, without pretending implementation happened — see [Delivery readiness](#delivery-readiness).

## Requirement intake

YallaFlow does not assume `Requirement = Feature`. A raw requirement may represent a feature, bug, investigation, change, refactor, or release. Before specification, the coding agent discovers relevant project context and supplies an explicit work type and scope through YallaFlow's validated routing contract.

```text
Raw Requirement
      ↓
Preserve Original Request
      ↓
Project Context Discovery
      ↓
Work Type
      ↓
Scope
      ↓
Discover Before Ask
      ↓
Business Clarification
      ↓
Adaptive Specification
      ↓
Behavior Contract
      ↓
Implementation / Verification
      ↓
Durable Project Knowledge
```

The CLI accepts two intake adapters today: plain text (`yallaflow start "<request>"`) and local files (`yallaflow intake <file>`). The architecture can support future adapters for trackers (Azure Boards, Jira, GitHub Issues), messages, meeting/phone notes, and email; those adapters are not implemented yet.

### File intake

```bash
yallaflow intake SRS.md
yallaflow intake SRS.md --title "Contract Management System"
```

`yallaflow intake <file>` reads a local requirements file, copies it byte-for-byte into the workspace, and creates a pending work item pointing at it — without needing to paste the requirement into a prompt. The source file is evidence: it is never silently replaced by generated interpretation, and it stays distinct from any later normalized requirement or specification.

Supported file types in this release: `.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.csv`. Anything else (PDF, DOCX, images, OCR) is explicitly rejected with the supported list; YallaFlow does not pretend to extract text from formats it cannot read deterministically.

Each intake gets a unique `SRC-####` ID, is stored under `.yallaflow/sources/<id>/` alongside a `source.json` record (content type, capture timestamp, a SHA-256 checksum, and the work IDs that reference it), and is linked to the work item it created via `meta.sources` (an array — a work item may end up referencing more than one source, even though intake only seeds the first entry today). Re-ingesting the same file never overwrites a prior source — it gets its own new ID, with a warning if the checksum matches an existing one. Inspect captured sources with:

```bash
yallaflow source list
yallaflow source show SRC-0001
yallaflow source show SRC-0001 --content
```

An optional `--title` on `intake` (or a plain, mechanical default derived from the filename, e.g. `SRS.md` → `SRS`) becomes the work item's title once routed — YallaFlow never infers a title semantically from the file's content. Routing itself works exactly as it does for text intake: `yallaflow intake` never classifies work type or scope from the file's contents; the agent still routes explicitly with `yallaflow route`.

### Discover before ask

> **Technical unknown → Discover. Business ambiguity → Ask.**

Agents should inspect the repository for the framework, database, directory structure, authentication implementation, service patterns, tests, CI/CD configuration, integrations, and project conventions. Questions should focus on business rules, expected behavior, policy decisions, ambiguous acceptance criteria, or information unavailable from the project.

## Project memory

Work should not disappear when implementation ends:

```text
Requirement → Work → Decisions → Implementation → Verification → Stable Project Knowledge
```

Only durable facts and decisions belong in long-lived project context; execution noise stays with the work item. The agent proposes candidates explicitly, and YallaFlow validates, reviews, promotes, and traces them. Automatic extraction is not implemented.

## Four rules

1. **Discover before asking.** Technical facts should be discovered from the repository whenever possible.
2. **Understand before changing.** Route work and establish expected behavior/root cause before editing code.
3. **Prove before claiming.** No DONE transition without fresh verification evidence.
4. **Remember after finishing.** Review completed work for durable knowledge that belongs in project context or ADRs.

## Architecture

```text
Project Memory ─┐
                ├─> Work Engine ─> Skill Engine ─> Execution Engine
Project Context ┘        │               │                │
                         │               │                ├─ Native
                         │               │                ├─ Reviewed
                         │               │                └─ Multi-agent
                         │               │
                         │               └─ Debug / Design / Plan / Test / Review / Verify
                         │
                         └─ Feature / Bug / Investigation / Change / Refactor / Release
```

See [`docs/architecture.md`](docs/architecture.md) for internal concepts, and its [core domain terminology](docs/architecture.md#core-domain-terminology) for the canonical definition of every term used below (Work Type, Scope, Workflow, Stage, Capability, Skill, Behavior Contract, Checkpoint, Readiness, Question, Ruling, ADR, Knowledge Candidate, Project Knowledge, Source).

## Workspace

`yallaflow init` creates project-owned durable state:

```text
.yallaflow/
├── config.yaml
├── PROJECT.md
├── AGENT.md
├── context/
│   ├── architecture.md
│   ├── tech-stack.md
│   ├── database.md
│   ├── integrations.md
│   ├── environments.md
│   ├── conventions.md
│   └── business-rules.md
├── work/
│   └── PF-0001/
│       ├── meta.yaml
│       ├── work.md
│       ├── progress.md
│       ├── progress.yaml        # created by the first explicit checkpoint
│       ├── questions.yaml       # created by the first `yallaflow question add`
│       ├── knowledge.yaml       # created by an explicit knowledge command
│       ├── attachments/
│       ├── evidence/
│       └── execution/
├── sources/                     # created by the first `yallaflow intake <file>`
│   └── SRC-0001/
│       ├── source.json
│       └── SRS.md                # the original file, copied byte-for-byte
├── decisions/
├── releases/
└── state/
    └── current.yaml
```

The package owns workflow behavior and schemas. The project owns its business/technical knowledge, work records, decisions, and state.

## Current CLI

```bash
npm install
npm link

yallaflow init
yallaflow start
yallaflow start "Production upload returns 500"
yallaflow intake SRS.md --title "Contract Management System"
yallaflow source list
yallaflow source show SRC-0001
yallaflow route PF-0001 --type bug --scope bounded --confidence high \
  --reason "Existing upload flow returns an unexpected 500 response." \
  --title "Upload 500 on production"
yallaflow guide PF-0001
yallaflow ready PF-0001                  # delivery readiness: SPEC_READY / PLAN_READY / DONE
yallaflow skill systematic-debugging
yallaflow checkpoint PF-0001 --skill context-discovery --start
yallaflow checkpoint PF-0001 --skill context-discovery --complete --summary "Located the upload flow." --evidence "src/upload.js"
yallaflow checkpoint revise PF-0001 --skill context-discovery --status blocked \
  --reason "Repository access became unavailable after the initial pass."
yallaflow checkpoint PF-0001 --ruling "Reuse the upload service" --ruling-reason "It is the established boundary." --cost-if-wrong "The integration may need refactoring."
yallaflow question add PF-0001 --category business --text "Can a contract receive multiple payments?"
yallaflow question answer PF-0001 --id Q-001 --answer "Yes, up to three partial payments."
yallaflow question resolve PF-0001 --id Q-001
yallaflow question list PF-0001
yallaflow knowledge propose PF-0001 --kind integration --source implementation-runtime \
  --summary "Browser previews require OSS CORS headers." --evidence "config/filesystems.php"
yallaflow knowledge list PF-0001
yallaflow knowledge promote PF-0001 --candidate K-001
yallaflow knowledge reject PF-0001 --candidate K-002 --reason "Temporary implementation detail."
yallaflow knowledge review PF-0001 --none
yallaflow feature "Add guest checkout" --scope bounded
yallaflow bug "Image preview fails in DEV"
yallaflow investigate "Why are Cloudflare requests slower?"
yallaflow change "Final approval now requires one approved well"
yallaflow refactor "Extract the payment-log boundary" --scope bounded
yallaflow release "Cut v1.4.0" --scope bounded
yallaflow status
yallaflow resume
yallaflow doctor
yallaflow advance                       # move through the validated workflow; explains what blocks it
yallaflow verify -- npm test             # record fresh verification evidence
```

Existing direct commands remain available for already-classified work. The v0.1 `--complexity` option is accepted as a compatibility input, but new work metadata uses the semantic `scope` field. `--source` is required on `knowledge propose` for any work routed under the current Skill Registry (`design-spec` or `implementation-runtime`; see [Project knowledge promotion](#project-knowledge-promotion)).

### Intent routing

`yallaflow start "<request>"` creates a durable, unclassified intake and preserves the raw request. It does not guess a work type or scope. The coding agent classifies the request using the routing contract, explains its reasoning, and applies the decision through `yallaflow route`.

The routing contract allows six work types (`feature`, `bug`, `investigation`, `change`, `refactor`, and `release`), three scopes (`spike`, `bounded`, and `architectural`), and three confidence levels (`low`, `medium`, and `high`). YallaFlow validates the decision, records its audit data, and resolves a workflow policy with declarative capability identifiers. It does not call an AI provider or execute the capabilities itself.

### Skills and behavior contracts

> **Skills define engineering behavior. Work items pin the behavior they were created with.**

- **Workflow** defines the lifecycle a work item follows.
- **Capability** names engineering behavior required by workflow policy.
- **Skill** is versioned, package-owned guidance defining how one capability is performed.
- **Behavior contract** is the ordered skill set pinned to a routed work item.

New routed work snapshots the Skill Registry version active at routing time (currently `2`) and its ordered skill IDs. The snapshot prevents a future package upgrade from silently changing that work item's behavior identity — work routed under an earlier registry version keeps its pinned contract unchanged. Instruction text stays in the package and can be inspected with `yallaflow skill <skill-id>`; it is not copied into project metadata.

Architectural work's Behavior Contract includes a dedicated, read-only `specification` skill between design and planning: design decides *how* the solution is shaped, specification defines *what* the system must do, and planning decides *how* engineers will implement the approved specification. See [Delivery readiness](#delivery-readiness) for how a specification's completeness is tracked.

`yallaflow guide [work-id]` combines the pinned behavior contract, current workflow stage, skill modes, and work policy. It reports the next engineering objective and whether application-code modification is currently authorized. Guidance does not replace workflow transitions or execute agent reasoning.

A workflow stage can only be exited once the checkpoint it requires is `completed` — stage and checkpoint state cannot silently drift apart. `yallaflow advance` reports exactly which checkpoint or unresolved decision is blocking a transition instead of failing silently.

Routed work created before behavior contracts were introduced remains readable. YallaFlow derives an unpinned contract in memory from its stored capabilities and does not mutate the work item.

### Agent checkpoints and resume

> **Conversation memory is temporary. Engineering progress must be durable.**

Behavior Contracts define which skills are required. Explicit checkpoints record what the agent has actually started, completed, or found blocked:

```text
Behavior Contract → Skill Progress → Evidence → Resume
```

`yallaflow checkpoint [work-id]` writes a work-scoped `.yallaflow/work/<id>/progress.yaml` ledger. Allowed statuses are `pending`, `in_progress`, `completed`, and `blocked`. Completion requires a durable summary; bug debugging completion also requires at least one evidence reference. Evidence is structurally preserved—YallaFlow does not claim that a reference proves its engineering assertion.

The ledger is created only by an explicit progress-changing command. Reading `guide`, `resume`, or `status` treats a missing ledger as all required skills pending and does not mutate the work item. Completed checkpoints are not suggested again, registry prerequisites are enforced, and repeated completion is idempotent.

Workflow stages remain authoritative. Before entering implementation, routed work must complete the pre-implementation skills in its Behavior Contract. Investigation remains read-only even after every checkpoint is complete. The existing `verify` command remains the source of verification evidence; the verification checkpoint does not create a second verification system.

Local rulings can be recorded through `checkpoint` with a decision, reason, and cost if wrong. A local ruling explains execution choices for one work item. An ADR belongs in project decisions and records a durable architectural choice. A decision candidate may explicitly use `--from-ruling` to seed its ADR fields; the ruling remains unchanged.

A checkpoint recorded in error, or invalidated by later findings, is corrected explicitly and auditably — never by hand-editing `progress.yaml`:

```bash
yallaflow checkpoint revise PF-0001 --skill specification --status blocked \
  --reason "Material business decisions remain unresolved."
```

`checkpoint revise` accepts only `pending`, `in_progress`, or `blocked` as the corrected status (completion always goes through the normal `--complete` path) and requires a non-empty `--reason`. Every correction appends a `{ skill, from, to, reason, changedAt }` entry to the ledger's history; prior state is never deleted. If the corrected skill gates a stage the work item already advanced past, YallaFlow reconciles the workflow stage backward, so stage and checkpoint state can never silently contradict each other.

### Structured questions / decision ledger

> **A material business or architecture decision is durable state, not a line of chat.**

Material business and architecture decisions are recorded structurally in `.yallaflow/work/<id>/questions.yaml`, not only as prose in `work.md`:

```bash
yallaflow question add PF-0001 --category business --text "Can a contract receive multiple payments?"
yallaflow question add PF-0001 --category architecture \
  --text "Which document-generation strategy should be used?" --proposal "Server-generated PDF"
yallaflow question answer PF-0001 --id Q-001 --answer "Yes, up to three partial payments."
yallaflow question resolve PF-0001 --id Q-001
```

Each question has a `category` (`business` or `architecture`), a `status` (`open`, `proposed`, `answered`, `resolved`), and a `material` flag (true by default). Business clarification asks what behavior the product needs; architecture questions/proposals ask how the system should technically satisfy it — neither is silently invented by YallaFlow. `guide` and `resume` surface open questions directly; reading the ledger never mutates it. An open **material** question blocks specification and plan readiness until it is resolved.

### Delivery readiness

> **Stage describes where work currently is. Readiness describes what deliverable is ready. They are not the same thing.**

Not every work item needs to reach implementation. `yallaflow ready [work-id]` reports whether a specification or implementation plan is ready for review/hand-off, independent of workflow stage and without ever auto-starting implementation:

```text
PF-0001 — Contract Management System
Delivery status: SPEC_READY

Specification readiness: READY

Plan readiness: BLOCKED
- implementation-planning checkpoint is pending

Application implementation: NOT STARTED
Open material decisions: 0
```

- **`SPEC_READY`** — the specification is complete enough for review; nothing has been planned or implemented.
- **`PLAN_READY`** — specification and implementation plan are both complete enough to hand off; implementation has not started.
- **`DONE`** — the full workflow's requested outcome is complete, including verification and knowledge review where applicable.

Reaching `PLAN_READY` never itself authorizes or starts implementation — application-code modification remains governed by workflow stage and the Behavior Contract, exactly as described above.

### Project knowledge promotion

> **Task history is temporary. Stable project knowledge is durable.**

```text
Work → Knowledge Candidate → Review → Promotion → Project Memory
```

The agent—not YallaFlow—decides which learning may matter to future work. `yallaflow knowledge propose` records a work-scoped candidate in `knowledge.yaml`. YallaFlow accepts only `architecture`, `database`, `integration`, `environment`, `convention`, `business-rule`, and `decision`; it validates structure without keyword classification or model APIs.

Non-decision candidates append traceable sections to the matching context document. Business rules use `context/business-rules.md`. Decision candidates require explicit context, decision, reason, and cost-if-wrong fields, then create an ADR under `decisions/`. Every promoted entry retains its source work ID, candidate ID, and promotion timestamp.

Work routed under the current Skill Registry also requires `--source design-spec|implementation-runtime`. `design-spec` knowledge (a confirmed business rule, a selected architecture) may be reviewed and promoted once the work reaches a stable `SPEC_READY`/`PLAN_READY` endpoint, without implementation or verification evidence. `implementation-runtime` knowledge still requires the work item to be at its normal completion stage with fresh successful verification evidence.

```bash
yallaflow knowledge propose PF-0001 \
  --kind decision \
  --source implementation-runtime \
  --summary "Reuse the existing UploadService boundary" \
  --context "Uploads already enter through UploadService." \
  --decision "Keep UploadService as the integration boundary." \
  --reason "It is the established project boundary." \
  --cost-if-wrong "A later integration refactor may be required." \
  --evidence "src/services/upload.js"

# Or seed decision/reason/cost from a numbered local ruling:
yallaflow knowledge propose PF-0001 --kind decision --source implementation-runtime \
  --summary "Reuse UploadService" \
  --context "Uploads already enter through UploadService." --from-ruling 1 \
  --evidence "src/services/upload.js"
```

```text
Work Progress ≠ Project Knowledge
Ruling ≠ ADR
```

Files inspected, failed commands, temporary hypotheses, and conversational reasoning remain work history. Stable boundaries, constraints, rules, conventions, and deliberate decisions may become project knowledge. Reads never create `knowledge.yaml`, and promotion never edits application source.

Review is explicit. Resolving all candidates marks it reviewed; `knowledge review --none` records that review happened and found no durable learning. New work pins knowledge policy version `1` and must complete review before DONE. Work created by v0.1–v0.2.3 has no marker and is not retroactively blocked.

### Brownfield bootstrap

When an existing repository is detected, `yallaflow init` performs a deterministic first pass over common framework/CI markers and records initial stack hints. The AI then deepens discovery instead of asking the user for facts the repository already contains.

### Existing v0.1 workspaces

YallaFlow does not automatically migrate a legacy `.projectflow/` workspace. If one is present, `yallaflow init` stops with a migration message instead of creating a parallel `.yallaflow/` workspace. The `PF-####` work ID format introduced in v0.1 remains unchanged in v0.2; a brand-neutral ID format requires a separate migration decision.

Work-item compatibility is read-only by default: v0.1 work without routing or a Behavior Contract still loads; v0.2.1 capabilities derive an unpinned contract; v0.2.2 pinned contracts without `progress.yaml` appear with all skills pending; v0.2.3 work has no required knowledge policy; and work pinned to registry v1 (before the `specification` skill existed) keeps that contract and is not retroactively given a specification checkpoint. No ledger — `progress.yaml`, `questions.yaml`, or `knowledge.yaml` — is created merely by reading old work.

### Work lifecycle

A work item is more than a task title. It stores intake, facts, questions, evidence, a scope-appropriate specification or expected behavior, a plan where required, verification evidence, rulings, knowledge updates, and the result.

A bug follows a root-cause-first lifecycle. An investigation is read-only and has no implementation stage. Architectural work gets a heavier design/spec path than a bounded change. The state engine refuses a DONE transition for implementation work until fresh successful verification evidence has been recorded; newly policy-pinned work also requires explicit project-knowledge review.

## What YallaFlow is not

- It is not a replacement for Jira, Azure Boards, or GitHub Issues. Those remain project-management sources of truth.
- It is not tied to Claude, Codex, or any single model provider.
- It is not a bag of prompts. Workflow behavior is validated and scenario-tested.
- It is not a task manager or code-generation wrapper. It preserves the engineering contract around work performed by coding agents.
- It is not a fixed SDD template. Specification depth adapts to work type and scope.
- It does not require every change to use the same ceremony. Scope classification keeps small work small.

## Design influences

YallaFlow is an independent implementation informed by ideas seen in projects such as Squad-Kit and Superpowers. See [`docs/inspiration.md`](docs/inspiration.md) for the design lessons and YallaFlow's distinct focus.

## Status

**`0.3.0-internal.1` — File Intake Foundation.** Core froze at `0.2.0-internal.1`; this adds the first v0.3 capability, `yallaflow intake <file>`. The npm package remains private and no version has been published to the npm registry; see [`docs/releasing.md`](docs/releasing.md) for the release/versioning policy that will apply once publishing begins, and [`CHANGELOG.md`](CHANGELOG.md) for what has shipped so far. Piloting YallaFlow yourself? See [`docs/internal-pilot.md`](docs/internal-pilot.md).

See [`docs/roadmap.md`](docs/roadmap.md).

## License

MIT.
