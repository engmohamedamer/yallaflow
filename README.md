# YallaFlow

> **Give AI your project, not just your prompt.**

**YallaFlow is an AI-agnostic engineering workflow for Adaptive Spec-Driven Development.**

It gives coding agents persistent project context, structured engineering workflows, explicit behavior contracts, verification gates, and resumable work. YallaFlow does not assume every request is a feature or that every change needs a full specification. It first understands the project and the work, then applies the appropriate depth of discovery, clarification, design, planning, implementation, and verification.

## Getting started

Requires **Node.js ≥20.16.0**.

```bash
npm install /path/to/yallaflow-<version>.tgz   # or: npm link, from a checkout
yallaflow init
yallaflow intake SRS.docx                       # or: yallaflow start "<a plain-text request>"
```

`yallaflow intake` accepts one universal command for virtually any requirements document — plain text, Office/OpenDocument files, PDF, and images — never a format-specific command. See [File intake](#file-intake) for the full support matrix. The CLI's own output tells you what to do next; open your coding agent and continue from there.

`pdfjs-dist` is pinned to `5.4.624`, the newest release that officially declares Node ≥20.16.0 support (`>=20.16.0 || >=22.3.0`) while predating every known pdfjs-dist security advisory in this dependency tree — this is exactly why YallaFlow's own minimum is `≥20.16.0` rather than a round `≥20`. `npm install` produces no `EBADENGINE` warning for it or any other runtime dependency on a satisfying Node version; `test/node-compatibility.test.js` verifies this by scanning the whole installed tree against YallaFlow's own declared floor, not just this one package.

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
yallaflow intake SRS.docx
yallaflow intake SRS.docx --title "Contract Management System"
yallaflow intake requirements.docx payment-rules.xlsx wireframes.pdf   # multiple sources at once
yallaflow intake add PF-0001 client-notes.docx                         # attach to existing work later
```

`yallaflow intake <file>` reads a local requirements document, copies it byte-for-byte into the workspace, and creates a pending work item pointing at it — without needing to paste the requirement into a prompt. The source file is evidence: it is never silently replaced by generated interpretation. Original bytes, any extracted text, the normalized intake record, and any later specification are four distinct artifacts that stay distinct.

One command handles every supported format — never a format-specific command like `yallaflow docx ...`. Format is detected from content (magic bytes), not trusted from the extension alone: a file wrongly named `.docx` is detected as a mismatch and preserved as a generic binary source instead of being parsed as if it were valid.

| Family | Formats | Text extraction |
| --- | --- | --- |
| Plain / structured text | `.txt .md .markdown .rst .csv .tsv .json .jsonl .yaml .yml .xml .html .htm .toml .ini .cfg .conf .properties .log .sql` and common source files (`.js .ts .py .java .go .rs .rb .sh` etc., read as plain text — language semantics are never interpreted) | Native (the file already is text) |
| Office / rich documents | `.docx .pptx .xlsx .rtf .odt .ods .odp` | Yes — `.xlsx`/`.pptx` get real sheet names and per-slide sections; others get paragraph/table text |
| PDF | `.pdf` | Yes, per page, for text-based PDFs — word order follows the PDF content stream, which is not guaranteed to match visual reading order (most notable for RTL scripts) |
| Images | `.png .jpg .jpeg .webp .gif .bmp .tif .tiff .svg` | Original source only — **no OCR or vision understanding is performed or claimed** |
| Other binary | anything else, plus `.odg`/`.epub` (recognized, extraction not yet implemented), plus archives `.zip .tar .gz .7z .rar` (never auto-unpacked) | Original source only |

If extraction fails for a format that normally supports it (a corrupt `.docx`, a malformed `.pdf`) or the file is larger than the extraction size limit, intake does not fail — it preserves the original file, prints a warning, and records why no text is available, rather than pretending extraction succeeded or silently truncating it.

Each intake gets a unique `SRC-####` ID, is stored under `.yallaflow/sources/<id>/` (the original file under its own name, plus `extracted.txt` when text was extracted) alongside a `source.json` record (detected format, content availability, a SHA-256 checksum, and the work IDs that reference it), and is linked to the work item it created via `meta.sources` — always an array, so a work item is never limited to one source. Re-ingesting the same file never overwrites a prior source — it gets its own new ID, with a warning if the checksum matches an existing one. Inspect captured sources with:

```bash
yallaflow source list
yallaflow source show SRC-0001
yallaflow source show SRC-0001 --content   # native/extracted text, or an explicit "no text representation" note
```

An optional `--title` on `intake` (or a plain, mechanical default derived from the filename, e.g. `SRS.docx` → `SRS`) becomes the work item's title once routed — YallaFlow never infers a title semantically from a file's content. Routing itself works exactly as it does for text intake: `yallaflow intake` never classifies work type or scope from a file's contents; the agent still routes explicitly with `yallaflow route`.

Untrusted input is treated as untrusted: no macros, embedded scripts, or OLE objects are ever executed; no external links or content are fetched; archives are never auto-unpacked; and every stored file name is validated to stay inside its own source directory.

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
│       ├── SRS.docx               # the original file, copied byte-for-byte
│       └── extracted.txt          # present only when text was extracted
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

yallaflow init                            # --mode autonomous|adaptive|gated (default: adaptive)
yallaflow start
yallaflow start "Production upload returns 500"
yallaflow request revise PF-0002 --text "Add refund summary to revenue dashboard" \
  --reason "Accidental --help intake."
yallaflow intake SRS.docx --title "Contract Management System"
yallaflow intake add PF-0001 payment-rules.xlsx
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
yallaflow resume [PF-0001]               # no ID: active work; an ID: read-only inspection, never changes focus
yallaflow doctor
yallaflow advance                       # move through the validated workflow; explains what blocks it
yallaflow verify -- npm test              # argv mode (default): shell:false, exact args preserved
yallaflow verify --shell 'npm test | tail -20'  # explicit shell mode for real shell syntax
yallaflow verify --script evidence/smoke.sh     # a script file, executed directly
yallaflow verify list PF-0001            # list every recorded verification run
# `verify` with no `--`/`--shell`/`--script` (an old, undocumented shell fallback) is no longer accepted — always name the mode explicitly.
yallaflow baseline start                 # brownfield: read-only repository baseline discovery
yallaflow baseline draft PF-0005 --file baseline.json
yallaflow baseline approve PF-0005       # promotes confirmed/inferred/unresolved facts into durable docs
yallaflow reopen PF-0001 --to implementation --reason "Production defect discovered after completion."
yallaflow decompose propose PF-0001 --file decomposition.json
yallaflow decompose validate PF-0001
yallaflow decompose execute PF-0001
yallaflow decompose status PF-0001
yallaflow progress PF-0001
yallaflow next PF-0001
yallaflow approve PF-0001 --stage plan --note "Reviewed."
yallaflow feedback PF-0001 --stage plan --changes-requested --note "Needs another pass."
yallaflow handoff PF-0004
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

`checkpoint revise` accepts only `pending`, `in_progress`, or `blocked` as the corrected status (completion always goes through the normal `--complete` path) and requires a non-empty `--reason`. Every correction appends a `{ skill, from, to, reason, changedAt }` entry to the ledger's history; prior state is never deleted. If the corrected skill gates a stage the work item already advanced past, YallaFlow reconciles the workflow stage backward, so stage and checkpoint state can never silently contradict each other. Revising `implementation`, `verification`, or `code-review` also resets whichever of `verification`/`code-review` were already `completed` back to `pending` (they depended on the thing that just changed) and marks a freshness boundary that a later `yallaflow verify` must postdate before completion can be claimed again. `checkpoint revise` on a `DONE` work item is refused — see below.

Leaving `IMPLEMENTATION`/`EXECUTION` requires the `implementation` checkpoint to be `completed`; leaving `VERIFICATION` requires the `verification` checkpoint to be `completed`; reaching `DONE` requires `code-review` to be `completed` when the Behavior Contract includes it, in addition to the existing fresh-verification-evidence and knowledge-review gates. These gates apply for every workflow, not only architectural feature work.

### Reopening completed work

> **DONE is a durable fact, not a dead end. Reopening it is explicit and auditable, never a hand-edited file.**

A production issue found after DONE, or a review request on already-shipped work, is handled with `yallaflow reopen`, never by editing `state/current.yaml`, `meta.yaml`, or `progress.yaml` by hand:

```bash
yallaflow reopen PF-0001 --to implementation --reason "Production defect discovered after completion."
yallaflow reopen PF-0001 --to verification --reason "A regression surfaced in a downstream environment."
yallaflow reopen PF-0001 --to review --reason "A second reviewer is required."
```

`--to` accepts `implementation`, `verification`, or `review`; `--reason` is required. Reopening requires the work to currently be `DONE`, reactivates it as the active work item at the corresponding stage, resets the checkpoints downstream of the target back to `pending` (`implementation` itself becomes `in_progress`), and resets a completed knowledge review back to `pending` only when reopening to `implementation`. Nothing durable is ever deleted: prior checkpoint history, verification evidence, and knowledge candidates all remain, and every reopen is appended to `meta.lifecycleHistory`. A fresh `yallaflow verify` is required again — evidence recorded before the reopen cannot satisfy a later completion gate — and the work item can reach `DONE` again cleanly, recording a second entry in `meta.completionHistory` alongside the first.

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

### Work decomposition

> **YallaFlow is for developers and teams, not a step-by-step wizard. Decomposition makes large project work reviewable, resumable, independently verifiable, and easy to hand off — it does not turn engineering into a checklist.**

A single architectural work item that covers an entire project (the Nice Day Contract Hub pilot's real failure mode) produces one implementation session that is too large: hard to review, hard to verify completely, hard to hand off between agent sessions. Once — and only once — a work item reaches `PLAN_READY`, it may become a **parent**, decomposed into normal, independently-lifecycled child work items:

```bash
yallaflow decompose propose PF-0001 --file decomposition.json
yallaflow decompose validate PF-0001
yallaflow decompose execute PF-0001    # the explicit boundary: planning ends, execution begins
yallaflow decompose status PF-0001
yallaflow progress PF-0001             # required/optional child counts, ✓/→/○/⊘ view
yallaflow next PF-0001                 # every dependency-unblocked child; never picks one for you
```

`decomposition.json` is Agent-supplied structured input, exactly like an intake file — YallaFlow never performs semantic requirement splitting or invents feature boundaries itself:

```json
{
  "children": [
    { "key": "foundation", "title": "Foundation & Authentication", "type": "feature", "scope": "bounded",
      "required": true, "requirements": ["FR-01"], "acceptanceCriteria": ["AC-01"] },
    { "key": "signing", "title": "Customer Signing", "type": "feature", "scope": "bounded",
      "required": true, "requirements": ["FR-02"], "acceptanceCriteria": ["AC-02"], "dependsOn": ["foundation"] }
  ],
  "requirementsUniverse": ["FR-01", "FR-02", "FR-03"],
  "acceptanceCriteriaUniverse": ["AC-01", "AC-02"]
}
```

`propose`/`validate` reject self-dependencies, unknown dependency keys, and dependency cycles, and report traceability coverage: which requirements/acceptance criteria are referenced, which are referenced by more than one child (reported as cross-cutting, never treated as automatically invalid — some requirements legitimately span several features), and which are unassigned (only when a `requirementsUniverse`/`acceptanceCriteriaUniverse` was declared). `execute` is the one explicit, one-time boundary between planning the project and executing its child work: it creates one fully-routed YallaFlow work item per child — its own type, scope, pinned Behavior Contract, checkpoints, verification, review, and knowledge review, reusing the existing work lifecycle rather than a second, lighter task engine — then advances the parent into its write stage. Requirement/acceptance-criteria references are carried onto the created child's `meta.yaml` for traceability.

The parent's `decomposition.yaml` is the single canonical store of the child graph (keys, requirements, `dependsOn`, `required`); each child's own `meta.yaml`/`progress.yaml`/evidence remain the single source of truth for that child's own lifecycle — nothing is duplicated into the parent, and a child only carries a `parent`/`decompositionKey` back-reference. A decomposed parent's `IMPLEMENTATION`-stage exit gate becomes "every required child is `DONE`" instead of its own `implementation` checkpoint (which is never meant to complete — the children are the implementation); its `VERIFICATION`, `code-review`, and knowledge stages are unchanged, for a final project-level pass once every required child is done.

### Interaction modes & review gates

> **The goal is not to force one interaction style globally. Some developers want the Agent to run to completion; others want deliberate stops. Hard correctness gates apply in every mode.**

A durable, per-project interaction policy lives in `config.yaml` (`yallaflow init --mode autonomous|adaptive|gated`; **`adaptive` is the default**, matching a developer/technical audience):

- **`autonomous`** — the Agent continues through every optional review boundary automatically. Unresolved business questions, workflow blockers, dependency blockers, required verification, and required knowledge review still apply — autonomous mode never bypasses a correctness gate.
- **`adaptive`** (default) — routine technical decisions (discovery, clarification, design, implementation, verification) proceed automatically; the Agent stops at meaningful human boundaries: `specification`, `plan`, and `decomposition` are reviewed by default.
- **`gated`** — every configured boundary stops for explicit review; a project can enable any subset of the 8 named boundaries (`discovery, clarification, design, specification, plan, decomposition, implementation, verification`) without adopting the whole preset.

Review is durable state, not chat text, in `.yallaflow/work/<id>/reviews.yaml`:

```bash
yallaflow approve PF-0001 --stage plan --note "Reviewed the implementation plan."
yallaflow feedback PF-0001 --stage plan --changes-requested --note "Scope is too broad for one child."
```

A blocked transition auto-requests review the first time it is hit and reports an actionable error:

```text
Cannot advance from SPECIFICATION to PLAN.

Blocking requirements:
- specification review is awaiting_review in the current interaction mode — awaiting approval before
  execution. Run `yallaflow approve PF-0001 --stage specification` or
  `yallaflow feedback PF-0001 --stage specification --changes-requested`.
```

Approval does not survive a material revision to the thing it approved: revising a checkpoint (or reopening past it) invalidates that gate and every downstream gate in the same dependency chain back to `awaiting_review`, while the prior approval is preserved in the gate's history, never deleted. This is workflow evidence, not an authentication claim — a CLI approval records that the workflow reached this state, nothing stronger.

### Agent handoff

> **Conversation history is not authoritative project state. A new agent should recover from durable YallaFlow state, the Git working tree, and verification evidence — not the previous session's chat transcript.**

The Nice Day pilot proved cross-agent recovery works in practice (one agent's usage ended mid-implementation; a different agent continued from repository state alone). `yallaflow handoff [work-id]` makes that a first-class, read-only command:

```bash
yallaflow handoff PF-0004
```

It reports title/parent, type/scope/stage/readiness, completed/pending/blocked skills, the current/incomplete skill, open questions, review gates awaiting approval, the latest verification result, knowledge-review status, a read-only Git summary (branch, clean/dirty, changed/untracked counts), write authorization, and the next objective — for a decomposed parent, also child DONE/active/blocked/ready counts, next executable candidates, and unresolved traceability gaps. It never mutates workspace state or Git, and works identically for the active work item or an explicit, non-active ID.

Both `handoff` and `resume` lead with a **`PRIMARY UNRESOLVED OBJECTIVE`** whenever one exists — the most recent of a reopen reason, a checkpoint-revision reason, or the active write-authorization blocker — so a replacement agent never has to infer why work was reopened purely from lifecycle history:

```text
PRIMARY UNRESOLVED OBJECTIVE:
Cancellation lifecycle is unreachable and signed-version preservation must be verified.
```

A `DONE` work item is one work item, not necessarily the whole project: `handoff`/`progress` say "PF-0006 DONE" or "Project NOT complete: 5/7 required children DONE," never "project complete," unless the parent/project work item itself is `DONE`. `handoff` also notes (never enforces) a dirty Git tree at a `DONE` boundary — YallaFlow never commits automatically.

`resume`, `guide`, and `handoff` answer different questions and share the same underlying resolvers rather than three competing lifecycle interpretations: `resume` — what should I continue doing; `guide` — what workflow/skill behavior applies; `handoff` — compact, complete context for another agent or session.

### Brownfield baseline

> **Discover once, reuse durable project understanding. Deterministic bootstrap seeds a baseline; it is not a substitute for one.**

An agent can already reconstruct a rich understanding of an undocumented repository during a session — the gap was that nothing durable captured it. `yallaflow baseline` closes that gap with a reviewed, evidence-backed project baseline, promoted into `PROJECT.md`/`context/*.md` only on approval:

```bash
yallaflow baseline start                             # read-only investigation work item
yallaflow checkpoint PF-0005 --skill repository-baseline --complete --summary "Repository discovered."
yallaflow baseline draft PF-0005 --file baseline.json
yallaflow baseline status PF-0005
yallaflow baseline show PF-0005
yallaflow baseline approve PF-0005 --note "Looks complete."
yallaflow baseline feedback PF-0005 --changes-requested --note "Add database evidence."
```

`baseline.json` is Agent-supplied structured input — never guessed:

```json
{
  "facts": [
    { "area": "tech-stack", "status": "confirmed", "summary": "PostgreSQL is the application database.",
      "evidence": ["compose.yaml", "config/database.php"], "source": "repository" },
    { "area": "environment", "status": "unresolved", "summary": "Production hosting provider cannot be established.",
      "evidence": [".env.example", "compose.yaml"], "source": "repository" }
  ]
}
```

Every fact carries a **confidence level** (`confirmed` — directly supported by repository/runtime evidence; `inferred` — a strong interpretation, not explicitly declared; `unresolved` — cannot safely be established) and a **provenance** (`repository`, `runtime`, or `user-confirmed`). Prior conversation/model memory is never accepted as evidence. Review reuses the same `reviews.yaml` gate ledger as `specification`/`plan`/`decomposition` (a new `baseline` gate) — approval is the only thing that promotes facts, through the exact same idempotent append mechanism ordinary `knowledge propose`/`promote` already uses for `context/*.md` (two new knowledge kinds, `project` → `PROJECT.md` and `tech-stack` → `context/tech-stack.md`), so a document is never written by two competing mechanisms. Deterministic bootstrap content is preserved, never overwritten.

A subsequent agent session reads `PROJECT.md` and only the relevant `context/*.md` docs first, instead of rescanning the whole repository — but repository evidence remains authoritative if durable context looks stale.

### Project knowledge promotion

> **Task history is temporary. Stable project knowledge is durable.**

```text
Work → Knowledge Candidate → Review → Promotion → Project Memory
```

The agent—not YallaFlow—decides which learning may matter to future work. `yallaflow knowledge propose` records a work-scoped candidate in `knowledge.yaml`. YallaFlow accepts only `architecture`, `database`, `integration`, `environment`, `convention`, `business-rule`, `decision`, `project`, and `tech-stack` (the last two added in v0.3.5 for the same durable targets Brownfield Baseline promotes into, `PROJECT.md` and `context/tech-stack.md`); it validates structure without keyword classification or model APIs.

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

When an existing repository is detected, `yallaflow init` performs a deterministic first pass over common framework/CI markers and records initial stack hints. This is deliberately cheap and mechanical — it seeds, but does not replace, a full [Brownfield baseline](#brownfield-baseline); the AI then deepens discovery instead of asking the user for facts the repository already contains.

### Existing v0.1 workspaces

YallaFlow does not automatically migrate a legacy `.projectflow/` workspace. If one is present, `yallaflow init` stops with a migration message instead of creating a parallel `.yallaflow/` workspace. `yallaflow init` also refuses to silently reinitialize over a `.yallaflow` that is Git-tracked (in the index or `HEAD`) but currently missing from the working tree — an actionable error names the restore path instead. The `PF-####` work ID format introduced in v0.1 remains unchanged in v0.2; a brand-neutral ID format requires a separate migration decision.

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

**`0.3.0-internal.2` — Universal File Intake.** Core froze at `0.2.0-internal.1`; `0.3.0-internal.1` added file intake for plain-text formats; this closes out the intake architecture with Office/OpenDocument, PDF, and image support behind the same `yallaflow intake <file>` command. The npm package remains private and no version has been published to the npm registry; see [`docs/releasing.md`](docs/releasing.md) for the release/versioning policy that will apply once publishing begins, and [`CHANGELOG.md`](CHANGELOG.md) for what has shipped so far. Piloting YallaFlow yourself? See [`docs/internal-pilot.md`](docs/internal-pilot.md).

See [`docs/roadmap.md`](docs/roadmap.md).

## License

MIT.
