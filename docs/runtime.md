# Development runtime (1.4.0)

YallaFlow can start, stop, restart and show the logs of your project's local development services, such as `php artisan serve`, `npm run dev` or `docker compose up`, from the CLI and the console's **Setup** tab. It only runs commands you reviewed and trusted, and it only stops processes it started and can still positively identify.

Supported on Linux and macOS. On Windows the commands refuse with a clear message.

## Analyze, review, trust, start (PF-0072)

For an existing project, Setup works out how the project really runs in four steps: **Analyze Project → Review and save → Trust → Start Project**. Nothing runs before you trust it, and saving never trusts.

```bash
yallaflow runtime analyze                    # read-only scan; stores the scan plan
yallaflow runtime plan show                  # the scan and the agent's proposal, side by side
yallaflow runtime plan save <id>...          # untrusted definitions (a person only: a terminal or the console)
yallaflow runtime review <id>                # what trust would cover, and anything blocking
yallaflow runtime trust <id>                 # a separate, explicit step
yallaflow runtime start --all
```

**1. Analyze (read-only).**
- **What is read:**
  - the repository and up to **3 parent folders inside your home folder**, at the top level of each, for Compose files that mount or build the project (`./:/var/www/html` holding the project, a build context in it);
  - the web-server vhost folders those Compose files mount (Apache `ServerName`/`DocumentRoot`, nginx `server_name`/`root`), to learn the project's local domains. Each document root is mapped through the bind mount.
- **What is observed:** `docker ps` and the system's list of listening ports, read-only and transient.
- **What is never done:** `.env` is never opened (only its existence is noted), environment values are never kept, and no discovered command runs.
- **The scan plan** goes to `.yallaflow/local/runtime-plan.json` (git-ignored, 0600). Every item has a **confidence** (`confirmed` read from a file, `inferred`, `unresolved`) and its **evidence**.
- **Coverage is part of the result.** The plan lists:
  - the scanned folders;
  - what was not scanned (above home, past 3 levels, too large, unreadable, a link escaping the scope, the file limit).

  Anything referenced but not inspectable is **unresolved**, never reported as absent. An empty result reads "Nothing found within: …".
- **Ask the agent to complete the plan** (console, agents on) prepares a request in the project chat; you press Send. The agent investigates read-only and submits `yallaflow runtime plan propose --file <plan.json>`. The proposal is validated, and every problem is listed:
  - environment names only;
  - nothing secret-looking;
  - argv, not shell strings;
  - folders inside the repository, or inside home through no escaping link;
  - links on `127.0.0.1`, `localhost` or `*.localhost`;
  - dependencies that resolve, with no cycle;
  - "confirmed" needs evidence.

  It is stored beside the scan, and **an agent can only propose**: `plan save` and `trust` refuse a non-interactive caller.

**2. Review and save.**
- Each plan service shows its command, folder, ports, dependencies, links, confidence, evidence, conflicts (a busy port and its owner, a stack already running) and **Shared** scope.
- **Save selected** writes the ticked services as **untrusted** definitions:
  - a folder outside the repository goes to the personal `.yallaflow/local/runtime.yaml` only;
  - an id already in the profile is replaced only after you confirm.

**3. Trust** (per service). `runtime review <id>`, or **Review and trust** in Setup, shows the effective configuration:
- command, resolved folder, environment names, ports, readiness, stop behaviour and dependencies;
- the **files the trust is bound to**;
- what is **not covered** (env files, registry images, files a Dockerfile copies);
- anything **blocking**.

Trust records the hash of exactly that, and a change in between is refused.

**4. Start project** starts trusted services in dependency order:
- **A stack already running outside YallaFlow** (its Compose project or container names are up) is marked *running outside YallaFlow*. It is **not started or attached to**, counts as ready for dependants, and is never stopped.
- **A declared port held by something else** is reported with its owner (a container or a process). That service and its dependants are skipped, and nothing is killed.

### Shared infrastructure

A service is **shared** when any of these holds:
- its Compose file is outside the project;
- it mounts a folder that holds other projects;
- its web server serves sites outside the project;
- it is a database or infrastructure service (MySQL, MariaDB, PostgreSQL, Redis and the like);
- other services depend on it.

This is judged **from the evidence on disk every time a stop or restart is decided**. The `shared` marker saved with the definition only adds protection: removing it never makes a service safe to stop, and evidence that cannot be verified counts as shared.

- **Stop project leaves shared services running**, even ones YallaFlow started.
- **Stopping or restarting one** needs an explicit confirmation that lists who else may be affected: `runtime stop <id> --confirm-shared`, or ticking «I understand other projects may be affected» in Setup. Only a process YallaFlow started can be stopped at all.

### Fail closed

YallaFlow reads Compose files with a small, conservative reader (no extra dependency). Anything it cannot read with certainty that affects what runs **blocks trust and start until you resolve it** (`runtime review` lists it):
- anchors, aliases, merge keys, tags, flow mappings, several documents;
- `include`, `extends`;
- a build folder from a variable an `.env` could change;
- a remote build;
- extra build contexts;
- a missing Dockerfile.

**`.env` and Compose settings.** Compose reads `.env` (and `--env-file` files) for variable values, the project name and `COMPOSE_FILE`. Their content holds secrets and is never read, so trust is bound to their file metadata (size, modification time, inode): any edit ends the trust. `COMPOSE_*` and `DOCKER_*` settings a service passes by name are bound to a digest of their value. A Compose service is not started when `docker ps` cannot be read, because YallaFlow could not rule out attaching to a stack someone else started.

Unknown keys, at the top level or in a service, and escaped keys also block, so a key cannot hide an `include`, `extends` or `build`. A Compose file in a parent folder that cannot be read with certainty is reported as unresolved and blocking, never as "nothing found". Override files (`compose.override.yaml`) count toward what runs and whether it is shared.

**A change during start.** If the trusted configuration changes while a service is starting, YallaFlow stops **only the process group it has just started and can positively identify**. A shared service is left running and reported, and nothing else is ever touched.

## The profile

Services are defined in `.yallaflow/runtime.yaml`. The file is shared and committed, and it is secret-free:

```bash
yallaflow runtime suggest                       # candidates from repository files (never run)
yallaflow runtime add --from-suggestion laravel
yallaflow runtime add web --cwd frontend --port 5173 --ready-port 5173 --env VITE_API_URL -- npm run dev
```

A service has:
- an argv command (no shell, ever)
- a repository-relative folder. It must resolve inside the repository, and a symlink that leads outside is refused at start. Only in the personal `.yallaflow/local/runtime.yaml`, a service may use an **absolute folder inside your home folder** (for example a Docker stack in a parent folder); its real path is checked at start.
- environment variable **names** only. Values come from your environment when the service starts and are never stored.
- ports
- an optional readiness check, `--ready-port N` or `--ready-log TEXT`
- an optional stop signal and timeouts
- optional `links` (`[{ "label", "url" }]` on `127.0.0.1`, `localhost` or `*.localhost`): what Open offers while it runs
- an optional `shared` marker (`{ "scope": [...] }`), part of the reviewed definition

Anything that looks like a secret is refused, and the value is never echoed.

**Personal overrides** go in the git-ignored `.yallaflow/local/runtime.yaml` (`runtime add … --local`). An override changes only the fields you give it, and the console marks overridden fields.

**Suggestions** come from repository evidence: Laravel `artisan`, `package.json` `dev`/`start` scripts (with the package manager from the lockfile), and Compose files. A suggestion never runs. You add it, review it, and trust it.

## Trust

```bash
yallaflow runtime trust web
```

- **First start.** A service never starts until you trust it in this checkout.
- **Where trust lives.** Trust is personal. It is kept in your user config folder (`$XDG_CONFIG_HOME/yallaflow/runtime/<checkout>/`, mode 0700), **outside the repository**, so a process or a repository that can only write the checkout cannot plant trust. Run records and per-service locks live there too.
- **What trust is bound to.** The effective command, folder, environment names, ports, readiness, dependencies and stop settings of this checkout, plus hashes of package.json/composer.json scripts, directly invoked shell scripts and Compose files. The first use of this stronger fingerprint requires renewing older trust records.
- **When to trust again.** Any change to any of these, including one pulled from a teammate, needs trust again.
- **A human decision.** On the command line, `runtime trust` shows the definition and asks you to type the service id in a terminal; a script or an agent's tool call is refused. This prevents accidental trust by automation, not a process that controls your whole user account.
- **In the console.** You tick «I reviewed the command and files above, and I trust this service» after reviewing the exact configuration, and the request carries the definition you saw: if anything changed meanwhile, nothing is trusted. The console trusts in its own process (PF-0072). No environment variable lets a script or an agent use the console's path, and on the command line `runtime trust` (with or without `--expect <hash>`) always needs a person at a terminal. `runtime plan save` follows the same rule.
- **Files covered.** Script sections in package.json and composer.json in the service folder and repository ancestors; default Compose and override files in those folders; explicitly selected Compose `-f`/`--file` files, project directories and named COMPOSE_FILE inputs; **the Dockerfiles of the build contexts those Compose files declare** (PF-0072); local shell scripts invoked directly or through a shell interpreter. For a personal service with a folder outside the repository, the same files are covered inside that folder. Standard package-manager directory options are included. Unsafe links, non-regular files and unreadable inputs are refused. Only hashes are stored, never script contents or environment values.
- **What trust does not cover.** Application code such as `node server.js` is deliberately excluded: editing server.js keeps trust. This is not a transitive dependency audit: binaries in node_modules, scripts sourced or invoked indirectly, inline shell dependencies, Compose include/extends targets and environment values still need ordinary code review. Configure monorepo services with an explicit cwd or directory option; workspace selectors and arbitrary wrappers are not interpreted.
- **Dependencies.** Starting a service checks trust for it and all its dependencies before anything starts.
- **Review text.** Commands, names and folders containing control or bidirectional-override characters are refused, so the reviewed text is what runs.

## Start, stop, restart, status, logs

```bash
yallaflow runtime status            # stopped · starting · running · failed · unknown
yallaflow runtime start web
yallaflow runtime start --all        # Start project: every trusted service, dependencies first
yallaflow runtime logs web --lines 100
yallaflow runtime restart web
yallaflow runtime stop web          # or: yallaflow runtime stop --all
```

- **Environment.** A service gets a minimal base environment (`PATH`, `HOME`, `LANG`, `LC_ALL`, `TERM`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `TZ`) plus the variables its profile names. Other credentials, tokens and API keys in your shell are **not** passed on.
- **Start.**
  - A start is refused if a configured port is already in use. That process is reported and never touched.
  - Dependencies (`--depends-on`) start first.
  - The command waits for readiness, and an immediate crash is reported with the last log lines.
- **Start project** (`runtime start --all`, or **Start project** on the console's Setup page).
  - It starts every service whose whole dependency chain is trusted, in dependency order, one at a time, waiting for each to be ready.
  - A service with an untrusted or changed link in its chain is not started. It is listed with what to review.
  - The first failure stops the sequence, and services already running are left as they are.
  - **Stop project** (`runtime stop --all`) stops only services YallaFlow started, in reverse order.
- **Open.** A running service with a port shows **Open** on the Setup page. It links to `http://127.0.0.1:<port>/`, or to the path set in the service's optional `open` field.
  - `open` is a path on the service's own port, starting with a single `/` (for example `"open": "/admin"`), never a URL.
  - Nothing opens by itself, and changing `open` does not require trusting the service again.
- **Lifetime.** Services keep running after the console or the browser closes. Nothing starts when you open a project or the console.
- **State.** It is recomputed from the live process on every read:
  - **failed**: it ended without a stop from YallaFlow.
  - **unknown**: YallaFlow cannot establish that the process is the one it started, for example after the PID was reused or the checkout moved. Such a process is reported as unmanaged and is **never** signalled.
- **Stop.**
  - Sends the configured signal (Ctrl-C for Compose, which stops those containers) to the service's own process group.
  - Waits for the timeout, then forces the stop while the identity still matches.
  - Anything that survives is reported, never claimed as stopped.
  - Nothing is ever found or killed by port or by name.
- **Concurrency.** Starts and stops of one service are serialized: five simultaneous starts start one process.
- **Ownership.** A process counts as YallaFlow's only while its pid, start time and its own process group match the run record kept in your user config folder.
- **Logs.**
  - Written to `.yallaflow/local/runtime/logs/` (git-ignored) and kept across console restarts. A log over about 5 MB is rotated to one older copy when the service next starts; while it runs, the log grows.
  - Log files that are symbolic or hard links are refused, and showing logs never writes, truncates or rotates anything.
  - Recognizable secrets are redacted when the log is shown. This is best effort, since an arbitrary program can print secrets in forms no pattern recognizes.

## Console

The **Setup** tab runs the steps above. Asking the agent is offered first (it analyzes and proposes); Analyze is the quick fallback. Once services are saved, the page leads with the run control: the overall state, **Start project** / **Stop project**, Open links, and a compact row per service (state, trust, ports; Review and trust, or Start, Restart and Stop; Logs; the definition on demand). The plan, suggestions, add form, stack and agents fold into a Configuration section beneath. A proposal that arrives while the page waits for it is preselected (new, unblocked services only); selecting saves nothing. [Screens →](tour.md#part-3--set-the-project-up-once-then-just-press-start)
- It re-reads state every few seconds while open.
- The routes are fixed (`POST /api/p/<project>/runtime/<service>/(trust|start|stop|restart)`) with the console's token, Origin, JSON and size checks. The request names a service, and the command always comes from the reviewed profile.
- PF-0072 routes:
  - `POST runtime/analyze` and `POST runtime/plan/save` (plan service ids only);
  - `GET runtime/plan` and `GET runtime/<service>/review`;
  - `stop` and `restart` accept `{ "confirmShared": "<service id>" }` for a shared service.

  Analyze, Save, Trust, Start and Stop run one at a time per project (409 `RUNTIME_BUSY`), so a review cannot be overtaken by a concurrent change from the console.
- A `--read-only` console shows status, the plan and logs only.
