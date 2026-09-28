# CLI Reference

YallaFlow v0.3.7. Every command also answers `--help` / `-h` (at any position, including sub-actions such as `yallaflow knowledge propose --help`) without changing any state. `[work-id]` defaults to the active work item.

## Workspace

| Command | Purpose |
|---|---|
| `yallaflow init [--name NAME] [--type greenfield\|brownfield] [--mode autonomous\|adaptive\|gated]` | Create `.yallaflow/`. Type is detected when omitted; mode defaults to `adaptive`. Refuses to overwrite an existing, legacy `.projectflow/`, or Git-tracked-but-missing workspace. |
| `yallaflow status` | All work items, stages, write access; warns if `AGENT.md` predates the installed agent contract. |
| `yallaflow doctor` | Read-only integrity report: workspace files, ledgers, lifecycle consistency, project-context ledger, projection drift, source checksums, reconciliation plans and lineage, legacy sections presented as current truth. Freshness, agent-contract, hand-edited legacy sections, work.md lifecycle-record drift, and Git-tracking notes are warnings. Exit code 1 on structural failures. |
| `yallaflow brief` | Fresh-agent orientation, read-only: agent contract, active and most recent work, project memory, pending legacy reconciliation, sources, the primary next concern and the command to run next. Never dumps context. |
| `yallaflow upgrade status` | Read-only upgrade assessment: installed version, legacy structures, agent contract, canonical and pending legacy facts, reconciliation progress, sources, work history, integrity, Git durability, recommended next action. |
| `yallaflow upgrade plan` | The ordered upgrade steps as deliberate commands. Never migrates or repairs anything itself. |
| `yallaflow --version` | Package version. |

## Intake and routing

| Command | Purpose |
|---|---|
| `yallaflow start ["<request>"]` | Without text: show intents. With text: create a pending, unclassified work item preserving the raw request. |
| `yallaflow intake <file> [<file> ...] [--title TITLE]` | Capture files as immutable `SRC-####` sources and create one pending work item. |
| `yallaflow intake add <work-id> <file> [<file> ...] [--reason TEXT]` | Attach sources to existing work. `--reason` is required for DONE work (recorded as a recovered source). |
| `yallaflow source list` · `yallaflow source show <source-id> [--content]` | Inspect sources, their linked work, and (optionally) available text. |
| `yallaflow request revise <work-id> --text TEXT --reason TEXT` | Correct a pending (unrouted) request; history is kept. |
| `yallaflow route <work-id> --type TYPE --scope SCOPE --confidence LEVEL --reason REASON [--title TITLE]` | Apply the agent's classification: pins the Behavior Contract, workflow, read-only and knowledge policy. |
| `yallaflow feature\|bug\|investigate\|change\|refactor\|release "<title>" --scope SCOPE` | Direct classified work through the same path as `start` → `route`. `--scope` is required; nothing is created without it. |

Types: `feature`, `bug`, `investigation`, `change`, `refactor`, `release`. Scopes: `spike`, `bounded`, `architectural` (not every pair is supported, e.g. no `feature` spike). Confidence: `low`, `medium`, `high`.

## Behavior and progress

| Command | Purpose |
|---|---|
| `yallaflow guide [work-id]` | Pinned contract, skill progress, write authorization, open questions, and CURRENT OBJECTIVE / BLOCKER / NEXT VALID ACTION. Read-only. |
| `yallaflow skill <skill-id>` | Package-owned instructions for a skill. |
| `yallaflow checkpoint [work-id] --skill SKILL --start` | Mark a skill in progress. |
| `yallaflow checkpoint [work-id] --skill SKILL --complete --summary TEXT [--evidence REF ...]` | Complete a skill. |
| `yallaflow checkpoint [work-id] --skill SKILL --status pending\|in_progress\|completed\|blocked [--summary TEXT] [--evidence REF]` | Explicit status (blocked requires a summary). |
| `yallaflow checkpoint revise [work-id] --skill SKILL --status pending\|in_progress\|blocked --reason TEXT [--summary TEXT]` | Audited correction; refused on DONE work. |
| `yallaflow checkpoint [work-id] --ruling DECISION --ruling-reason WHY --cost-if-wrong IMPACT` | Record a task-local ruling. |
| `yallaflow advance [work-id]` | Move to the next stage if every gate is satisfied; otherwise explain the blocker. Reports the next valid action. |
| `yallaflow ready [work-id]` | Delivery readiness: `SPEC_READY`, `PLAN_READY`, `DONE`. |
| `yallaflow resume [work-id]` | What to continue. With an ID: read-only inspection, active work unchanged. |
| `yallaflow handoff [work-id]` | Compact, read-only context for another agent or session. |
| `yallaflow reopen <work-id> --to implementation\|verification\|review --reason REASON` | Reactivate DONE work auditably. |

Skills (Skill Registry v4): `context-discovery`, `requirement-clarification`, `design-exploration`, `specification`, `implementation-planning`, `systematic-debugging`, `implementation`, `verification`, `code-review`, `repository-baseline`, `context-reconciliation`. Work pinned to an earlier registry version keeps its recorded skills.

## Verification

| Command | Purpose |
|---|---|
| `yallaflow verify [work-id] -- <executable> [args...]` | Argv mode (default, preferred): no shell, exact arguments. |
| `yallaflow verify [work-id] --shell "<command>"` | Shell mode, only when pipes/redirection/`&&` are needed. |
| `yallaflow verify [work-id] --script <path>` | Execute a script file directly. |
| `yallaflow verify list [work-id]` | Every recorded run (`V-###`), passed and failed. |

A mode is always required. Runs are appended to `work/<id>/evidence/`. Refused on DONE work. A failure after the verification checkpoint was completed returns that checkpoint to `in_progress`.

## Questions and reviews

| Command | Purpose |
|---|---|
| `yallaflow question add [work-id] --category business\|architecture --text TEXT [--proposal TEXT] [--non-material]` | Record a structured decision question. |
| `yallaflow question list [work-id]` | List questions. |
| `yallaflow question answer [work-id] --id Q-001 --answer TEXT` | Answer. |
| `yallaflow question resolve [work-id] --id Q-001 [--resolution TEXT]` | Resolve. |
| `yallaflow approve <work-id> --stage GATE [--note TEXT]` | Approve a review gate. |
| `yallaflow feedback <work-id> --stage GATE --changes-requested [--note TEXT]` | Request changes. |

Gates: `discovery`, `clarification`, `design`, `specification`, `plan`, `decomposition`, `implementation`, `verification` (plus `baseline`, managed by the baseline commands, and `reconciliation`, managed only by `context reconcile approve|feedback` — the generic `approve --stage reconciliation` is refused).

## Decomposition

| Command | Purpose |
|---|---|
| `yallaflow decompose propose <parent-id> --file <decomposition.json>` | Record the agent's child breakdown (requires `PLAN_READY`). |
| `yallaflow decompose validate <parent-id>` | Check dependencies and traceability. |
| `yallaflow decompose execute <parent-id>` | Create routed child work items. |
| `yallaflow decompose status <parent-id>` · `yallaflow progress <parent-id>` · `yallaflow next <parent-id>` | Child status, counts, and dependency-unblocked candidates. |

## Brownfield baseline

| Command | Purpose |
|---|---|
| `yallaflow baseline start` | Create (or resume) the read-only baseline work item. Refused once a baseline is approved. |
| `yallaflow baseline draft <work-id> --file <baseline.json>` | Record facts and discovery limitations (requires the `repository-baseline` checkpoint). |
| `yallaflow baseline status [work-id]` · `yallaflow baseline show [work-id]` | Review the draft. |
| `yallaflow baseline approve [work-id] [--note TEXT]` | Promote facts into the project-context ledger. |
| `yallaflow baseline feedback [work-id] --changes-requested [--note TEXT]` | Request changes. |

## Project knowledge and memory

| Command | Purpose |
|---|---|
| `yallaflow knowledge propose [work-id] --kind KIND --source design-spec\|implementation-runtime --summary TEXT --evidence REF [...]` | Propose a candidate. Optional: `--supersedes\|--reconfirms\|--disputes CTX-####`, `--confidence confirmed\|inferred\|unresolved`, `--provenance repository\|runtime\|user-confirmed`; for `--kind decision`: `--context --decision --reason --cost-if-wrong` or `--from-ruling N`. |
| `yallaflow knowledge list [work-id]` | Candidates and review status. |
| `yallaflow knowledge promote [work-id] --candidate ID` | Promote into project memory (or an ADR). |
| `yallaflow knowledge reject [work-id] --candidate ID --reason TEXT` | Reject. |
| `yallaflow knowledge review [work-id] --none` | Record that no durable knowledge was found. |
| `yallaflow context status` | Per-area current / may-be-stale / stale-evidence / disputed / unresolved / superseded counts and facts to revalidate. Read-only. |
| `yallaflow context list [--area AREA] [--all]` | Current facts with freshness; `--all` includes superseded. |
| `yallaflow context show <CTX-id>` · `yallaflow context history <CTX-id>` | One fact in detail; its lineage and events. |
| `yallaflow context affected [--since REF] [path ...]` | Facts whose evidence paths changed (working tree, since a ref, or given paths). |
| `yallaflow context adopt [--dry-run]` | `--dry-run` lists legacy v0.3.5 items not yet governed (read-only). Without it, imports only when provably duplicate-free (one legacy item, no current facts); otherwise refused — use reconciliation. |
| `yallaflow context render` | Regenerate managed Markdown blocks from the ledger. |
| `yallaflow limitation add [work-id] --type TYPE --area AREA --summary TEXT --reason TEXT` · `yallaflow limitation list [work-id]` | Work-scoped discovery limitations. |

Knowledge kinds: `architecture`, `database`, `integration`, `environment`, `convention`, `business-rule`, `project`, `tech-stack`, `decision`. Limitation types: `not-inspected`, `unavailable`, `out-of-scope`, `runtime-unavailable`, `insufficient-evidence`, `uncaptured-artifact`. Limitation areas: the eight context areas plus `requirement`, `testing`, `security`, `other`.

## Legacy context reconciliation

`[work-id]` defaults to the open reconciliation work item.

| Command | Purpose |
|---|---|
| `yallaflow context reconcile start` | Create (or resume) the read-only reconciliation work item; every pending legacy item becomes a stable `RC-####` candidate. Refused when nothing is pending. |
| `yallaflow context reconcile status [work-id]` | Progress, decisions by action, review state, open questions, pending candidates, blockers, next action. |
| `yallaflow context reconcile show [work-id] [--candidate RC-####]` | Candidates with origin, wording, evidence, legacy location, flags, and decision. |
| `yallaflow context reconcile plan [work-id] --file <decisions.json>` | Record Agent decisions (`{"decisions":[{"candidate","action","target","reason","summary","area","limitationType"}]}`; upserted; `"action":"pending"` clears). Whole file rejected on any invalid relation. Invalidates a prior approval. |
| `yallaflow context reconcile preview [work-id]` | Read-only: resulting current memory (counts, areas, new facts with their future CTX IDs, merges, supersessions, disputes, limitations, skips, pending, legacy Markdown impact). |
| `yallaflow context reconcile approve [work-id] [--note TEXT]` | Human approval bound to the plan's content fingerprint (requires the `context-reconciliation` checkpoint). |
| `yallaflow context reconcile feedback [work-id] --changes-requested [--note TEXT]` | Request changes. |
| `yallaflow context reconcile apply [work-id]` | Apply the approved, decided candidates in one atomic ledger write; archive and retire generated legacy sections; idempotent. DONE once every candidate is applied. |

Actions: `new`; `merge-with` (target `RC-####` only — collapse candidates that are the same statement); `reconfirms` (target `CTX-####` or `RC-####`, same area — one more observation of a truth already represented); `supersedes`, `disputes` (target `RC-####` or `CTX-####`); `skip` (reason); `limitation` (`limitationType` + reason). Applying writes context schema v2. See [upgrading-to-v0.3.7.md](upgrading-to-v0.3.7.md#4-reconcile-legacy-project-context).

## Agent contract

| Command | Purpose |
|---|---|
| `yallaflow agent status` | Is `.yallaflow/AGENT.md` at the installed agent-contract version? Read-only. |
| `yallaflow agent refresh [--preserve-existing] [--dry-run]` | Deliberate, idempotent update of the managed block; customized guidance is kept only with `--preserve-existing`. |
