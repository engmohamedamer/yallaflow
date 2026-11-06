# YallaFlow as an engineering workspace: gap analysis, design and release impact

**Status:** proposal for owner review (PF-0040, from the manual acceptance feedback SRC-0027). Nothing here is implemented. The mockup is `prototype.html`.

## 1. Current UX gap analysis
| Area | Today (1.2.0 + 1.3.0 candidates) | Gap |
|---|---|---|
| **Work items** | Create (with attachments) and browse; a read-only item page with next step, stations, delivery, attachments; **Make it active** only inside the Agent panel (`--agents`). | No edit of request or requirements. No pause or close. No moving between stages. Blocked reasons are shown, but the only action offered is a command to copy. |
| **Lifecycle** | Core has `advance`, `reopen --to`, `request revise`, `requirement record`, `impact assess`, `activate`, `finish`, `approve`/`feedback` (gates), and `checkpoint revise`. "Paused" exists only as a **derived** Flow state (routed, not active, not waiting). | No supported operation for *cancel/close without delivery* or an explicit *on hold*. The console exposes none of the existing write operations except create/attach/activate. |
| **Existing projects** | `inspect` (read-only inventory with deterministic framework hints for npm/composer/Maven); baseline `start → draft → show → approve/feedback`; `brief` shows memory and NEEDS CARE. In the console, a Brownfield project without a baseline refuses Create Work and says why. | No onboarding entry point in the console. No Project Overview: the stack, memory status and integrity live in `brief`/`inspect`, not on a page. Stack hints cover only a few frameworks and no databases or environments. |
| **Dev runtime** | Nothing. | No Run, Stop or Logs, and no way to see which services a project has. |
| **New projects** | `yallaflow init` in an existing folder (CLI). | No guided creation, no templates, no "create folder and Git and YallaFlow" flow. |
| **Navigation** | Flow, Work, Worktrees, Insights, Projects overview, Agent panel. | No project home: the first screen is the Flow even when the project has no memory yet. |

## 2. Core capability inventory (what the console could reuse)
| User intent | Existing Core operation | Console today | Safe to expose? |
|---|---|---|---|
| Create, classify, attach | `start --keep-active --via console`, `route`, `intake add` | Yes | Done |
| Activate or switch | `activate <id>` | Agent panel only | **Yes**: move it to the item page for every console with writes |
| Edit request text | `request revise <id> --text --reason` (audited, raises impact) | No | Yes, with a reason field |
| Edit requirements/ACs | `requirement record --file` (+ `impact assess` when intent was fixed) | No | Partly. Recording is fine; **impact assessment is a judgment** the agent or human makes per stage, so the console collects it explicitly and never fills it in. |
| Advance a stage | `advance <id>` (refuses with a blocker and the next valid action) | No | Yes. Core decides, and the console shows Core's refusal text. |
| Move back | `reopen <id> --to implementation\|verification\|review --reason` | No | Yes, with a reason |
| Answer questions | `question answer` | No | Yes (human input) |
| Approve or reject a gate | `approve/feedback --stage`, `baseline approve/feedback` | Deliberately no | **Only as an explicit human action** with a confirmation and the "identity not verified" attestation; never automatic, never from an agent session. Owner decision required. |
| Finish | `finish <id>` | No | Yes (it only checks; Core refuses when not ready) |
| Pause or hold | none (derived "paused") | – | **New Core operation needed** (see 4) |
| Cancel or close undelivered | none | – | **New Core operation needed** |
| Onboard an existing repo | `inspect`, `baseline start/draft/approve` | No | Inspect yes. The draft is produced by an agent's discovery; approval is human. |
| Stack facts | `inspect` hints; approved baseline facts (confirmed/inferred/unresolved) | No | Yes, read-only |
| Run services | none | – | **New infrastructure** |
| New project | `init` | No | Wrapper is small; scaffolding is new |

**Rule kept everywhere:** the console only invokes Core commands through the existing runner, under the workspace lock, and shows Core's own refusal text. It never writes stage flags, evidence or checkpoints itself, and never decides a gate.

## 3. User journeys
**Existing repository (first run)**
1. **Add.** Projects → **Add project** → choose a folder. The console runs `inspect`, read-only.
2. **Project Overview.** It shows:
   - "Not onboarded yet": what inspection found (manifests, frameworks, containers, docs), each marked **detected from files**;
   - the explanation that YallaFlow needs an approved understanding before work.
3. **Onboard with my agent.** This starts `baseline start` and, with the Agent Workspace, hands Codex the repository-baseline skill. The agent's draft appears as a **review screen**: facts grouped by area and marked confirmed, inferred or unresolved, plus coverage and limitations.
4. **Human review.** You choose **Approve** (or **Request changes** with a note). Only then do the facts become project memory, and the Overview switches to "Onboarded on <date>".
5. **First work item** through Create Work. The original objective carries over, as `baseline start --objective` already supports.

**New project**
1. Projects → **New project** opens the wizard (see 7).
2. Preview, then **Create**. YallaFlow creates the folder, Git and `yallaflow init` (Greenfield), records the setup as the first work item, and the setup runs as that item's implementation (see 7).
3. The Overview shows the new project with "Setup in progress", then the normal Flow.

**Daily use**
1. **Overview:** what needs you, the active item, and services running or stopped.
2. **Flow:** the board, with contextual actions on cards.
3. **Item page:** the agent and the evidence.

## 4. Work management interaction design
- **The board is Core's stations, not free columns.** Cards sit where Core puts them, and a column never moves a stage by itself.
- **Drag and drop proposes; Core decides.**
  - Dropping a card on the **next** station calls `advance` (and stops at the first blocker).
  - Dropping it on an **earlier** station opens *Reopen to…* with the allowed targets (`implementation|verification|review`) and a required reason.
  - Any other drop is not allowed. While dragging, invalid targets are dimmed, using the item's `nextValidAction` from the snapshot, so the UI never guesses.
- **Contextual menu** (right-click, or "⋯" on the card), offering only what applies to this item's state:
  - Open;
  - Make active;
  - Advance (with Core's blocker);
  - Reopen to…;
  - Edit request…;
  - Requirements…;
  - Answer question…;
  - Put on hold / Resume;
  - Close without delivery…;
  - Copy command.
- **Blocked moves explain themselves.** The card shows Core's blocker sentence and the next valid action as a button when it is a console-safe action ("Answer Q-002", "Run verification in your agent"), otherwise as a command.
- **Requirements editor.** It's a structured form for REQ and AC entries, each with its provenance, and it produces the same JSON `requirement record` takes.
  - If intent is already fixed, Core raises a pending impact. The console then shows the impact assessment form, one decision per completed stage, which the person or the agent fills in.
- **New Core operations needed (next minor release):**
  - `yallaflow hold <id> --reason` and `yallaflow resume-hold <id>` (names to be chosen). An explicit on-hold flag in `meta` with an audit record, distinct from the derived "paused". Held items are skipped by `next`, and activation is refused until resumed.
  - `yallaflow close <id> --reason --outcome cancelled|superseded|duplicate`: a terminal stage `CLOSED` that is **not DONE**. No evidence is required, it is never counted as delivered, it can be reopened, and integrity and doctor understand it.
  - Both need schema additions in `meta`/`progress`, snapshot and work read-contract fields (`yallaflow.snapshot/1` is additive), transitions tests, and frozen-older-CLI compatibility tests, because older CLIs must read a workspace with CLOSED items.

## 5. Project Overview and stack detection
**Overview sections** (one page, project home):
1. **About:** purpose and description from the approved baseline. Before that, only the README title, shown as "from README, not yet confirmed".
2. **Technology:** chips per area (Backend, Frontend, Database, Build, Package manager, Containers, CI, Environment). Each chip carries its **status badge**:
   - **Confirmed:** an approved baseline fact.
   - **Detected:** a deterministic file signal, such as `composer.json` requiring `laravel/framework ^11`.
   - **Inferred:** agent-reported, not approved.
   - **Unknown.**

   Clicking a chip shows its evidence: the file path and the declared version.
3. **Structure:** top-level modules and apps from the inventory (counts, not file dumps).
4. **YallaFlow:**
   - onboarding status (none, draft waiting for review, approved on a date);
   - memory health (facts, NEEDS CARE count, and the stale ones);
   - integrity warnings from `doctor`;
   - the agent contract and bootstrap state.
5. **Work:** active item, waiting on you, failing verification, recently done.
6. **Development environment:** services with their status and **Run, Stop and Logs** (see 6), the env files present (names only, never values), and the ports declared.

**Detection, extending `src/inventory` (deterministic and read-only):**
- **New manifest readers:** `composer.lock`/`package-lock.json` (resolved majors), `pyproject`/`requirements` (Django, Flask, FastAPI), `Gemfile` (Rails), `go.mod`, `Cargo.toml`, `.csproj` (ASP.NET).
- **Package manager** from lockfiles (`pnpm-lock`, `yarn.lock`, `package-lock`, `composer.lock`).
- **Database** signals:
  - `.env.example` keys `DB_CONNECTION`/`DATABASE_URL` scheme: the name of the setting only, never its value;
  - Compose service images (`mysql`, `postgres`, `redis`);
  - ORM packages.
- **Run hints:** `package.json` scripts (`dev`, `start`), `artisan`, a `docker compose` file. These are *candidates* for the runtime profile only, never executed.
- **Output** is `yallaflow inspect --json`, with each signal as `{area, value, version, evidence:[path], status:'detected'}`.
- **Authority:** detected and inferred values never become memory by themselves. They feed the baseline draft as `inferred` facts with evidence; approval makes them confirmed (existing rule).
- **Security:**
  - manifests are size-capped (already);
  - env **values** are never read into output; the existing secret redaction applies to anything persisted;
  - no symlink following (already).

## 6. Project Runner: safety and lifecycle (development services)
**Two different things, two places in the UI:**
- **(A) YallaFlow activity** is *Put on hold / Resume* on work items (4). It is project-level only as "no active work".
- **(B) Development services** are the *Development environment* card and runtime panel. They are never tied to work-item state.

**Runtime profile:** `.yallaflow/runtime.yaml`, committed so the team shares it.
- **What it lists:** services (`name`, `cwd`, `command` as an argv array, `env` names allowed from the env file, `ports`, `ready` check, and `depends_on`).
- **How it's filled:** pre-filled from detection as a **draft**. The user reviews every command in a diff-style screen and saves it. **Nothing runs until a profile entry is saved by a person.**
- **No shell:** commands that need one (pipes) are refused or shown with an explicit "runs through a shell" warning, which requires a second confirmation.
- **Run is a click on a saved entry.** The first run of a new or changed command shows the exact argv and the working directory again.

**Process ownership and termination:** this reuses the 1.3.0 agent process lifecycle.
- Each service gets **its own process group**. Its descendants are tracked on Linux, and its stdin is a pipe.
- **Stop:**
  - TERM the group, then KILL after the grace period;
  - verify nothing is left;
  - report survivors honestly.
- **Docker Compose:** Stop runs `docker compose stop` for the profile's project name. YallaFlow never runs `down -v`.
- **Ownership file:** `.yallaflow/local/runtime/<service>.json` holds pid, identity, start time and port (the same identity checks as the checkout lock). A service started by another console or a terminal is shown as **"running, not started here"**, with no Stop button unless the user takes ownership explicitly.
- **Console stop policy** (per service): "stop with the console" (default) or "keep running".
- **Ports:** declared ports are checked before start ("port 8000 in use by pid N"). Nothing binds beyond what the service itself does; YallaFlow adds no proxy.
- **Environment:**
  - env files are passed by name (`env_file: .env`);
  - variables are inherited from the console process minus a denylist (`*_API_KEY`, `*_TOKEN` …) unless listed;
  - values never appear in the UI or logs metadata.
- **Logs:**
  - a ring buffer of 2,000 lines per service, streamed to the page, with a download;
  - files in `.yallaflow/local/runtime/logs/` (git-ignored), rotated at 5 MB;
  - lines matching known secret patterns are redacted in the UI.
- **Restart:** manual Restart (Stop, then Run). An optional `restart: on-failure` with backoff, max 3. Health comes from the `ready` check (port open or HTTP 200 on localhost).
- **Never:**
  - inferred commands run without confirmation;
  - `sudo`;
  - writing outside the project;
  - starting services on console start;
  - running services for projects the user didn't open.

**Threat model:** the runner executes the user's own project code with the user's rights.
- **Safety comes from:** explicit confirmation of exact commands, a committed profile reviewed like code, and no remote trigger (the console is loopback-only with a token).
- **The risk to accept:** a malicious repository can ship a harmful `runtime.yaml`. So the first run on a checkout requires confirming the profile, as VS Code workspace trust does.

## 7. New Project Wizard
**Steps:**
1. Name and location.
2. Optional description of what you're building.
3. Stack: pick, or **"Suggest one"**, which asks your agent to recommend with reasons. YallaFlow ranks nothing itself.
4. Template.
5. Options (database, frontend, auth, tests).
6. **Preview:** folder tree outline, exact generator commands, files YallaFlow writes, network access needed.
7. **Create.**

**No second scaffolding engine:**
- **Templates are a catalog of official generators:**
  - `composer create-project laravel/laravel`;
  - `npm create vite@latest -- --template react-ts`;
  - `npx create-next-app@<pinned>`;
  - `django-admin startproject`;
  - `dotnet new webapi`;
  - `rails new`;
  - "Empty repository".
- **Catalog entries are data** (argv templates with option mappings and pinned major versions), shipped and versioned with YallaFlow and extendable in user config.
- **Each generator needs its toolchain installed:** the wizard detects missing tools and says so; it never installs them.

**Controlled and auditable creation:**
1. Create the folder, `git init` and `yallaflow init --type greenfield`.
2. Create work item 1, "Project setup", with the wizard answers as its request (a source file).
3. Run the generator: either (a) directly, as a confirmed command with live log, or (b) through the Agent Workspace (Codex in workspace-write executes the setup step with permission cards).
4. Record the output as the item's implementation, and run verification: the generated project's own test or build command.
5. Make the first commit only if the user asks.
6. The runtime profile draft is pre-filled from the template.

**Security:**
- generators download code from the internet: the preview states it, and nothing runs before **Create**;
- argv only, with versions pinned;
- the target folder must be empty or new;
- no credentials are asked for.

## 8. Prototype
`prototype.html` (open it in a browser) mocks, in the console's visual identity:
- the Project Overview with the stack chips and their statuses;
- onboarding review;
- the Flow board with a contextual menu and a blocked-move explanation;
- the runtime panel;
- the wizard preview.

It is static; no data is real.

## 9. Roadmap and release recommendation
**Honest scope assessment:** none of the three areas is a release blocker for the already accepted scopes of 1.2.0 (Visual Console) and 1.3.0 (Agent Workspace). Building them into those releases would mean new Core lifecycle states, a process runner and a generator catalog. That is weeks of work, with schema and compatibility impact, and it would invalidate the tested release candidates.

| Priority | Item | Size | Fits |
|---|---|---|---|
| **Essential now** | Nothing new. Ship 1.2.0/1.3.0 as tested. Document in the console's empty states that onboarding, editing and runtime are coming, and point to the agent. | – | 1.2.0/1.3.0 |
| **Small, could fit 1.3.0 (owner choice; each needs re-test)** | (a) **Make it active** on every item page whenever writes are on, not only with `--agents`: a route reusing the existing `activate` runner, about 1 day plus tests. (b) **Onboarding status** on the Projects page and the empty-project welcome: read-only, from `brief`, about 1–2 days. | S | 1.3.x (patch) preferable |
| **Next minor: 1.4.0 "Work management"** | Console write actions over **existing** Core ops: advance, reopen, request revise, requirements editor with impact form, answer question, finish. Board drag and drop that proposes moves Core decides, with blocked explanations. Project Overview (read-only) with `inspect --json` and extended stack detection. Onboarding entry point with the baseline review screen and human approval (owner decision on console approvals). | L (3–4 weeks) | 1.4.0 |
| **1.4.0 Core additions** | `hold`/`resume` and `close` (CLOSED ≠ DONE), with schema, snapshot fields and compatibility tests. | M (1–2 weeks) | 1.4.0 |
| **Next: 1.5.0 "Development runtime"** | `runtime.yaml` profile with review, process runner (groups, ownership, logs, ports, health), workspace-trust confirmation, Compose support. | L (3–4 weeks) | 1.5.0 |
| **1.5.0 or later** | New Project Wizard with the generator catalog and the agent-run setup item. | M–L | 1.5.0 |

**Tests each phase needs:**
- the Core transition matrix (every console action equals the CLI result, with no direct writes);
- frozen older CLI versions reading new workspaces;
- console route security (token, Origin, read-only refusal);
- runner process-lifecycle tests (survivors, ownership, ports, secrets never in logs);
- browser checks in three engines, both themes and both languages;
- detection fixtures per ecosystem.

**Backward compatibility:**
- new snapshot and work fields are additive;
- CLOSED and hold need older-CLI tolerance tests, since 1.1.x and 1.2.x must not misreport a CLOSED item as in progress, or must refuse clearly;
- `runtime.yaml` is optional, and older CLIs ignore it.

**Recommendation:**
- release 1.2.0 and 1.3.0 as tested (optionally with the two small items as 1.3.1);
- plan 1.4.0 (work management, overview, onboarding);
- plan 1.5.0 (runtime, wizard).

**Decisions for the owner:**
1. Should human gate approvals (baseline, review gates) be possible from the console?
2. Hold and close semantics and names.
3. Should `runtime.yaml` be committed (shared) or local?
4. Should the wizard's default execution path be direct generator commands or the agent?
