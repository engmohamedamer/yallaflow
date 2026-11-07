# Upgrading to 1.4.0

1.4.0 is a backward-compatible minor release. It adds:

- the work lifecycle: hold, resume, and close without delivery;
- work management and review-gate decisions in the console;
- a Project Overview;
- a development runtime manager;
- a New Project Wizard;
- a console agent chat that follows the page and can continue stopped work with another agent.

## Steps

```bash
npm install -g yallaflow@1.4.0
yallaflow --version      # 1.4.0
yallaflow doctor
yallaflow agent refresh  # Agent Contract v10 -> v11
```

**What does not change:**

- **No migration.** Existing work items, project memory, sources, and evidence load as before. Nothing is rewritten.
- **Same versions.** The Skill Registry (v9), the bootstrap blocks (v3), the Knowledge Policy (v1), and every workspace schema version are unchanged. New snapshot fields are additive to `yallaflow.snapshot/1`.
- **No new runtime dependency.** The console, the runtime manager, and the wizard run only when you start them.

## What changes in behavior

- **Agent Contract v11.** Agents hold, close, resume, or reopen work only when you ask, and never progress held or closed work. `brief` reports the older contract until you run `yallaflow agent refresh`.
- **Minimum version on first hold or close.** The first `yallaflow work hold` or `work close` in a project asks you to confirm `--accept-minimum-version 1.4.0`. That records that the project now requires YallaFlow 1.4.0 or later.
  - Older 1.1.x–1.3.x CLIs can still read such a project, but they refuse to change it.
  - Projects that never hold or close work are untouched.
- **Console writes.** A normal `yallaflow console` can now change things, but only after you confirm an action on the page:
  - work-item actions and gate decisions, through YallaFlow's own commands;
  - Start, Stop and Restart for runtime services you have trusted;
  - creating a project;
  - enabling agents for the current run.

  Use `--read-only` to turn every change off. Details: [`console.md`](console.md).
- **New files.** These appear only when you use the feature:
  - `.yallaflow/runtime.yaml` (reviewed runtime profiles), with git-ignored personal overrides and trust under `.yallaflow/local/`;
  - `work/<id>/lifecycle.yaml`.
- **Agent sessions** (`yallaflow console --agents`, or **Enable agents for this session**):
  - The chat is on every project page. A work item page is that item's chat; the other pages share a project chat.
  - When an agent stops (for example, at a usage limit), the item's chat offers to continue with another agent. See [`agents.md`](agents.md#when-an-agent-stops-in-the-middle-of-a-work-item).
- **Claude Code (experimental).** Off by default. You can turn it on for one console run. See [`agents-claude-experimental.md`](agents-claude-experimental.md).

## Mixed versions

- In a Shared Project, upgrade every teammate's CLI before anyone holds or closes work. After that first hold or close, the project requires 1.4.0.
- Diverged branches that allocated the same work IDs can be reconciled with `yallaflow history …`. See [`history.md`](history.md).
