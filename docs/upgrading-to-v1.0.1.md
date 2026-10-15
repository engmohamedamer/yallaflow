# Upgrading to 1.0.1

YallaFlow 1.0.1 is a patch release. It closes a gap in the agent guidance: an agent could load the project, edit application code without a work item, and then offer YallaFlow tracking as optional. You still just describe the work. The agent now routes every engineering change before its first edit, and small changes stay light.

## What changed

- **Agent Contract v9** (`.yallaflow/AGENT.md`). A new rule, "route before editing": before the first intentional edit to source, tests, migrations, configuration, build or deployment files, or any other engineering artifact, the change must belong to a routed work item whose `yallaflow guide` reports modification authorized.
  - If an active work item already covers the request, the agent continues it. It does not create a duplicate.
  - "Engineering artifact" is any tracked project file other than YallaFlow state, including docs, temporary debug edits, and files rewritten by a command such as a dependency install.
  - Size never exempts a change. It sets the weight: a small UI fix, a straightforward bug, or a copy change is **bounded** work. In the default adaptive mode, bounded work has no specification or plan review and no lengthy specification. If your project uses a stricter interaction mode (for example `gated`), its review gates still apply, and the agent asks you rather than approving them itself.
  - A read-only investigation never authorizes edits, and a finished work item is reopened or followed by new work, never edited under silently.
  - Operational help needs no work item: starting a dev server, opening the app, showing logs, checking `git status`, inspecting processes or ports.
  - The agent never asks whether to track a change, and never offers tracking after the fact.
  - A recovery procedure covers edits that were already made without a work item (see below).
- **Bootstrap block v3** (the YallaFlow block in `CLAUDE.md` and `AGENTS.md`). It adds the same precondition as a numbered step, so a cold session sees it before reading `AGENT.md`.
- **`yallaflow brief`.** With no active work, it now says to route an engineering change before its first edit.

Unchanged: the Skill Registry (v8), the Knowledge Policy (v1), every workspace and schema version, lifecycle and verification rules, the Brownfield understanding gate, Greenfield behavior, and the Shared Project minimum version (`0.3.10-internal.1`).

## Upgrade an existing project

```bash
npm install -g yallaflow@1.0.1
cd your-project
yallaflow upgrade status          # read-only: reports the agent contract as outdated (v8 → v9)
yallaflow agent refresh --dry-run # preview
yallaflow agent refresh           # updates only the YallaFlow-managed blocks
yallaflow doctor
```

`agent refresh` rewrites only the managed block in `.yallaflow/AGENT.md` and the YallaFlow block in `CLAUDE.md` and `AGENTS.md`. Your own text outside those blocks stays byte-for-byte. Work items, project memory, and sources are not touched. If you edited inside a managed block, the refresh refuses and tells you how to keep your text (`--preserve-existing`). Commit the refreshed files so every teammate and session gets the new guidance.

Nothing is rewritten on read. Until you refresh, 1.0.1 keeps working with the v8 contract, and `yallaflow brief` names `yallaflow agent refresh` as the next step.

**Mixed teams.** A 1.0.0 CLI on a refreshed project reports the contract as "written by a newer YallaFlow" and does not downgrade it. Work still runs, because no schema changed. Upgrade everyone anyway, so every agent reads the same rules.

## Recovering a change made without a work item

If an agent (or anyone) already changed engineering files without a routed work item, do not undo the work or rewrite history. The agent recovers it as follows:

1. Keep the change. Do not revert, stash, reset, or amend, and do not touch Git history.
2. Tell the developer plainly that the change was made before it was tracked.
3. Route it now (`yallaflow start "<the request>"` and `yallaflow route`), or continue the active work item that covers it. The work item carries the current time and is never backdated. Make no further edits until guidance authorizes them. In a Brownfield project that has no approved understanding yet, routing is refused. Keep the change, run the baseline, and recover it after approval.
4. Record a ruling right away:
   ```bash
   yallaflow checkpoint <work-id> --ruling "<paths> were edited before this work item existed, without workflow authorization; adopted for review and verification" \
     --ruling-reason "recovering an untracked edit" --cost-if-wrong "<impact>"
   ```
5. Walk the workflow honestly:
   - Discovery reviews the existing diff.
   - Earlier behavior is inspected or reproduced read-only against HEAD (`git show HEAD:<path>` or a temporary `git worktree`), or recorded as unavailable.
   - The implementation checkpoint describes what was already changed, plus any correction.
   - Verification runs fresh against the working tree.
   - Then run `yallaflow finish <work-id>`.

   A change that was already committed is routed the same way and cites its commit. That commit is never rewritten.

Never claim that the earlier edit was authorized, or that evidence existed before it did. Uncommitted changes that are not part of the request, such as your own work in progress, stay yours. The agent leaves them untouched and out of the work item, and asks you when it cannot tell.

## What this release can and cannot guarantee

The Agent Contract is an instruction to the coding agent, not a technical lock. YallaFlow cannot by itself stop a direct file write. The release has two kinds of evidence:

- **Automated tests** (`test/work-routing.test.js`) cover two things:
  - the contract and bootstrap text, the `brief` line, and the legacy refresh. These would fail on 1.0.0.
  - the existing CLI paths that the text sends an agent down: bounded work without approvals in adaptive mode, human gates in gated mode, active-work reuse, operational commands that create nothing, verification and finish, the Brownfield gate, Greenfield, and recovery. These pass on 1.0.0 too, because no CLI gate changed.
- **Real-agent behavior** is a separate acceptance check. In the Sekaya scenario ("Move the project's Edit and Delete buttons into a three-dots ActionGroup at the end of the table"), the agent must route the work before its first engineering edit. That check runs in a real agent session, not in the test suite. It has not yet been run against 1.0.1.

Possible follow-ups, not part of this patch: detecting uncommitted engineering changes that no work item covers (Git drift detection), and optional provider hooks that would check routing before a write.

## Versions at 1.0.1

| Version domain | Value | Changed by 1.0.1? |
|---|---|---|
| Package | `1.0.1` | yes (from `1.0.0`) |
| Agent Contract | v9 | yes (from v8) |
| Agent bootstrap block | v3 | yes (from v2) |
| Skill Registry | v8 | no |
| Knowledge Policy | v1 | no |
| Workspace/schema versions | unchanged | no |
