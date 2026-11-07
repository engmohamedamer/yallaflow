# Development runtime (1.4.0)

YallaFlow can start, stop, restart and show the logs of your project's local development services, such as `php artisan serve`, `npm run dev` or `docker compose up`, from the CLI and the console's **Setup** tab. It only runs commands you reviewed and trusted, and it only stops processes it started and can still positively identify.

Supported on Linux and macOS. On Windows the commands refuse with a clear message.

## The profile

Services are defined in `.yallaflow/runtime.yaml`. The file is shared and committed, and it is secret-free:

```bash
yallaflow runtime suggest                       # candidates from repository files (never run)
yallaflow runtime add --from-suggestion laravel
yallaflow runtime add web --cwd frontend --port 5173 --ready-port 5173 --env VITE_API_URL -- npm run dev
```

A service has:
- an argv command (no shell, ever)
- a repository-relative folder. It must resolve inside the repository, and a symlink that leads outside is refused at start.
- environment variable **names** only. Values come from your environment when the service starts and are never stored.
- ports
- an optional readiness check, `--ready-port N` or `--ready-log TEXT`
- an optional stop signal and timeouts

Anything that looks like a secret is refused, and the value is never echoed.

**Personal overrides** go in the git-ignored `.yallaflow/local/runtime.yaml` (`runtime add … --local`). An override changes only the fields you give it, and the console marks overridden fields.

**Suggestions** come from repository evidence: Laravel `artisan`, `package.json` `dev`/`start` scripts (with the package manager from the lockfile), and Compose files. A suggestion never runs. You add it, review it, and trust it.

## Trust

```bash
yallaflow runtime trust web
```

- **First start.** A service never starts until you trust it in this checkout.
- **Where trust lives.** Trust is personal. It is kept in your user config folder (`$XDG_CONFIG_HOME/yallaflow/runtime/<checkout>/`, mode 0700), **outside the repository**, so a process or a repository that can only write the checkout cannot plant trust. Run records and per-service locks live there too.
- **What trust is bound to.** The effective command, folder, environment names, ports, readiness and stop settings of this checkout.
- **When to trust again.** Any change to any of these, including one pulled from a teammate, needs trust again.
- **A human decision.** On the command line, `runtime trust` shows the definition and asks you to type the service id in a terminal; a script or an agent's tool call is refused. This prevents accidental trust by automation, not a process that controls your whole user account.
- **In the console.** You type the service id after reviewing the exact command, and the request carries the definition you saw: if the profile changed meanwhile, nothing is trusted (`runtime trust <id> --expect <hash>` does the same on the command line).
- **What trust does not cover.** Trust covers the definition, not what the program or the scripts it runs do. A package script, a local `./run.sh` or a binary in `node_modules/.bin` can change without a new trust, so review those as you would any code you run.
- **Dependencies.** Starting a service checks trust for it and all its dependencies before anything starts.
- **Review text.** Commands, names and folders containing control or bidirectional-override characters are refused, so the reviewed text is what runs.

## Start, stop, restart, status, logs

```bash
yallaflow runtime status            # stopped · starting · running · failed · unknown
yallaflow runtime start web
yallaflow runtime logs web --lines 100
yallaflow runtime restart web
yallaflow runtime stop web          # or: yallaflow runtime stop --all
```

- **Environment.** A service gets a minimal base environment (`PATH`, `HOME`, `LANG`, `LC_ALL`, `TERM`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `TZ`) plus the variables its profile names. Other credentials, tokens and API keys in your shell are **not** passed on.
- **Start.**
  - A start is refused if a configured port is already in use. That process is reported and never touched.
  - Dependencies (`--depends-on`) start first.
  - The command waits for readiness, and an immediate crash is reported with the last log lines.
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

The **Setup** tab lists the services with their state, trust, command, folder, environment names, ports and overrides. It offers Trust, Start, Stop, Restart and Logs, and lists suggestions with the command to add each one.
- It re-reads state every few seconds while open.
- The routes are fixed (`POST /api/p/<project>/runtime/<service>/(trust|start|stop|restart)`) with the console's token, Origin, JSON and size checks. The request names a service, and the command always comes from the reviewed profile.
- A `--read-only` console shows status and logs only.
