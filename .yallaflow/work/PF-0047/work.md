# PF-0047 — Development Runtime Manager: reviewed runtime profiles (.yallaflow/runtime.yaml with git-ignored personal overrides) for Laravel, Node.js and Docker; explicit trust bound to the command definition; Start, Stop, Restart, Logs, ports and process status from the CLI and the Console; never run inferred commands automatically, never stop processes YallaFlow did not start, never expose secrets

## Raw Request

Development Runtime Manager: reviewed runtime profiles (.yallaflow/runtime.yaml with git-ignored personal overrides) for Laravel, Node.js and Docker; explicit trust bound to the command definition; Start, Stop, Restart, Logs, ports and process status from the CLI and the Console; never run inferred commands automatically, never stop processes YallaFlow did not start, never expose secrets

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** feature
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow feature --scope architectural`.
**Timestamp:** 2026-11-07T02:33:38.639Z
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

## Discovery

## Architecture / Technical Decisions

Classify only relevant decisions as confirmed, proposed, unresolved, or not applicable.

## Design

Chosen: CLI-launched, detached process groups with run records and log files under .yallaflow/local/runtime/, shared by CLI and Console. Rejected: an in-Console supervisor owning child pipes (services and logs would die with the Console). Stop safety reuses the Agent Workspace's pid + start-time identity.

## Specification

### Scope
Development Runtime Manager for local development services: reviewed runtime profiles, explicit trust, Start / Stop / Restart / Logs / status from the CLI and the Console. Linux and macOS. Windows refused with a clear message, with no claim of support. Sources: SRC-0037 (correction paragraph) and SRC-0036 (owner decisions 2026-11-07).

### Profiles
- **Shared profile `.yallaflow/runtime.yaml`** (committed, secret-free). Contains `{ schemaVersion: 1, services: [Service] }`.
- **Service** fields:
  - `id`: `^[a-z][a-z0-9-]{0,31}$`
  - `name`
  - `kind`: `process` | `docker-compose`
  - `command`: argv array; the first element is the executable. No shell, ever.
  - `cwd`: repository-relative; it must resolve inside the repository after realpath, and symlink escapes and `..` are refused.
  - `env`: an array of environment-variable **names** passed through from the developer's environment. Values are never stored.
  - `ports`: an array of integers from 1 to 65535.
  - `ready`: `{ port }` | `{ log: "<literal text>" }` | none.
  - `stopSignal`: `SIGTERM` (default) | `SIGINT`
  - `stopTimeoutSeconds`: 1–120, default 10
  - `dependsOn`: other service ids (start order only).
- **Validation.** Unknown fields are refused, and so is anything that looks like a secret. A key named like a secret or a value matching the secret patterns is rejected with the field name and never echoed. A `command` element containing shell metacharacters is not refused, but it is passed literally and the review shows it as literal text.
- **Personal overrides `.yallaflow/local/runtime.yaml`** (git-ignored). They hold the same service shape, keyed by id, and may override `command`, `cwd`, `env`, `ports` and `ready`, or add personal services. The effective service is shared + override. The UI marks overridden fields.
- **Writing profiles.** `yallaflow runtime add|remove` writes the shared profile, and `--local` writes the override file. These are the only writers, and they validate first. Writing a profile never runs anything.

### Suggestions (never executed)
`yallaflow runtime suggest` derives candidates from repository evidence:
- `composer.json` with `laravel/framework` and an `artisan` file → `php artisan serve` (port 8000).
- `package.json` scripts `dev`/`start` → `npm|pnpm|yarn run <script>`, matching the detected lockfile.
- compose file → `docker compose -f <file> up` (kind docker-compose, stopSignal SIGINT).

Each suggestion is labelled "suggested from <file>". Adding one is an explicit `runtime add --from-suggestion <n>` or a Console confirmation that shows the exact argv. It is never started on its own.

### Trust
- **Trust record.** `yallaflow runtime trust <id>` records the SHA-256 of the canonical effective service definition plus a one-way fingerprint of the checkout path in `.yallaflow/local/runtime-trust.yaml`. That file is personal, git-ignored and never shared.
- **When trust ends.** Start refuses an untrusted service, or one whose definition or checkout changed since trust, with `RUNTIME_UNTRUSTED` and the exact argv/cwd/env-names to review. A pulled profile change therefore always needs re-trust.
- **In the Console.** Trust shows the exact executable, arguments, working directory, env names and ports, plus a warning that package scripts can run arbitrary code. It requires typing the service id to confirm.

### Supervisor
- **Start.**
  - Launched with `spawn(exe, args, { shell: false, detached: true, cwd, stdio: ['ignore', logFd, logFd] })`.
  - Environment: the developer's environment filtered to a fixed safe base (PATH, HOME, LANG, TERM, USER, SHELL, TMPDIR) plus the profile's named variables. Variables named like API keys are not passed unless the profile names them explicitly.
  - Dependencies start first.
  - Refused if any declared port is already listening (`PORT_IN_USE`, naming the port; the process using it is never touched) or if the service is already running.
- **Run record.** Stored in `.yallaflow/local/runtime/runs/<id>.json` with pid, pgid, Linux start time (from `/proc/<pid>/stat`) or a ps-derived start time on macOS, definition hash, startedAt, startedBy (cli|console) and log path.
- **States** (computed on read, never trusted from the file):
  - `stopped` (no record, or stopped by YallaFlow)
  - `starting` (alive, readiness not yet met)
  - `running` (alive and ready, or no readiness defined)
  - `failed` (the process ended without a YallaFlow stop; exit code when known)
  - `unknown` / unmanaged (the pid is alive but its identity does not match, for example after PID reuse). Reported as unmanaged and never signalled.
- **Stop.**
  - Only for a process whose pid and start time still match the run record.
  - Sends `stopSignal` to the process group, waits `stopTimeoutSeconds`, then SIGKILLs the group if the identity still matches.
  - On Linux, tracked descendants that left the group are also signalled.
  - Survivors are reported, and a clean stop is never claimed.
  - Nothing is ever killed by port or by name.
- **Restart** = stop (must succeed cleanly) then start, under the same trust check.
- **Lifetime.** Services are independent of the Console process. Closing the Console leaves them running, and `yallaflow runtime stop --all` stops every owned service. The Console shows services started from the CLI and vice versa. On startup it re-reads run records and verifies identity.
- **Logs.**
  - Per-service log file, size-capped at 5 MB, rotated once (`.1`).
  - Read through `yallaflow runtime logs <id> [--lines N]` with secrets redacted, using the existing redaction rules. The UI states that redaction cannot be perfect.
  - The Console tails the log by polling the read route, and the output is escaped.

### Ports and readiness
Port checks connect to `127.0.0.1:<port>` only, with a 300 ms timeout, and nothing else. This adds a loopback-only exception for `src/runtime/` to the no-network guard test.

### Console
- **Setup tab.** Profile services with status, ports, readiness, the last 200 log lines (on demand), errors and an overridden-field mark. Suggestions are listed separately.
- **Actions.** Trust, Start, Stop and Restart go through fixed POST routes `/api/p/<project>/runtime/<id>/(trust|start|stop|restart)`, with the same token, Origin, JSON, size and read-only guards. The server runs the CLI through the runner and never takes a command from the request. Trust requires `{ confirm: "<id>" }`.
- **Read-only.** A read-only console shows status and logs only.

### CLI
`yallaflow runtime list|status [--json]`, `suggest`, `add <id> --name N --kind K --cwd DIR [--port N]... [--env NAME]... [--ready-port N|--ready-log TEXT] [--local] -- <exe> [args...]`, `remove <id> [--local]`, `trust <id>`, `start <id>`, `stop <id>|--all`, `restart <id>`, `logs <id> [--lines N]`.

### Compatibility
- **New files only.** `.yallaflow/runtime.yaml` is new and optional. Projects without it are unchanged, and older CLIs ignore it.
- **Ownership.** `runtime.yaml` is registered in the state-ownership map (owner `cli`, writers `runtime add|remove`). `doctor` validates it when it exists.
- **No minimum-version bump.** Nothing older reads it.

### Non-goals
- No automatic install, migrations, restart loops, privileged ports, remote hosts, Windows support, or stopping containers or processes YallaFlow did not start.
- Detected services are suggestions only.

### Owner decisions (SRC-0040, 2026-11-07) — binding constraints
1. **Loopback checks.** Port and readiness checks connect only to 127.0.0.1, only for ports explicitly configured on a service, with a 300 ms timeout. The no-network guard keeps prohibiting everything else, and no external probing is ever added.
2. **Services outlive the Console.** Ownership is tracked across restarts: pid + process start time + process group + the definition hash in the run record, plus the project's checkout fingerprint. Only a process positively identified this way is ever signalled. Anything else is reported as **unmanaged** and never terminated.
3. **Personal trust.** It lives in `.yallaflow/local/runtime-trust.yaml` (git-ignored) and is bound to the hash of the effective command, cwd, kind, env names, ports, readiness and stop settings, plus the checkout fingerprint. Any material change requires renewed confirmation. Suggestions inferred from repository files are never executed without being added and trusted explicitly.
4. **Controlled environment.** Services get a fixed minimal base (PATH, HOME, LANG, LC_ALL, TERM, USER, LOGNAME, SHELL, TMPDIR, TZ) plus the variables the profile names explicitly. No other variable is inherited: credentials, tokens and API keys reach a service only when the profile names them. Values are never stored.
5. **States.** `stopped` (never started, or exited 0 after a stop), `starting`, `running`, `failed` (exited on its own, or non-zero), and `unknown`/unmanaged (identity cannot be established). There is no `exited` state.
6. **No auto-start.** Opening a project, the Console or the Setup view never starts anything.
7. **Restarts and concurrency.** Trust, run records, logs and errors persist across Console restarts. A per-service lock makes concurrent start/stop/restart requests serialize: the second sees the first's result and never double-starts.
8. **Tests.** Security (no shell, cwd escape, secret refusal, env filtering, untrusted refusal, read-only console), crash recovery (killed service → failed; reused PID → unmanaged; console restart → state recovered) and concurrency (parallel starts start once).

### Unresolved Items — decisions needing owner approval (security / compatibility)
All four were decided by the owner on 2026-11-07 (see Owner decisions above).
1. **Loopback exception.** Allow `src/runtime/` a loopback-only TCP connect (127.0.0.1) for port and readiness checks, as a narrow, tested exception to the no-network rule.
2. **Lifetime.** Services outlive the Console (stopped explicitly with `runtime stop`/`--all`), rather than stopping when the Console exits.
3. **Trust storage.** Trust is personal (git-ignored), bound to the definition hash and checkout. A teammate's profile change always needs local re-trust.
4. **Environment base.** The fixed environment base above is passed through, plus explicitly named variables.

### Acceptance Criteria

AC-001..AC-006 in requirements.yaml (`yallaflow requirement` / `work show PF-0047`).

## Implementation Plan

**Modules (new):**
- `src/runtime/profile.js`: load, validate and merge `.yallaflow/runtime.yaml` and `.yallaflow/local/runtime.yaml`. Covers the schema, id, port and cwd checks (`realpath` inside the root), secret-key and secret-value refusal using `isSecretKey`/`containsSecret` without echoing values, and the canonical effective definition and its SHA-256.
- `src/runtime/trust.js`: `.yallaflow/local/runtime-trust.yaml`, holding `{ id: { hash, checkout, trustedAt } }`. Uses the checkout fingerprint from the existing shared-identity helper (or a sha256 of realpath).
- `src/runtime/suggest.js`: Laravel, Node script and compose suggestions from `inventoryRepository` + `detectStack` + `package.json` scripts. Pure data.
- `src/runtime/process.js`:
  - process identity: Linux `/proc/<pid>/stat` start time; macOS `ps -o lstart= -p` (argv)
  - group signalling and descendant tracking (reusing the pattern from `src/agents/acp.js`)
  - environment builder: fixed base + named variables
- `src/runtime/probe.js`: the only network code, a `127.0.0.1`-only TCP connect with a 300 ms timeout and an integer port.
- `src/runtime/supervisor.js`:
  - start, stop, restart, status and logs over run records in `.yallaflow/local/runtime/runs/<id>.json`
  - logs in `.yallaflow/local/runtime/logs/<id>.log`: 5 MB cap, one rotation, opened as the child's stdout/stderr fd, so they survive Console exit
  - a per-service lock file (O_EXCL, with stale detection by pid + start time)
  - the readiness poller during start (up to `readyTimeoutSeconds`, default 60, then `starting` is reported as is)
  - `failed` vs `stopped` from a stop marker that YallaFlow writes before signalling
- `src/commands/runtime.js` + `cli.js`: `yallaflow runtime list|status [--json]|suggest [--json]|add|remove|trust|start|stop [--all]|restart|logs`. `--json` returns `yallaflow.runtime/1` (new `resources/schemas/runtime-1.schema.json`). Start, stop and trust print outcome lines and a single JSON line with `--json`.

**Core integration:**
- `STATE_OWNERSHIP`: `runtime.yaml` (cli: `runtime add|remove`), with `local/` already personal.
- `doctor` validates `runtime.yaml` when present.
- `.yallaflow/local` stays ignored through the existing `ensureLocalIgnored`.
- The CLI lock is not taken for runtime operations, which never touch work state; the per-service lock is used instead.

**Console:**
- GET `/api/p/<p>/runtime`: `runtime status --json` through `runner.readFresh`.
- GET `/api/p/<p>/runtime/<id>/logs?lines=N` (N ≤ 1000).
- POST `/api/p/<p>/runtime/<id>/(trust|start|stop|restart)` with a fixed argv and the existing guards. Trust needs the body `{ confirm: "<id>" }`, and the others take `{}`.
- Read-only consoles return 405.
- **UI:** a new **Setup** tab with service cards (state chip, ports, readiness, trust state and the exact argv/cwd/env names, overridden marks), Trust/Start/Stop/Restart buttons with busy/error states, a log viewer (escaped and redacted, refresh button, best-effort redaction notice), a suggestions list with the "add" command shown under For developers (no browser-side profile editing in 1.4.0), and an unmanaged/needs-attention explanation. Arabic/English, light/dark, mobile.

**Tests** (`test/runtime.test.js`, using node fixture services so no network is needed):
- profile validation: escape, symlink, secrets, unknown fields, override merge
- trust invalidation on any material change
- untrusted refusal
- start/stop/restart of a real child, with port readiness through a tiny node HTTP server on a free port
- `PORT_IN_USE`
- environment filtering: a parent `SECRET_TOKEN` is absent and a named variable is present
- log redaction
- killed-outside → `failed`
- PID reuse simulated by a forged start time → `unmanaged`, with no signal sent
- run-record recovery in a new CLI process
- concurrent `start` ×5 → one process
- `stop --all`
- console routes (401/403/415/405 read-only, trust confirm mismatch, fixed argv)
- the no-network guard updated to allow `src/runtime/probe.js` only, and asserting that it contains `127.0.0.1` and no other host
- Laravel and Docker smoke tests where the tools exist: `php artisan serve` on a minimal artisan stub is not shipped, so Docker/compose is covered by profile/suggestion tests plus argv construction; real-process tests use node

**Browser:** a Setup-tab scenario added to `research/release-1.4/browser-check.mjs` (start a trusted node service, see `running`, read logs, stop), on three engines.

**Docs:** `docs/runtime.md` (new), console.md, cli.md, security.md and CHANGELOG.

**Review:** an independent security review on an isolated copy (the real repo read-only), with findings fixed or recorded.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0036
**Type:** file
**Name:** owner-1.4-complete-scope.md

Raw source preserved in: `.yallaflow/sources/SRC-0036/owner-1.4-complete-scope.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0037
**Type:** file
**Name:** owner-1.4-continue.md

Raw source preserved in: `.yallaflow/sources/SRC-0037/owner-1.4-continue.md`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0040
**Type:** file
**Name:** owner-1.4-spec-decisions.md

Raw source preserved in: `.yallaflow/sources/SRC-0040/owner-1.4-spec-decisions.md`. Read it directly; it is not duplicated here.
