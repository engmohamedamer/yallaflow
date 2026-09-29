# CLI Reference

YallaFlow v0.3.9. Every command also answers `--help` / `-h` (at any position, including sub-actions such as `yallaflow knowledge propose --help`) without changing any state. `[work-id]` defaults to the active work item.

## Workspace

| Command | Purpose |
|---|---|
| `yallaflow init [--name NAME] [--type greenfield\|brownfield] [--mode autonomous\|adaptive\|gated]` | Create `.yallaflow/`. Type is detected from the bounded repository inventory when omitted (Brownfield: a recognized manifest plus at least one recognized source file, at least 10 recognized source files, or meaningful container/CI configuration; a bare `.git` or a manifest alone is Greenfield); `--type` overrides. A new Brownfield init writes repository hints for the meaningful container/CI files the inventory found (Dockerfile, Docker Compose, CI, grouped by kind with paths) and a labelled init-time snapshot of nested manifest framework hints into `context/tech-stack.md` (not approved project memory). Mode defaults to `adaptive`. Refuses to overwrite an existing, legacy `.projectflow/`, or Git-tracked-but-missing workspace. |
| `yallaflow status` | All work items, stages, write access; warns if `AGENT.md` predates the installed agent contract. |
| `yallaflow doctor` | Read-only integrity report: workspace files, ledgers, lifecycle consistency, project-context ledger, projection drift, source checksums, reconciliation plans and lineage, legacy sections presented as current truth, delivery state (requirement/criterion references, convergence findings and evidence, impact revisions, a DONE or completed-convergence state the recorded findings never supported). Freshness (including convergence evidence that changed after it was recorded), agent-contract and bootstrap-block, hand-edited legacy sections, work.md lifecycle-record drift, and Git-tracking notes are warnings. Exit code 1 on structural failures. |
| `yallaflow brief` | Fresh-agent orientation, read-only and project-first (at most 45 lines). **Project:** current-fact text in fixed area order and caps (Project 3, Tech Stack 3, Architecture 3, Database 2, Integrations 2, Environments 2, Conventions and Business Rules a count plus one sample), fact-ID order, summaries on one line (≈160 code points); **NEEDS CARE** (up to 5) — facts that are unresolved, disputed, MAY_BE_STALE, or STALE_EVIDENCE, i.e. mechanically known state/freshness, not a risk assessment; without project memory, the inventory headline and the baseline step. **Work:** active and most recent work, delivery line, sources, legacy reconciliation. **YallaFlow:** package, agent contract, bootstrap blocks, integrity. Then the primary next concern and the command to run next. |
| `yallaflow inspect` | Read-only, bounded, deterministic repository inventory (text only; works without a workspace; writes and persists nothing). Classification with reasons; Git presence; scan bounds and truncation; manifests at any depth within bounds with framework/version hints (`@angular/core`, `react`, `vue`, `next`, `@nestjs/core`, `vite`, `laravel/framework`, `yiisoft/yii2`, Spring Boot) — a major version only when the declared version is a literal; recognized source-file counts; documentation candidates in the formats intake supports, each with its intake handling (preserve-only formats marked), listed but never read; container/CI configuration; one next action (`init`, `baseline start`, the next baseline step, or `brief`). |
| `yallaflow upgrade status` | Read-only upgrade assessment: installed version, legacy structures, agent contract, canonical and pending legacy facts, reconciliation progress, sources, work history, integrity, Git durability, recommended next action. |
| `yallaflow upgrade plan` | The ordered upgrade steps as deliberate commands. Never migrates or repairs anything itself. |
| `yallaflow --version` | Package version. |

## Intake and routing

| Command | Purpose |
|---|---|
| `yallaflow start ["<request>"]` | Without text: show intents. With text: create a pending, unclassified work item preserving the raw request. |
| `yallaflow intake <file> [<file> ...] [--title TITLE]` | Capture files as immutable `SRC-####` sources and create one pending work item. |
| `yallaflow intake add <work-id> <file> [<file> ...] [--reason TEXT]` | Attach sources to existing work. `--reason` is required for DONE work (recorded as a recovered source). On delivery-convergence work whose approved intent is already fixed, it also raises a pending impact assessment (see [Delivery convergence](#delivery-convergence-and-change-impact)). |
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
| `yallaflow reopen <work-id> --to implementation\|verification\|review --reason REASON` | Reactivate DONE work auditably. Resets the post-implementation chain from the target (implementation → verification → delivery-convergence → code-review); evidence and convergence history are kept, and reopening to implementation or verification makes them stale. Reopening to review resets only code review and leaves verification and convergence current. |

Skills (Skill Registry v5): `context-discovery`, `requirement-clarification`, `design-exploration`, `specification`, `implementation-planning`, `systematic-debugging`, `implementation`, `verification`, `delivery-convergence`, `code-review`, `repository-baseline`, `context-reconciliation`. Work pinned to an earlier registry version keeps its recorded skills.

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
| `yallaflow baseline start` | Create (or resume) the baseline work item (read-only for application code). Prints the onboarding steps: `inspect`, `intake add` for material documents, the `repository-baseline` checkpoint, `baseline draft`, then human review and approval. Refused once a baseline is approved. |
| `yallaflow baseline draft <work-id> --file <baseline.json>` | Record facts and discovery limitations (requires the `repository-baseline` checkpoint). |
| `yallaflow baseline status [work-id]` · `yallaflow baseline show [work-id]` | Review the draft; `status` names the next baseline step. |
| `yallaflow baseline approve [work-id] [--note TEXT]` | Promote facts into the project-context ledger. Human-only: no command or interaction mode approves a baseline automatically. |
| `yallaflow baseline feedback [work-id] --changes-requested [--note TEXT]` | Request changes. |

## Project knowledge and memory

| Command | Purpose |
|---|---|
| `yallaflow knowledge propose [work-id] --kind KIND --source design-spec\|implementation-runtime --summary TEXT --evidence REF [...]` | Propose a candidate. Optional: `--supersedes\|--reconfirms\|--disputes CTX-####`, `--confidence confirmed\|inferred\|unresolved`, `--provenance repository\|runtime\|user-confirmed`; for `--kind decision`: `--context --decision --reason --cost-if-wrong` or `--from-ruling N`. |
| `yallaflow knowledge list [work-id]` | Candidates and review status. |
| `yallaflow knowledge promote [work-id] --candidate ID` | Promote into project memory (or an ADR). |
| `yallaflow knowledge reject [work-id] --candidate ID --reason TEXT` | Reject. |
| `yallaflow knowledge review [work-id] --none` | Record that no durable knowledge was found. |
| `yallaflow context status` | Per-area current / may-be-stale / stale-evidence / disputed / unresolved / superseded counts and facts to revalidate. In a workspace without a Git commit to compare against, also explains that file evidence is still checked by SHA-256 content hash and that directory evidence is UNKNOWN (not stale). Read-only. |
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

## Delivery convergence and change impact

Applies to work whose pinned Behavior Contract includes `delivery-convergence` (Skill Registry v5+): `feature` (bounded, architectural) and `change` architectural. Other work, and work routed before v0.3.8, is unaffected — these commands report *not applicable* and write nothing. Read commands never mutate; `record`/`assess` validate the whole file first and change nothing on any error.

| Command | Purpose |
|---|---|
| `yallaflow requirement record <work-id> --file <requirements.json>` | Record Agent-extracted requirements (`REQ-###`) and acceptance criteria (`AC-###`): `{"requirements":[{"id","statement","provenance":[...],"status","reason"}],"acceptanceCriteria":[{"id","requirement","statement","provenance":[...],"status","reason"}]}`. Upsert by ID; omitted entries are unchanged; revisions keep the previous content in history. Provenance: `{"type":"request"}`, `{"type":"specification","section":"..."}`, `{"type":"source","source":"SRC-####","locator":"..."}`, `{"type":"question","question":"Q-###"}`. Status `active`, `withdrawn`, or `deferred` (the last two need a reason). Every active requirement needs an active criterion. Refused on DONE work and on decomposed children that answer for their parent's criteria. Once the intent is fixed — the intent checkpoint completed, or any later checkpoint already started — a change raises a pending impact. A criterion a not-yet-DONE decomposed child answers for cannot be withdrawn or deferred on the parent. |
| `yallaflow requirement list <work-id>` | Requirements, criteria (own, or assigned from the parent), and each criterion's current convergence. |
| `yallaflow requirement show <work-id> <REQ-###\|AC-###>` | One entry: statement, status, provenance, history, and (for a criterion) its current finding and staleness. |
| `yallaflow convergence record <work-id> --file <convergence.json>` | Append assessment `CV-###`: `{"summary","findings":[{"criterion","status","reason","evidence":[...]}],"unrequested":[{"id?","summary","evidence","disposition","reason"}]}`. Status `satisfied`, `partial`, `missing`, `contradicts`; every finding needs a reason and evidence; `satisfied` needs more than free-text references and cannot rest on a failed run. Evidence: repository paths, `verification:V-###`, `runtime:`/`user:` text, `convergence:PF-####/CV-###` (a child's assessment), or a reference. Unrequested behavior (`UR-###`, allocated when `id` is omitted): `open`, `accepted` (reason), `removed` (reason). Allowed once the verification checkpoint is completed, never on DONE or while an impact is pending. `convergence:` evidence must cite a direct decomposition child's assessment that recorded this criterion as satisfied, and goes stale when the child's current finding does. Paths under `.yallaflow/` are not accepted as evidence. A gap recorded after the `delivery-convergence` checkpoint was completed returns it to `in_progress`. |
| `yallaflow convergence status <work-id>` | Counts per status (and stale), open unrequested behavior, blockers, next valid action. |
| `yallaflow convergence show <work-id> [CV-###\|AC-###\|UR-###]` | All assessments, one assessment, or one criterion's/item's history. |
| `yallaflow impact status <work-id>` | Assessed impacts and the pending one: its triggers and every completed stage that needs a verdict, with a JSON template. |
| `yallaflow impact assess <work-id> --file <impact.json>` | `{"impact":"IM-###","summary","stages":{"<skill>":{"verdict":"affected\|unaffected","reason":"..."}}}` — one verdict per completed stage. Rules: an affected post-implementation stage makes every later one affected; any affected stage, or a changed acceptance criterion, makes `delivery-convergence` affected. Affected checkpoints are revised through the audited `checkpoint revise` path (stage correction, gate invalidation, verification freshness boundary); no evidence is deleted. |

A pending impact blocks `advance`, checkpoint completion, and `convergence record`, and withholds write authorization in `guide`. DONE requires the `delivery-convergence` checkpoint, every active criterion currently satisfied (not stale), no open unrequested behavior, and no pending impact.

## Agent contract

| Command | Purpose |
|---|---|
| `yallaflow agent status` | Is `.yallaflow/AGENT.md` at the installed agent-contract version, and which provider bootstrap blocks are set up (and current)? Read-only. |
| `yallaflow agent refresh [--preserve-existing] [--dry-run]` | Deliberate, idempotent update of the managed block; customized guidance is kept only with `--preserve-existing`. Also updates installed provider bootstrap blocks that are unmodified and outdated; anything else is reported, never forced. |
| `yallaflow agent setup <codex\|claude> [--preserve-existing] [--dry-run]` | Add a thin, versioned YallaFlow bootstrap block to the provider's repository-root session file (`codex` → `AGENTS.md`, `claude` → `CLAUDE.md`). The block holds only the session-start sequence and a pointer to `.yallaflow/AGENT.md` (for Claude, an `@.yallaflow/AGENT.md` import); it never restates the contract. Existing content is kept byte-for-byte (the block is appended); idempotent; a hand-edited block is refused unless `--preserve-existing`; a newer block is never downgraded. |
