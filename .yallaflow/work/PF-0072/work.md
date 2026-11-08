# PF-0072 — Smart project run from Setup: the project's agent works out how the project really runs (including a Docker stack outside the repository, its database, and local domains such as *.localhost), proposes the services, asks the developer for each permission it needs (trust), then Start/Stop project runs them and Open goes to the real app URLs

## Raw Request

Smart project run from Setup: the project's agent works out how the project really runs (including a Docker stack outside the repository, its database, and local domains such as *.localhost), proposes the services, asks the developer for each permission it needs (trust), then Start/Stop project runs them and Open goes to the real app URLs

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** feature
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow feature --scope architectural`.
**Timestamp:** 2026-11-08T13:32:49.270Z
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

- Q-001 (owner): **Both.** Safe read-only discovery of the project and the relevant parent workspace first, then the selected agent analyses the full development setup. A runtime plan with evidence and confidence is presented; nothing executable is saved or started before the owner's explicit review and trust (SRC owner-direction file).
- Q-002 (owner): a service that runs from outside the project folder is allowed **only in the personal** `.yallaflow/local/runtime.yaml`, never in the shared profile.
- Spec feedback (owner, SRC-0051), all now in the specification:
  1. Review/Save, Trust and Start are three separate explicit steps; saving never authorizes execution.
  2. Shared infrastructure (MySQL, shared compose services) is detected and shown with its scope; it is never stopped or restarted automatically, and doing either needs explicit confirmation.
  3. Trust binds to the effective configuration, including the compose files and the project scripts it references where feasible; material changes end the trust; never trust a command name alone.
  4. Scan limits are visible: what lies outside the discovery scope is unresolved, never reported as absent.
  5. Keep all changes local: no push, tag, release or publish.
- Owner constraints: never execute discovered commands automatically, never read secrets, never stop services YallaFlow does not own. Experience: **Analyze Project → Review Runtime Setup → Start Project**.

## Discovery

Read-only, 2026-11-08.

- **Runtime today (1.4.0, PF-0069):**
  - `src/runtime/profile.js` merges the shared `.yallaflow/runtime.yaml` with the personal `.yallaflow/local/runtime.yaml` (a personal file can define its own services).
  - `resolveServiceCwd` refuses any working directory outside the repository.
  - `trust.js` binds trust to a definition hash (command, cwd, env names, ports…).
  - The supervisor starts only trusted services and stops only what it started (pid records under `.yallaflow/local/`). `runtime add … --local` and `--from-suggestion` exist.
  - `suggest.js` derives suggestions only from manifests inside the repository: Laravel, npm/pnpm/yarn dev|start, and Docker Compose files in the repository.
  - Open links are `http://127.0.0.1:<port><path>` only.
- **The real case (`~/YaSchools/portal`):**
  - Development runs on a Docker stack in the parent folder: `~/YaSchools/docker-compose.yml`, with `webserver` (Apache+PHP, ports 80/443→4991) and `mysql` (3306, linked).
  - The stack mounts `${DOCUMENT_ROOT-./}` at `/var/www/html`, so the project is `/var/www/html/portal`.
  - It is served through Apache vhosts in `~/YaSchools/docker/config/vhosts/*.conf`. 14 of them point into `/var/www/html/portal/…`, for example `yaschools.localhost`, `backend.yaschools.localhost` and `endpoints.yaschools.localhost`.
  - `docker/sample.env` names the settings. The compose `environment:` block holds database credentials, so values must never be copied.
  - The stack is shared by many apps in `~/YaSchools`.
  - At discovery time port 80 was held by another project's container (`mawhoob-app`), and the YaSchools containers did not exist. These are transient observations, not facts.
- **The agent already does the analysis:** in the real session, Claude Code (asked in the project chat) answered with the `*.localhost` URLs and offered to start the containers. The intelligence is available; what is missing is a structured, reviewable handoff and a safe place for its result.
- **Risk found:** running `docker compose up` for a stack that is already up attaches to it. Ctrl-C would then stop containers YallaFlow did not start. Start must detect a running stack and treat it as *running outside YallaFlow* instead of starting it.

## Architecture / Technical Decisions

Classify only relevant decisions as confirmed, proposed, unresolved, or not applicable.

## Design

Three steps on the Setup page's **Run the project** section, replacing today's suggestions-first layout.

1. **Analyze Project** (one button).
   - YallaFlow first runs a deterministic, read-only **workspace discovery**: the repository plus its parent folders up to the home folder, at most 3 levels.
   - It looks for compose files that mount or build the project, the services they define (image or build, ports, depends_on and links), web-server vhosts whose document root falls inside the project (Apache `ServerName`/`DocumentRoot`, nginx `server_name`/`root`, mapped through the compose bind mount), and the existing in-repository suggestions.
   - It also takes a read-only **runtime observation**: containers and listening ports, through `docker ps` and the OS socket list, never `.env`.
   - The result is a *draft runtime plan*, saved to `.yallaflow/local/runtime-plan.json` (git-ignored, 0600), with a confidence per item (`confirmed` = read from a file, `inferred`, `unresolved`) and its evidence.
   - If an agent is on for the project, the same click offers **Ask the agent to complete the plan**. The project chat receives a prepared request carrying the draft and a strict reply contract. The agent investigates with its own read-only tools and submits a revised plan through `yallaflow runtime plan propose --file <plan.json>`, which is validated: no secret values, environment *names* only, commands as argv, cwd rules. The plan is stored as the agent's proposal next to the scan; it never becomes executable.
2. **Review Runtime Setup, then save.**
   - Setup shows the plan as cards in start order: name, what it is (Docker stack, process), command, folder, ports, depends on, the app links (`http://<host>.localhost` or `127.0.0.1:<port>`), confidence, evidence, source (scan or agent), the conflicts (port busy and by whom, already running), and a **Shared** badge with its scope.
   - The scan coverage and the unresolved items close the list.
   - **Save selected** writes the ticked services to the profile (the personal file for anything outside the repository, Q-002). Saved services stay **untrusted**: saving never authorizes execution.
2b. **Trust** (a separate explicit step per service). It shows the *effective configuration*: the command, the resolved folder, environment names, ports, dependencies, and the inputs the trust is bound to (compose files, build Dockerfiles, package scripts), along with what is deliberately not covered. Trust records the hash of exactly that. Any material change in the fields or the inputs ends it.
3. **Start Project** (existing start-all, trusted services only).
   - It gains a pre-flight: a service whose stack or ports are already up is marked *running outside YallaFlow*. It is not started, and Stop never touches it.
   - A busy port held by something else is reported with its owner, and that service is skipped.
   - **Open** offers the plan's app links.

Shared services (a database, a compose stack serving other projects) are never stopped or restarted automatically; Stop Project leaves them up, and stopping one is its own confirmed action that lists who else may be affected.

Rejected: a scan-only approach, which can't understand vhosts, order, or databases (owner chose Both); letting the agent write `runtime.yaml` or trust directly (violates explicit review); running compose `config` or any discovered command during analysis (owner: never execute discovered commands).

## Specification

### Goal and Scope

**Goal.** Setup understands how an existing project really runs and gets it running in three steps: **Analyze Project → Review Runtime Setup → Start Project**. This covers a stack defined outside the repository (the YaSchools Docker stack), its database, startup order, ports and local domains. The developer reviews and trusts every executable piece.

**In scope:**
- read-only workspace discovery (repository and parent folders), with visible coverage and limits;
- shared-infrastructure detection and protection;
- trust bound to the effective configuration, including external compose inputs;
- read-only runtime observation;
- the runtime plan file and its validation;
- the agent hand-off and the `yallaflow runtime plan` commands;
- the Review UI;
- saving and trusting the selected services;
- personal services with a working directory outside the repository;
- pre-flight for already-running stacks and busy ports;
- app links to `*.localhost` hosts.

**Out of scope:**
- installing dependencies, database migrations or seeding;
- creating `.env` files;
- editing compose or vhost files;
- remote or production environments;
- `/etc/hosts` changes (`*.localhost` already resolves to the loopback address in browsers);
- starting anything automatically.

### Actors and Permissions

- **Developer.** Starts the analysis, reviews the plan, chooses and trusts services, starts and stops the project. Every executable step is theirs.
- **YallaFlow.** Reads files and observes runtime state read-only. It validates and stores plans, writes the profile only on the developer's Save, and starts only trusted services. It never runs a discovered command during analysis.
- **The selected agent** (Codex or Claude Code, from the project chat). Investigates and proposes a plan through `yallaflow runtime plan propose`. It cannot save services, trust them or start them. Its own tool permissions are governed by its permission mode, which the chat shows.
- **Read-only console.** Can view a saved plan; it cannot analyze, propose, save, trust, start or stop.

### Functional Requirements and Business Rules

1. **Workspace discovery** reads the repository and its ancestors, up to the developer's home folder and at most 3 levels up, never above home and never `/`.
   - From each folder it reads only `docker-compose*.y*ml` and `compose*.y*ml` files, plus vhost configs under folders those compose files bind-mount as Apache or nginx configuration. Each file is capped at 256 KB, with at most 200 files per scan.
   - It parses compose `services` (image/build, ports, depends_on/links, volumes, container_name). A compose file is **related** to the project when a bind mount or build context resolves to the project folder or one of its ancestors that contains it.
   - Vhosts are related when their document root, mapped through the bind mount, falls inside the project. Each gives a host name and the module path.
   - It never reads `.env` (or any `env_file`), and it records compose `environment:` keys as **names only**.
   - **Coverage is part of the result.** The plan lists what was scanned and what was not, with the reason: outside the allowed scope (above home, more than 3 levels up, a path the compose file references outside the scanned folders), too large, unreadable, the file limit was reached, or a symbolic link escaping the scope. A service, vhost or dependency referenced but not inspectable is **unresolved** with that reason, never reported as absent. "Nothing found" is always phrased as "nothing found within: <scanned folders>".
2. **Runtime observation** (read-only, transient, never saved as project fact): running containers (name, image, compose project, published ports) via `docker ps --format json`, and listening TCP ports with their owner when known. If Docker is unavailable, it says so and continues.
3. **Plan**: `.yallaflow/local/runtime-plan.json` (git-ignored, 0600, schema v1).
   - It holds `analyzedAt`, `source` (scan|agent) and `services[]`.
   - Each service has: id, name, kind (`docker-compose` | `process`), command argv, cwd (repository-relative, or absolute for an outside-repository folder), env names, ports, dependsOn, ready, open links (`{label, url}`), confidence (`confirmed` | `inferred` | `unresolved`), evidence (file paths, or `runtime:` observations), and notes.
   - It also holds `unresolved[]` questions.
   - The scan plan and the latest agent plan are kept side by side, and the agent's plan is shown first when present.
4. **Ask the agent**: available when agents are on for the project. It opens the project chat with a prepared, visible message (not auto-sent unless the developer presses Send). The message carries the draft plan and the contract:
   - read-only investigation;
   - no secrets;
   - submit with `yallaflow runtime plan propose --file`;
   - list unresolved items.
5. **`yallaflow runtime plan show|propose --file F|discard [--json]`**. `propose` validates and stores; it never writes the profile or trust. It rejects:
   - environment values (names only);
   - secret-looking strings anywhere (the existing redaction patterns);
   - shell strings (argv required);
   - cwd outside home or through a symbolic-link escape;
   - open URLs other than `http(s)://127.0.0.1|localhost|<name>.localhost[:port]/…`;
   - ids or dependsOn that do not resolve.
6. **Review** (step 2a): every plan service shows its command exactly as it would run, cwd, ports, dependsOn, links, confidence, evidence, source, and pre-flight conflicts. Unresolved items are listed. The developer can untick services and change the target profile for in-repository services. **Save selected** is the only path to the profile.
7. **Save** (step 2b) writes definitions only; it **never trusts and never authorizes execution**. Saved services are *untrusted* until step 3.
   - A service with an outside-repository cwd goes only to `.yallaflow/local/runtime.yaml` (Q-002).
   - An in-repository service goes to the personal file by default, or the shared one when chosen.
   - An id already in the profile is updated only after the developer confirms the change, and the new definition is untrusted until trusted again.
7a. **Trust** (step 3, separate, per service, explicit) shows the **effective configuration** before the developer confirms:
   - the exact command;
   - the resolved folder;
   - environment names;
   - ports, readiness, stop behaviour and dependencies;
   - **the list of inputs the trust covers**, each with its path.

   Trust is recorded against the definition hash of exactly what was shown (`--expect`); if anything changed in between, nothing is trusted. Trusting several at once is allowed only as an explicit "Trust these N" that lists every one.
7b. **Trust binding.** The definition hash covers the material fields (as today) plus the **execution inputs**. These are the content hashes of the compose files the command uses: the `-f` files, else the default compose and override files in its folder. They also include the Dockerfiles of the build contexts those compose files declare, the scripts section of the `package.json`/`composer.json` that a package-manager command runs, and the shell scripts it calls, as today.
   - For an outside-repository service the same inputs are hashed inside its folder, bounded to the home folder, with no symbolic-link escape and 2 MB per file.
   - A changed, added or removed input ends the trust, so it is never bound to the command name alone.
   - Files that are deliberately not covered (env files, which hold secrets and are never read; images pulled from a registry; files a Dockerfile copies) are listed as **not covered** on the trust screen.
8. **Outside-repository cwd** is allowed only for services defined in the personal file. It must be absolute, its real path must be inside the home folder, it must be a directory, and it is re-checked at start. Shared definitions keep the repository-only rule.
9. **Start** (step 4) runs only services that are trusted now. **Pre-flight at Start Project**:
   - A `docker-compose` service whose compose project already has running containers is shown as *running outside YallaFlow*. It is not started; it counts as ready for dependants, and Stop never touches it.
   - A declared port held by another process or container is shown with that owner. That service and its dependants are not started, and nothing is stopped or killed.
10. **Shared infrastructure.** A service is marked **shared** when any of these holds:
    - its compose file lives outside the project;
    - its bind mounts expose folders that hold other projects;
    - its vhosts serve folders outside the project;
    - it is a data or infrastructure service (a database such as MySQL, MariaDB or PostgreSQL; Redis, a message broker, or a mail catcher; recognised by image name and evidence, with a confidence level);
    - other compose services outside the project depend on it.

    Review and Start show its **scope**: the other projects, folders and domains it serves, as far as the scan can tell, and "may serve others outside the scanned scope" when coverage is partial.
    - Shared services are **never stopped or restarted automatically**. Stop Project leaves them running even when YallaFlow started them.
    - Stopping or restarting one is a separate action that lists the affected scope and needs an explicit confirmation. The existing ownership rule still applies: only a process YallaFlow started can be stopped at all.
11. **Open**: running services (YallaFlow's or outside) show their plan links. Links are only loopback or `*.localhost`. Nothing opens automatically.
12. **Refresh**: Analyze again re-scans and shows what changed since the last plan.

### Workflows and Lifecycle

Analyze (scan → draft, with coverage) → optional Ask the agent → agent proposes → **Review** → **Save selected** (untrusted) → **Trust** (each service's effective configuration, explicit) → **Start Project** (pre-flight → start trusted services in order → ready) → Open → **Stop Project**: only YallaFlow-started, non-shared services, in reverse order. Shared services stop or restart only through their own confirmed action.

A changed definition loses its trust, as today. Discarding a plan deletes only the plan file.

### Data and Integrations

- **New files:** `.yallaflow/local/runtime-plan.json` (personal).
- **Existing files:** `.yallaflow/local/runtime.yaml` (personal services, now allowing an absolute cwd), the trust store, and the runtime state.
- **External read-only commands run by YallaFlow itself:** `docker ps --format json`, and the OS socket listing (`ss -ltnp` on Linux, `lsof -iTCP -sTCP:LISTEN` on macOS, best effort).
- **Agent integration:** the existing project chat (PF-0067); no new agent channel.

### Validation and Error Behavior

- An invalid plan from the agent is refused with every problem listed, so the agent can fix and resubmit. The previous plan stays.
- Discovery limits are reported (files skipped, too large, not readable).
- A missing Docker shows "Docker is not available: running containers could not be checked."
- When a pre-flight conflict occurs, the conflicting service is explained and skipped, and start stops at the first real failure as today.

### Security and Privacy

- **Secrets:** no secret is ever read or stored.
  - `.env` files are never opened.
  - Compose environment values are never kept.
  - Plans with values or secret-looking strings are refused.
  - The prepared agent message repeats the rule.
- **Execution:**
  - No discovered command runs during analysis or review.
  - The only processes YallaFlow runs while analyzing are its own fixed read-only probes.
  - Execution needs three separate explicit steps by the developer: Save (untrusted), then Trust (the effective configuration, hash-bound), then Start.
  - Trust covers the command, its configuration and its referenced inputs. Any material change ends it.
- **Ownership:**
  - Stop affects only processes YallaFlow started.
  - A stack running outside YallaFlow is never started, attached to or stopped.
  - Shared services are never stopped or restarted automatically. Doing either needs an explicit confirmation that shows who else may be affected.
- **Paths:** reading is bounded to the repository and its ancestors inside home, with no symbolic-link escape. An outside-repository cwd is personal-only and inside home.
- **Links:** loopback or `*.localhost` only.
- **Agent:** it can only propose. Its tool permissions are its own, and the chat shows its mode. YallaFlow cannot stop an auto-approving agent from running commands on its own initiative, and the prepared message asks it not to (limitation).
- **Consoles:** a read-only console only views; all new routes are behind the console token, Origin and JSON checks.

### UI / Screens

The Setup → **Run the project** section has three steps in one card:

- **1. Analyze.**
  - Button: Analyze project. It shows the last analysis time and what changed.
  - Button: Ask the agent to complete the plan.
- **2. Review and save.** Service cards in start order, each with:
  - checkbox, name, kind, confidence chip;
  - the command (LTR, exact);
  - folder, ports, depends on, links;
  - the evidence list folded;
  - a conflicts line.

  Each card also shows a **Shared** badge with its scope. The list ends with the unresolved items and the scan coverage (scanned / not scanned, and why). Button: **Save selected**.
- **3. Trust.** Each saved, untrusted service has **Review and trust**, which opens the effective configuration and the inputs covered and not covered, then **Trust this service**. A changed service shows "changed since you trusted it" with what changed (inputs or fields).
- **4. Start project / Stop project.** Each service shows its state: running (YallaFlow), running outside YallaFlow, stopped, or conflict. Open links follow. Shared services carry **Stop shared service…** / **Restart shared service…**, which ask for confirmation and list the affected scope.

The old free suggestions list is folded under the plan as "Other suggestions". Arabic-first, English, RTL/LTR, 390 px without horizontal scroll, light and dark.

### Acceptance Criteria

Recorded as AC-### with `yallaflow requirement record`; see requirements.yaml.

### Unresolved Items

None blocking. Out of scope until asked: database migrations/seeding and dependency installs.

## Implementation Plan

Within the existing Runtime Core (`src/runtime/*`, `yallaflow runtime …`) and the Console (`src/console/*`, `resources/console/*`). There is no separate execution engine: the console calls Core through the existing runner, and every start and stop goes through `supervisor.js`.

**Technical decisions (for the plan gate):**
- **D1. No new dependency.**
  - Compose files are read by a bounded, conservative reader for the subset needed: `services` keys, `image`, `build` (string or `context`/`dockerfile`), `ports`, `depends_on` (list or map), `links`, `volumes` (short syntax), `container_name`, `environment` keys and `env_file` paths (names only, never opened).
  - Anything it cannot read with certainty (anchors, merges, long-syntax volumes, interpolation it cannot resolve) is recorded as **unresolved** with the reason, never guessed.
  - `${VAR-default}` uses the default only. Values from `.env` are never read, so such a path is marked "depends on an environment value".
- **D2. Concurrent changes.**
  - Trust is checked under the service lock immediately before spawning (as today).
  - After spawning, the same hash is recomputed at the end of the settle window. If it differs, the process group YallaFlow just started is stopped and the start fails with "configuration changed during start".
  - Trust (`--expect`) and Save use the same per-project busy guard as start-all, so a review cannot interleave with them.
- **D3. Shared marking is stored in the definition.** `shared: { scope: [...] }` is a field in the definition, part of the hash. Removing it is a reviewed change that needs trust again. Status also re-derives database images as shared.

**Owner safety requirements at plan approval (2026-11-08):**
- **S1. Fail closed.** Unresolved configuration that materially affects execution blocks Trust and Start until it is reviewed and resolved. This covers a compose construct the reader cannot read, an env-dependent path, or a referenced file that is missing or outside the scope. `runtime review` lists these items as *blocking*, and `trust` and `start` refuse while any exist.
- **S2. Rollback on a change during start.** Only process groups positively owned by YallaFlow are terminated, meaning the run record, pid, start time and group verified. External or shared infrastructure is never stopped as a rollback side effect. A shared service started in the same run is left running and reported.
- **S3. Shared classification at execution time.** Shared status is re-derived from current evidence (images, compose location, mounts, vhosts, dependants, observed containers) every time a stop or restart is decided. The stored marker can only *add* protection. Its absence, or a stored "not shared", never makes a service safe to stop when the evidence says it is shared.

### Steps

1. **Profile: outside-repository working directories (Q-002).**
   - In `src/runtime/profile.js`, `validateService` accepts an absolute `cwd` only where `local`. `resolveServiceCwd` takes the real path, requires a directory inside `os.homedir()` with no symbolic-link escape, and keeps the repository rule for shared services.
   - New optional fields: `shared` (`{ scope: string[] }`, capped) and `links` (`[{label, url}]`, loopback or `*.localhost` only, validated as for `open`).
   - Schema: `resources/schemas/runtime-1.schema.json`.
2. **Trust inputs bound to the effective configuration.**
   - In `src/runtime/inputs.js`, the base is the repository, or the service's resolved outside folder within home.
   - It adds the compose files named by `-f` and `--file` (else the defaults plus overrides) and the build-context Dockerfiles those compose files declare (through the D1 reader).
   - It returns `{ hashes, covered[], notCovered[] }`. `notCovered` lists env files, registry images, and files a Dockerfile copies. `definitionHash` uses `hashes`, and a missing or unsafe input is an error, as today.
3. **Workspace discovery and observation.** New `src/runtime/discover.js`:
   - It scans the repository and up to 3 ancestors within home, reading compose files (D1) and, from compose bind mounts, Apache/nginx vhost files (`ServerName`/`ServerAlias`/`DocumentRoot`, `server_name`/`root`).
   - It maps container paths to host paths through the bind mounts, decides which compose files and vhosts relate to the project, and builds services with ports, depends_on/links, domains and evidence.
   - **Coverage:** scanned folders; skipped items with a reason; and references outside the scope, which are recorded as unresolved.
   - **Shared detection:** database and infrastructure images, a compose file outside the project, mounts or vhosts serving other folders, and outside dependants, each with its scope.
   - **Observation**, read-only, through fixed probes: `docker ps --format {{json .}}` (name, compose project label, ports) and `ss -ltnH` with its owner where allowed, or `lsof` on macOS. Each probe has a timeout, and its absence is reported.
   - Limits: 256 KB per file, 200 files.
4. **Runtime plan.** New `src/runtime/plan.js`:
   - The plan lives in `.yallaflow/local/runtime-plan.json` (0600, git-ignored, safe writes), holding `{ schemaVersion, scan, agent }`.
   - `validatePlan` rejects environment values, secret-looking strings (`containsSecret`/`isSecretKey`), shell strings, a bad cwd, bad links, unknown ids and dependency cycles.
   - CLI in `src/commands/runtime.js` and `runtime-usage.js`:
     - `yallaflow runtime analyze [--json]`;
     - `runtime plan show [--json]`;
     - `runtime plan propose --file F`;
     - `runtime plan discard [--agent|--scan]`;
     - `runtime plan save <id>... [--shared-profile]`, which writes untrusted definitions; an existing id needs `--replace`, and outside cwd always goes to the personal file;
     - `runtime review <id> [--json]`, giving the effective configuration, the definition hash, and the inputs covered and not covered.
5. **Supervisor.** In `src/runtime/supervisor.js`:
   - **Pre-flight:** a docker-compose service whose compose project, or whose named containers, are already running is `running-outside`. It is not started and counts as ready for dependants.
   - **A busy port** is reported with its owner (container or process) from the observation. That service and its dependants are skipped, and nothing is signalled.
   - **D2:** the post-spawn re-hash.
   - **`stopAllServices` skips shared services** and reports them as "left running (shared)".
   - **`stopService`/`restartService` on a shared service** require `{ confirmShared: true }` (CLI `--confirm-shared`), listing the scope otherwise. They are still limited to processes YallaFlow started.
   - Status gains `shared`, `runningOutside`, `links`, and the trust reason (inputs vs fields changed).
6. **Console server.** In `src/console/server.js` and `src/console/runtime.js`, behind the existing WRITE_ROUTE token, Origin and JSON checks, refused read-only, under the per-project busy guard:
   - POST `runtime/analyze`;
   - GET `runtime/plan`;
   - POST `runtime/plan/save` (`{ids, replace}`);
   - GET `runtime/<id>/review`;
   - POST `runtime/<id>/trust` (existing, with `expect`);
   - POST `runtime/<id>/stop|restart` with `confirmShared`.

   The agent's proposal arrives through the CLI only (`runtime plan propose`), which the agent runs in its own session.
7. **Console UI.** In `resources/console/app.js` and `app.css`, the Run section becomes four steps:
   - **Analyze:** the time, what changed, coverage, and *Ask the agent to complete the plan*, which prepares the project-chat draft with the plan and the contract and does not send it.
   - **Review and save:** cards with the command, folder, ports, depends on, links, confidence, evidence (folded), source, conflicts, a Shared badge and scope; then unresolved items and coverage; then *Save selected*.
   - **Trust:** per saved service, *Review and trust* opens the effective configuration and the inputs covered and not covered, then *Trust this service* (expect = the hash shown). "Changed since you trusted it" shows what changed.
   - **Start/Stop:** states (YallaFlow, running outside, stopped, conflict); Open links; *Stop/Restart shared service…* with a confirmation that lists the scope.
   - Old suggestions are folded under "Other suggestions". Arabic/English, RTL, 390 px, dark mode.
8. **Agent hand-off text:** a fixed bilingual message template in `app.js` covering the contract (read-only investigation, no secrets or values, propose with `yallaflow runtime plan propose --file`, list unresolved items).
9. **Docs:** `docs/runtime.md` (analyze, plan, save, review and trust, shared, outside cwd, coverage, limits), `docs/console.md` (the Setup run steps), `docs/cli.md`, and the CHANGELOG under [Unreleased].
10. **Tests.** New `test/runtime-plan.test.js`, plus additions to `test/project-setup.test.js` and the runtime supervisor tests. A fake `docker`/`ss` on PATH plays observations; supervisor cases are skipped where process groups are not supported, as today. Fixtures are a YaSchools-like workspace (a parent compose with webserver+mysql, bind mount `./:/var/www/html`, a vhosts folder with project and other-project vhosts, a `sample.env`, and a `.env` with a sentinel value).

    **Owner-required regressions:**
    - **R1, input changes block execution:** after trust, editing the used compose file, an override, a build Dockerfile, the package `scripts` or a called shell script turns the service untrusted ("inputs changed") and `start` refuses. Covered inside the repository and in an outside-repository folder.
    - **R2, Stop Project never stops shared infrastructure:** a YallaFlow-started shared service (mysql image / outside compose) keeps running after `stop --all` and the console Stop Project. `stop <id>` without `--confirm-shared` refuses and lists the scope; with it, it stops (owned process only).
    - **R3, unowned running services are never terminated:**
      - a compose project already running (fake docker) is `running-outside`, not started, and survives start-all, stop-all and `stop <id>`;
      - a foreign listener on a declared port is reported with its owner and not signalled (its pid is still alive afterwards);
      - an unmanaged record stays as today.
    - **R4, saving grants no execution:** `plan save` and the console save write definitions whose trust is `never`; `start`, `start --all` and the console Start refuse them; nothing is spawned (no log, no run record).
    - **R5, unresolved is not presented as confirmed:**
      - a compose reference outside the scope, a vhost folder outside the scope, an unreadable file, an unsupported compose construct and an env-dependent path each come out `unresolved` with the reason, never `confirmed`;
      - an agent plan claiming `confirmed` without evidence is refused;
      - the UI renders unresolved items under "Unresolved" with no confirmed chip;
      - an empty scan reads "nothing found within: …".
    - **R6, concurrent changes cannot bypass trust:**
      - a file changed between review and trust makes `trust --expect` refuse;
      - a file changed between the start check and the end of the settle window stops the just-started group and fails the start;
      - simultaneous console trust and start get 409 from the busy guard;
      - a profile edited between save and start is untrusted.

    **Plus per acceptance criterion:**
    - discovery and coverage on the fixture, with no `.env` read (sentinel never appears in any output or file);
    - observation without docker;
    - plan validation refusals;
    - the agent draft is prepared, not sent;
    - Review, Trust and Start UI slices (vm harness);
    - outside cwd personal-only and inside home, with a symbolic-link escape refused;
    - links loopback / `*.localhost` only;
    - read-only console refusals.
11. **Verification:**
    - `npm test` (full);
    - a browser check of the four steps in Arabic and English at 390/1440 px;
    - an **analysis-only** run on `~/YaSchools/portal` (read-only: Analyze plus the agent proposal, then review). Starting the real stack happens only if the owner asks at that point, because port 80 is shared;
    - a security review on an isolated copy;
    - delivery convergence for AC-001…AC-011.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0049
**Type:** file
**Name:** Screenshot from 2026-11-08 15-06-48.png

Raw source preserved in: `.yallaflow/sources/SRC-0049/Screenshot from 2026-11-08 15-06-48.png`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0050
**Type:** file
**Name:** pf0072-owner-direction.md

Raw source preserved in: `.yallaflow/sources/SRC-0050/pf0072-owner-direction.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0051
**Type:** file
**Name:** pf0072-owner-spec-feedback.md

Raw source preserved in: `.yallaflow/sources/SRC-0051/pf0072-owner-spec-feedback.md`. Read it directly; it is not duplicated here.
