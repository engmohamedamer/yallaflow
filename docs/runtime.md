# Development runtime (1.4.0)

YallaFlow can start, stop, restart and show the logs of your project's local development services, such as `php artisan serve`, `npm run dev` or `docker compose up`, from the CLI and the console's **Setup** tab. It only runs commands you reviewed and trusted, and it only stops processes it started and can still positively identify.

Supported on Linux, macOS and Windows (Windows since 1.5.5). Linux is verified on real machines; macOS and Windows run the platform suite on real CI runners, and their full journey is still to be verified by hand ([checklist](onboarding-manual-validation.md)). The Run page never hides itself on a system: it says what that system cannot do.

**Windows specifics (1.5.5, PF-0176):**

- A service command is found on the service's `PATH` (with the current registry `Path`, so a tool installed while the console runs is found) and started without a shell; an npm `.cmd` shim such as `npm.cmd` is started as `node` with its script. Services start with a hidden console of their own (shared with the programs they start), so no window opens and they keep running when the console stops or its window is closed.
- A process is YallaFlow's only while its pid **and its creation time** match the run record. They are read from the system's process table with one fixed, read-only query (`powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process …"`). The list is read in the background, never while the console waits. If it cannot be read, no process has an identity: nothing is stopped and no record is cleared; a service whose identity cannot be recorded at start is not kept running.
- **Stop is forceful on Windows.** Windows cannot ask a detached console program to stop gracefully. YallaFlow reads the process list again, starts only from the service's own process (same pid **and** creation time), and ends it and every process it started one by one, each only while its own creation time still matches (never `taskkill /T`, which follows parent links without checking them). A child started during the stop is included; anything still running is reported, never claimed stopped. `stopSignal` does not apply there. If the process list cannot be read, nothing is stopped and the record is kept (`RUNTIME_UNVERIFIABLE`).
- **Docker Compose services are not started, stopped or restarted on Windows** in this release (`RUNTIME_COMPOSE_WINDOWS`). Their cards say so; the other services stay usable.
- Who holds a port is read from `netstat -ano`.

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
- **Start project** (`runtime start --all`, or **Start project** on the console's Run tab).
  - It starts every service whose whole dependency chain is trusted, in dependency order, one at a time, waiting for each to be ready.
  - A service with an untrusted or changed link in its chain is not started. It is listed with what to review.
  - The first failure stops the sequence, and services already running are left as they are.
  - **Stop project** (`runtime stop --all`) stops only services YallaFlow started, in reverse order.
- **Open.** A running service with a port shows **Open** on the Run tab. It links to `http://127.0.0.1:<port>/`, or to the path set in the service's optional `open` field.
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

## Fixing a service that does not start

These fixes are offered where the service fails: on its card in the console's Run tab, and as commands.

### What it needs before it starts

`runtime status`, the Run tab and `runtime start` check the files on disk first. Nothing is run for the check.

The answer has one of three states (`prerequisites.state` in `runtime status --json`):

| State | Meaning | Start |
|---|---|---|
| `READY` | Checked, nothing is missing (or the package declares no dependencies). | Starts. |
| `NEEDS_SETUP` | One of the problems below, with its fix. | Refused with the fix, unless you choose **try anyway**. |
| `UNKNOWN` | The check cannot tell, with a reason. | Never blocked. |

- **NEEDS_SETUP:** a service started by `npm`, `pnpm`, `yarn`, `bun` or `npx` whose `package.json` declares dependencies while none are installed (no `node_modules` in the package folder or above it, inside the repository); or a script whose first word is a tool the package declares (for example `ng` from `@angular/cli`) that is not installed locally. In a monorepo an install hoisted to a folder above the package counts; a tool installed only in a sibling package does not.
- **UNKNOWN** (reason in `prerequisites.reason`): a command YallaFlow does not recognize as a package manager (`unsupported-command`; the Run tab says nothing for it), a Compose service (`not-checked`), no or an unreadable `package.json` (`no-package-json`), Yarn Plug'n'Play (`yarn-pnp`), a service that passes `NODE_PATH` (`custom-module-path`), a package folder outside the project (`outside-project`) or one that does not exist (`folder-missing`). The Run tab says why it could not tell; nothing is offered or required.
- **A tool the package does not declare is not called missing** (it may be global).
- **Try anyway.** When the check is wrong for your setup (the dependencies come from another folder, a container or a custom loader), start without it:

```bash
yallaflow runtime start <id> --skip-setup-check
yallaflow runtime restart <id> --skip-setup-check
```

  In the Run tab it is **Advanced: start it anyway** under the missing-dependency notice, for a trusted service. It skips only the dependency check, and only for the service you named (a service it depends on is still checked). Monitor Only, trust and its definition hash, the folder and link protections, the Compose check and the port pre-flight all still apply. The service log records that the check was skipped. If the service then fails, the failure line says why.
- **The fix is named, not run.** The install command follows the lockfile beside `package.json`:

| Lockfile | Command |
|---|---|
| `package-lock.json`, `npm-shrinkwrap.json` | `npm ci --include=dev` |
| `pnpm-lock.yaml` | `pnpm install --frozen-lockfile` |
| `yarn.lock` | `yarn install --frozen-lockfile` (`--immutable` when `packageManager` says Yarn 2 or later) |
| `bun.lock`, `bun.lockb` | `bun install --frozen-lockfile` |
| none | `<manager> install`, and you are told it creates a lockfile |

```bash
yallaflow runtime install <id>                     # shows the cause and the command; runs nothing
yallaflow runtime install <id> --confirm <hash>    # runs that exact command
```

- **Running it is your decision.** It runs only for a trusted service, only with the hash of the command you were shown, from a terminal or the console's confirmed button. It uses argv (no shell) and the service's own environment, in the package folder, and writes its output to the service log.
- **A frozen install changes neither `package.json` nor the lockfile.** What it installs stays on your machine; each teammate installs on theirs.
- **A `MODULE_NOT_FOUND` is not always missing dependencies.** When the missing module is a file of the project, the failure is reported as a wrong path, and no install is suggested.

### A port that is taken

The existing start pre-flight now also says who holds the port and offers a free one. Nothing is stopped.

- **Owner:** another service of this project by name when YallaFlow started it, otherwise the container or process the system reports.
- **Suggestion:** the next port that nothing listens on and no service of this project is defined on.

```bash
yallaflow runtime port <id> --from 4200 --to 4202            # this machine only (the default)
yallaflow runtime port <id> --from 4200 --to 4202 --shared   # the shared file
```

- **Changed together, or not at all:** the port, the readiness check on that port, links that open that port, and the port argument of the command.
- **The command is changed only when YallaFlow understands it:** an explicit port argument (`--port 4200`, `--port=4200`, `-p 4200`, `127.0.0.1:4200`), or a package script that starts a known dev server (`ng serve`, `vite`, `next dev`, `nuxt dev`, `astro dev`, `webpack serve`, `vue-cli-service serve`), which gets `-- --port N`. Anything else is refused with the reason, and you edit the command yourself. A Compose service is refused too: its ports are in its Compose file.
- **Refused when it would be a guess:** the command mentions the old port in more than one place and only some are recognizable as the port; the script already sets a port or runs more than one command (`&&`, `;`, `|`); or the service runs its script with pnpm, Yarn or Bun (they pass `--` and extra arguments differently by version, so only `npm run` gets `-- --port N`).
- **Other services are reported, never changed.** A service whose command, links or readiness check still mention the old port is listed after the change (for example a reverse proxy or a frontend link to an API), so you decide. Project files such as a proxy config (`proxy.conf.json`) or `.env` are not read, and the message says so.
- **A local change can be undone.** It is saved as a personal override; the shared file is not touched. To return to the shared definition:

```bash
yallaflow runtime reset <id>
```

  In the console: **Edit** → **Remove all local changes and return to the shared definition**. The card and the confirmation both say that **all** of your local changes to that service are removed (they are listed), not only the port. Another personal service is never removed. A service defined only on this machine has nothing to return to and is refused (`runtime remove <id> --local` deletes it).
- **Nothing is stopped.** A port held by another service or process is never freed by stopping it.
- A changed port needs a new review and trust before the service starts.

### Editing a service

```bash
yallaflow runtime edit <id> --local|--shared [--name …] [--port N]… [--cwd …] [--ready-port N | --ready-log TEXT | --no-ready] [--open /path] [--env NAME]… [-- <command…>]
```

- **Only what you name changes.** Every other field stays as it is, including links and the services it depends on.
- **You say where it is saved; there is no default.**
  - `--local`: this machine only (`.yallaflow/local/runtime.yaml`, ignored by Git). For a shared service it is a personal override of just those fields.
  - `--shared`: the repository file (`.yallaflow/runtime.yaml`). Teammates get it only after you commit and push it. Saving uploads nothing.
- If your personal override already covers a field you change in the shared file, the override still wins on your machine, and the command says so.

### Why it failed

A failed start, `runtime status --json` (`failure`) and the Run tab give the line of the log that states the cause, for example the `Cannot find module …` line with the missing file, instead of the last lines of the stack trace. The full log is still `runtime logs <id>`. Log lines are redacted (best effort) before they are shown or prepared for the agent.

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
