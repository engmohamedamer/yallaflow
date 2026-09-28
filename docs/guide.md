# YallaFlow Feature Guide

This guide explains each YallaFlow capability in depth. For end-to-end sequences see [`workflows.md`](workflows.md); for every command and flag see [`cli.md`](cli.md); for project memory see [`project-memory.md`](project-memory.md). Canonical term definitions live in [`architecture.md`](architecture.md#core-domain-terminology).

- [Requirement intake](#requirement-intake)
- [Routing and direct commands](#routing-and-direct-commands)
- [Skills and Behavior Contracts](#skills-and-behavior-contracts)
- [Checkpoints, rulings, and resume](#checkpoints-rulings-and-resume)
- [Verification](#verification)
- [Reopening completed work](#reopening-completed-work)
- [Structured questions](#structured-questions)
- [Delivery readiness](#delivery-readiness)
- [Requirement identity and delivery convergence](#requirement-identity-and-delivery-convergence)
- [Change impact](#change-impact)
- [Interaction modes and review gates](#interaction-modes-and-review-gates)
- [Work decomposition](#work-decomposition)
- [Agent handoff](#agent-handoff)
- [Agent bootstrap (Codex, Claude)](#agent-bootstrap-codex-claude)
- [Brownfield bootstrap and baseline](#brownfield-bootstrap-and-baseline)
- [Project knowledge promotion](#project-knowledge-promotion)
- [Work lifecycle](#work-lifecycle)
- [Compatibility with older workspaces](#compatibility-with-older-workspaces)

## Requirement intake

YallaFlow does not assume `Requirement = Feature`. A raw requirement may be a feature, bug, investigation, change, refactor, or release. The original request is preserved first; the coding agent then discovers project context and classifies the work explicitly.

```text
Raw requirement → preserve original → discover context → classify (type + scope)
→ discover before ask → clarify business ambiguity → adaptive specification
→ Behavior Contract → implementation / verification → project memory
```

Two intake adapters exist: plain text (`yallaflow start "<request>"`) and local files (`yallaflow intake <file>`). Tracker, message, and email adapters are not implemented.

### File intake

```bash
yallaflow intake SRS.docx
yallaflow intake SRS.docx --title "Contract Management System"
yallaflow intake requirements.docx payment-rules.xlsx wireframes.pdf   # several sources, one work item
yallaflow intake add PF-0001 client-notes.docx                         # attach to existing work
```

`yallaflow intake` copies each file byte-for-byte into `.yallaflow/sources/SRC-####/` and creates a pending work item that references it. The original is never replaced by generated interpretation: original bytes, extracted text, the normalized intake record, and any later specification remain distinct artifacts. One command handles every format. Format is detected from content (magic bytes), so a file wrongly named `.docx` is preserved as a generic binary rather than parsed.

| Family | Formats | Text extraction |
| --- | --- | --- |
| Plain / structured text | `.txt .md .markdown .rst .csv .tsv .json .jsonl .yaml .yml .xml .html .htm .toml .ini .cfg .conf .properties .log .sql` and common source files (read as plain text) | Native |
| Office / rich documents | `.docx .pptx .xlsx .rtf .odt .ods .odp` | Yes — `.xlsx`/`.pptx` keep sheet names and per-slide sections |
| PDF | `.pdf` | Yes, per page, for text-based PDFs; word order follows the content stream, which may differ from visual order (notably RTL) |
| Images | `.png .jpg .jpeg .webp .gif .bmp .tif .tiff .svg` | Original only — no OCR or vision |
| Other binary | anything else, `.odg`/`.epub`, archives (never unpacked) | Original only |

If extraction fails or a file exceeds the extraction size limit, intake preserves the original, warns, and records why no text is available. Each source records a SHA-256 checksum and the work items linked to it; re-ingesting identical content creates a new `SRC-####` (with a checksum-match notice) and never overwrites. `--title` (or a mechanical filename-derived default) becomes the title once routed; YallaFlow never infers type, scope, or title from content.

```bash
yallaflow source list
yallaflow source show SRC-0001
yallaflow source show SRC-0001 --content   # native/extracted text, or an explicit "no text" note
```

Every source link records when it was made and the work's status then. Attaching a source to **DONE** work requires `--reason` and records a *recovered source* — see [project-memory.md](project-memory.md#sources-evidence-generated-artifacts-and-discovery-limitations).

### Discover before ask

> **Technical unknown → Discover. Business ambiguity → Ask.**

Agents inspect the repository for framework, database, structure, authentication, service patterns, tests, CI/CD, integrations, and conventions. Questions are reserved for business rules, expected behavior, policy decisions, ambiguous acceptance criteria, or information the project cannot provide.

## Routing and direct commands

`yallaflow start "<request>"` creates a durable, unclassified intake. It never guesses a type or scope. The agent classifies the request and applies the decision:

```bash
yallaflow route PF-0001 --type bug --scope bounded --confidence high \
  --reason "Existing upload flow returns an unexpected 500 response." --title "Upload 500 on production"
```

The routing contract allows six types (`feature`, `bug`, `investigation`, `change`, `refactor`, `release`), three scopes (`spike`, `bounded`, `architectural`), and three confidence levels (`low`, `medium`, `high`). YallaFlow validates the decision, records it, and resolves the workflow policy. It never calls an AI provider. Scope is about risk, not size: financial correctness, security/privacy, authorization, data-model changes, integration contracts, and irreversible behavior can justify architectural depth for a small-looking change.

**Direct commands** are shortcuts for work you have already classified. They require `--scope` and create routed work through exactly the same path as `start` → `route`:

```bash
yallaflow feature "Add guest checkout" --scope bounded
yallaflow investigate "Why is deployment slow?" --scope bounded
yallaflow bug "Diagnose intermittent queue latency" --scope spike   # a bug spike is read-only
```

Without `--scope` they create nothing and suggest `--scope` or `yallaflow start`. Unsupported pairs (for example `feature --scope spike`) are rejected before anything is written. `--complexity` is accepted as a legacy alias for `--scope`.

## Skills and Behavior Contracts

> **Skills define engineering behavior. Work items pin the behavior they were created with.**

- **Workflow** — the lifecycle (ordered stages) a work item follows.
- **Capability** — engineering behavior required by the workflow policy.
- **Skill** — versioned, package-owned guidance for one capability (`yallaflow skill <skill-id>`).
- **Behavior Contract** — the ordered skill set pinned to a routed work item, with the Skill Registry version (currently **3**).

The pinned contract means a later package upgrade never silently changes an existing work item's behavior. Architectural work separates three skills: design decides *how* the solution is shaped, specification defines *what* the system must do, and planning decides *how engineers will implement* the approved specification.

`yallaflow guide [work-id]` combines the contract, current stage, skill modes, and work policy. It reports whether application-code modification is authorized, and ends with **CURRENT OBJECTIVE**, **BLOCKER**, and **NEXT VALID ACTION** — the exact command that moves the work forward, from the same resolver `advance` enforces. `yallaflow advance` reports the next boundary after each transition.

## Checkpoints, rulings, and resume

> **Conversation memory is temporary. Engineering progress must be durable.**

```bash
yallaflow checkpoint PF-0001 --skill context-discovery --start
yallaflow checkpoint PF-0001 --skill context-discovery --complete --summary "Located the upload flow." --evidence src/upload.js
yallaflow checkpoint PF-0001 --ruling "Reuse the upload service" --ruling-reason "Established boundary." --cost-if-wrong "Refactor later."
```

Checkpoints (`pending`, `in_progress`, `completed`, `blocked`) live in `work/<id>/progress.yaml`, created by the first checkpoint. Completion needs a summary; completing `systematic-debugging` for a bug needs at least one evidence reference; completing `verification` needs fresh successful verification evidence. Registry prerequisites are enforced and repeated completion is idempotent. A stage cannot be exited until the checkpoint it requires is completed, so stage and checkpoint state never contradict each other.

Corrections are explicit and audited, never hand edits:

```bash
yallaflow checkpoint revise PF-0001 --skill specification --status blocked --reason "Material business decisions remain unresolved."
```

`revise` accepts `pending`, `in_progress`, or `blocked`, requires `--reason`, appends history, walks the stage back if needed, resets dependent `verification`/`delivery-convergence`/`code-review` checkpoints, and marks a freshness boundary that later verification must postdate. It is refused on DONE work (use `reopen`).

A **ruling** is a task-local decision in the progress ledger; an **ADR** is a long-lived decision under `decisions/`. A decision candidate can be seeded from a ruling with `--from-ruling`; the ruling is not changed.

`yallaflow resume [work-id]` answers "what should I continue doing": type, scope, stage, readiness, skill progress, verification, knowledge review, open questions, Git status, relevant project context, linked sources, and the next objective. With an ID it is read-only inspection and never changes the active work.

## Verification

```bash
yallaflow verify PF-0001 -- npm test                    # argv mode (default, preferred)
yallaflow verify PF-0001 -- php artisan test --filter=Upload
yallaflow verify PF-0001 --shell 'npm test | tail -20'  # only when shell operators are needed
yallaflow verify PF-0001 --script scripts/smoke.sh      # a script file, executed directly
yallaflow verify list PF-0001
```

Every run is appended to `work/<id>/evidence/verification.json` with its log (`V-###`); failed runs are never hidden. Argv mode runs without a shell, so arguments are passed exactly. A mode must always be named. Rules:

- DONE requires the latest verification to have succeeded after any reopen/revision, and — for every workflow whose contract includes it — a completed `verification` checkpoint. This includes read-only investigations.
- A failing run recorded after the `verification` checkpoint was completed returns that checkpoint to `in_progress` (audited).
- `verify` on DONE work is refused: reopen first, or start a new work item for investigation workflows (which cannot be reopened).
- A run can back durable knowledge as `--evidence verification:V-###`.

## Reopening completed work

```bash
yallaflow reopen PF-0001 --to implementation --reason "Production defect discovered after completion."
yallaflow reopen PF-0001 --to verification --reason "A regression surfaced downstream."
yallaflow reopen PF-0001 --to review --reason "A second reviewer is required."
```

Reopen requires DONE work, reactivates it at the matching stage, resets downstream checkpoints (including `delivery-convergence` when reopening to implementation or verification, whose findings then become stale; and knowledge review when reopening to implementation), and appends to `meta.lifecycleHistory`. Evidence, checkpoint history, and knowledge candidates are never deleted. After a reopen to implementation or verification, fresh verification is required again (a reopen to review keeps the existing verification and convergence current); reaching DONE again adds a second `completionHistory` entry. Workflows without an implementation or verification stage (investigations) cannot be reopened.

## Structured questions

> **A material business or architecture decision is durable state, not a line of chat.**

```bash
yallaflow question add PF-0001 --category business --text "Can a contract receive multiple payments?"
yallaflow question add PF-0001 --category architecture --text "Which document-generation strategy?" --proposal "Server-generated PDF"
yallaflow question answer PF-0001 --id Q-001 --answer "Yes, up to three partial payments."
yallaflow question resolve PF-0001 --id Q-001
yallaflow question list PF-0001
```

Questions (`business` or `architecture`; `open`, `proposed`, `answered`, `resolved`; material by default, `--non-material` otherwise) live in `questions.yaml`. An open material question blocks specification and plan readiness and blocks leaving `SPECIFICATION`/`PLAN`.

## Delivery readiness

> **Stage describes where work is. Readiness describes which deliverable is ready.**

`yallaflow ready [work-id]` reports `SPEC_READY` (specification complete enough for review), `PLAN_READY` (specification and plan ready to hand off), or `DONE`. Reaching `PLAN_READY` never authorizes or starts implementation; the stage and the Behavior Contract still govern writes.

## Requirement identity and delivery convergence

> **Passing tests does not prove that the delivered implementation matches the approved intent.**

| Question | Answered by |
|---|---|
| Do the recorded technical checks pass? | **Verification** (`yallaflow verify`) |
| Is the implementation technically acceptable? | **Review** (`code-review`) |
| Does the delivered implementation satisfy the approved requirements and acceptance criteria? | **Convergence** (`yallaflow convergence`) |

The Agent determines semantic meaning; YallaFlow validates and records it.

**Where it applies.** Work whose pinned Behavior Contract includes the `delivery-convergence` skill: `feature` (bounded and architectural) and `change` architectural, routed on Skill Registry v5+. Bounded changes, bugs, refactors, releases, investigations, and older work never get this ceremony. `yallaflow guide` shows whether it applies.

**Requirement identity.** Before completing the intent checkpoint (`specification`, or `requirement-clarification` when there is no specification), the Agent extracts the approved intent as `REQ-###` requirements and `AC-###` acceptance criteria and records them with `yallaflow requirement record <work-id> --file requirements.json`. Each carries a short statement and provenance — the request, a specification section, a linked source, or an answered question — and a status (`active`, `withdrawn`, `deferred`; the last two need a reason and stay visible). IDs are never reused; revisions keep the previous content in history. The approved specification stays authoritative; the ledger only identifies what implementation must prove. `yallaflow requirement list|show` reads it.

**Convergence.** Once the verification checkpoint is completed, the Agent inspects the implementation against every active criterion and records one finding each with a reason and evidence:

| Finding | Meaning |
|---|---|
| `satisfied` | Implemented, and the cited evidence demonstrates it (needs more than free-text references) |
| `partial` | Some, but not all, of the criterion is implemented |
| `missing` | Not implemented |
| `contradicts` | The implementation behaves contrary to the criterion |

Behavior that no criterion requested is recorded separately as unrequested (`UR-###`) and must be resolved: `accepted` with a reason (a deliberate addition) or `removed`. An open `UR-###` blocks DONE; accepted items stay in history — *requested and satisfied* is not the same as *not requested but deliberately accepted*.

Assessments (`CV-###`) are append-only; the current state of each criterion is its latest finding. A finding becomes **stale** — its history stays, its current reliability does not — when the work is reopened or revised after it, its criterion is revised, an impact assessment invalidates convergence, or a repository file it cites changes. DONE requires the `delivery-convergence` checkpoint and every active criterion currently satisfied:

```text
DONE blocked:
- AC-003 → partial
- AC-007 → missing
- AC-011 → stale (evidence src/Services/PaymentService.php changed since CV-002)

Next valid action: resolve the convergence gaps and record a new convergence assessment.
```

If a DONE item's cited evidence later changes, DONE is not rewritten: `doctor` and `handoff` report the convergence as no longer current, and a reopen revalidates it.

**Decomposition.** When a parent owns a requirements ledger, children reference its IDs (`"acceptanceCriteria": ["AC-004"]`, or `PF-0001/AC-004`), `decompose propose` refuses references the ledger does not contain, and the coverage universe is the ledger's active set. A feature child answers for the criteria assigned to it (read from the parent, never copied), and the parent cannot withdraw or defer such a criterion while that child is not DONE. The parent's final convergence can cite a direct child's assessment as `convergence:PF-0007/CV-002` — only one that recorded that criterion as satisfied, and it goes stale whenever the child's current finding does — and must assess any criterion no child owned.

## Change impact

When approved intent changes on in-flight work once it is fixed — the intent checkpoint completed, or any later checkpoint already started (revising the intent checkpoint back does not reopen intent for free changes) — a source attached with `intake add`, or requirements changed with `requirement record` — YallaFlow raises a pending impact (`IM-###`). It does not judge what the change means. Until the Agent assesses it, `advance`, checkpoint completion, and `convergence record` are refused and code changes are not authorized.

```bash
yallaflow impact status PF-0001                   # triggers and the completed stages that need a verdict
yallaflow impact assess PF-0001 --file impact.json
```

The Agent marks each completed stage `affected` or `unaffected`, each with a reason. YallaFlow checks only mechanical consequences — an affected post-implementation stage makes every later one affected; any affected stage, or a changed acceptance criterion, makes convergence affected — and then revises the affected checkpoints through the same audited path as `checkpoint revise`: history entries, stage correction to the earliest affected stage, review-gate invalidation, and a verification freshness boundary. Verification runs, reviews, and convergence assessments are never deleted; they become stale. Unaffected stages keep their completed checkpoints.

## Interaction modes and review gates

`yallaflow init --mode autonomous|adaptive|gated` stores a per-project policy in `config.yaml`:

- **autonomous** — no optional review stops. Correctness gates (checkpoints, verification, knowledge review, material questions, dependencies) always apply.
- **adaptive** (default) — reviews `specification`, `plan`, and `decomposition`.
- **gated** — reviews every configured boundary (`discovery, clarification, design, specification, plan, decomposition, implementation, verification`).

```bash
yallaflow approve PF-0001 --stage plan --note "Reviewed."
yallaflow feedback PF-0001 --stage plan --changes-requested --note "Scope too broad."
```

Reviews live in `reviews.yaml`. A blocked `advance` requests review and names the command; `guide` shows the same blocker without requesting anything. Revising or reopening past an approved boundary returns it to `awaiting_review`, keeping the prior approval in history. A CLI approval is workflow evidence, not authentication.

## Work decomposition

Once a work item reaches `PLAN_READY`, a project too large for one implementation session can become a parent of normal, independently routed children:

```bash
yallaflow decompose propose PF-0001 --file decomposition.json
yallaflow decompose validate PF-0001
yallaflow decompose execute PF-0001    # explicit boundary: planning ends, execution begins
yallaflow decompose status PF-0001
yallaflow progress PF-0001             # child counts and states
yallaflow next PF-0001                 # dependency-unblocked children; never picks one for you
```

```json
{
  "children": [
    { "key": "foundation", "title": "Foundation & Authentication", "type": "feature", "scope": "bounded",
      "required": true, "requirements": ["REQ-001"], "acceptanceCriteria": ["AC-001", "AC-002"] },
    { "key": "signing", "title": "Customer Signing", "type": "feature", "scope": "bounded",
      "requirements": ["REQ-002"], "acceptanceCriteria": ["AC-003"], "dependsOn": ["foundation"] }
  ]
}
```

The file is agent-supplied; YallaFlow never splits requirements semantically. Validation rejects self-dependencies, unknown keys, and cycles, and reports traceability (cross-cutting and unassigned requirements). When the parent has a requirements ledger (v0.3.8), references must resolve against it and the universe is its active set; a parent without one (work routed before v0.3.8, or contracts without delivery convergence) keeps free-form labels with an optional declared `requirementsUniverse`/`acceptanceCriteriaUniverse`. `execute` creates one fully routed child per entry — each with its own contract, checkpoints, verification, and knowledge review. The parent's implementation gate becomes "every required child is DONE"; its verification, code-review, and knowledge stages remain.

## Agent handoff

> **Conversation history is not authoritative project state.**

```bash
yallaflow handoff PF-0004
```

`handoff` is a read-only, compact report for another agent or session: title/parent, type/scope/stage/readiness, completed/pending/blocked skills, open questions, review gates, latest verification, the delivery block (requirement/criteria counts, convergence counts, blocking criteria, open unrequested behavior, pending impact), knowledge review, Git summary, write authorization, relevant project context (stale/disputed facts), linked sources with their paths, discovery limitations, and the next objective. For a decomposed parent it adds child counts, executable candidates, and traceability gaps.

`handoff` and `resume` lead with a **PRIMARY UNRESOLVED OBJECTIVE** when one exists — a pending impact assessment, otherwise the latest reopen reason, checkpoint-revision reason, or write blocker. A child reaching DONE is never reported as project completion. A dirty Git tree at a DONE boundary is noted, never enforced; YallaFlow never commits.

`resume` answers *what should I continue*, `guide` *which behavior applies now*, `handoff` *complete context for someone else* — all from the same resolvers.

## Agent bootstrap (Codex, Claude)

A cold agent session should find YallaFlow without the developer explaining it again. `.yallaflow/AGENT.md` remains the one behavioral contract; provider files only point to it.

```bash
yallaflow agent setup codex     # repository-root AGENTS.md
yallaflow agent setup claude    # repository-root CLAUDE.md (imports @.yallaflow/AGENT.md)
yallaflow agent status
yallaflow agent refresh
```

`agent setup` appends one versioned, hash-checked block holding the session-start sequence — confirm `.yallaflow/` exists, follow AGENT.md, run `yallaflow brief`, `resume`/`handoff` the active work, `guide` for the next valid action, follow the pinned contract, record through YallaFlow commands. Existing file content is kept byte-for-byte. Setup is idempotent and supports `--dry-run`; a hand-edited block is refused unless `--preserve-existing`; a block from a newer YallaFlow is never downgraded. `agent status`, `brief`, `upgrade plan`, and `doctor` (as a warning) report outdated or edited blocks; `agent refresh` updates only unmodified, outdated ones. No provider file is written unless you run `agent setup`.

## Brownfield bootstrap and baseline

`yallaflow init` in an existing repository records deterministic stack hints (package managers, framework markers, CI/container files) in `context/tech-stack.md`. This seeds, but does not replace, a reviewed baseline:

```bash
yallaflow baseline start                             # read-only investigation work item
yallaflow checkpoint PF-0001 --skill repository-baseline --complete --summary "Repository discovered."
yallaflow baseline draft PF-0001 --file baseline.json
yallaflow baseline status PF-0001
yallaflow baseline show PF-0001
yallaflow baseline approve PF-0001 --note "Looks complete."
yallaflow baseline feedback PF-0001 --changes-requested --note "Add database evidence."
```

```json
{
  "facts": [
    { "area": "database", "status": "confirmed", "summary": "PostgreSQL is the application database.",
      "evidence": ["compose.yaml", "config/database.php"], "source": "repository" },
    { "area": "environment", "status": "unresolved", "summary": "Production hosting provider cannot be established.",
      "evidence": [".env.example"], "source": "repository" }
  ],
  "limitations": [
    { "type": "runtime-unavailable", "area": "database", "summary": "Production schema was not inspected.",
      "reason": "No production DB access." }
  ]
}
```

Areas: `project`, `tech-stack`, `architecture`, `database`, `integration`, `environment`, `convention`, `business-rule`. Each fact has a confidence (`confirmed`, `inferred`, `unresolved` — a genuine project question the evidence cannot settle), a provenance (`repository`, `runtime`, `user-confirmed`), and evidence. What the discovery could not inspect goes under `limitations`, never as facts. Approval (reusing the `baseline` review gate) turns every fact into a canonical `CTX-####` project fact; limitations stay with the work item. A second approved baseline is refused — living memory, not baseline refresh, keeps knowledge current.

## Project knowledge promotion

> **Task history is temporary. Stable project knowledge is durable.**

```bash
yallaflow knowledge propose PF-0001 --kind integration --source implementation-runtime \
  --summary "Browser previews require OSS CORS headers." --evidence config/filesystems.php
yallaflow knowledge list PF-0001
yallaflow knowledge promote PF-0001 --candidate K-001
yallaflow knowledge reject PF-0001 --candidate K-002 --reason "Temporary implementation detail."
yallaflow knowledge review PF-0001 --none
```

Kinds: `architecture`, `database`, `integration`, `environment`, `convention`, `business-rule`, `project`, `tech-stack` (all become `CTX-####` facts) and `decision` (becomes an ADR under `decisions/`, requiring `--context`, `--decision`, `--reason`, `--cost-if-wrong`, or `--from-ruling N`). Optional `--confidence` and `--provenance` apply to context facts; `--reconfirms|--supersedes|--disputes CTX-####` relate a candidate to an existing fact (see [project-memory.md](project-memory.md)).

`--source` is required for current work: `design-spec` knowledge may be reviewed at a stable `SPEC_READY`/`PLAN_READY` endpoint; `implementation-runtime` knowledge requires the normal completion stage and — except for investigations — fresh successful verification. Review is explicit: resolve every candidate, or record `--none`. New work pins knowledge policy v1 and must complete review before DONE. YallaFlow validates structure only; it never classifies knowledge by keywords or asks a model.

```text
Work progress ≠ project knowledge        Ruling ≠ ADR
```

## Work lifecycle

A work item stores intake, facts, questions, evidence, a scope-appropriate specification, a plan where required, verification, rulings, knowledge updates, and the result — and, for feature work and architectural changes, its structured intent (requirements, acceptance criteria), convergence assessments, and impact assessments. Bugs are root-cause-first. Investigations are read-only and have no implementation stage. Architectural work gets the design → specification → planning path.

## Compatibility with older workspaces

Reads never migrate or create files. Older work keeps loading: v0.1 contract-less items (also those created by pre-v0.3.6 direct commands) keep their stage-only behavior; v0.2.1 capabilities derive an unpinned contract; v0.2.2 contracts without `progress.yaml` show all skills pending; v0.2.3 work has no required knowledge policy; registry-v1 work keeps its contract. A legacy `.projectflow/` workspace is not migrated — `yallaflow init` stops with a message instead of creating a parallel workspace, and it refuses to reinitialize over a Git-tracked `.yallaflow` missing from the working tree. For the v0.3.5 → v0.3.6 upgrade see [`upgrading-to-v0.3.6.md`](upgrading-to-v0.3.6.md); for v0.3.7 (reconciling legacy context, `upgrade status`, `brief`) see [`upgrading-to-v0.3.7.md`](upgrading-to-v0.3.7.md); for v0.3.8 (delivery convergence, agent bootstrap) see [`upgrading-to-v0.3.8.md`](upgrading-to-v0.3.8.md). Work routed before v0.3.8 keeps its pinned registry ≤ v4 contract and never acquires requirement, convergence, or impact gates.
