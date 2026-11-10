# Upgrading to 1.5.0

1.5.0 is a backward-compatible minor release. It adds:

- **Queue:** several work items run one after another, each in a new agent session. [Execution modes](execution-modes.md)
- **Review and manual merge** for a finished lane: readiness, files, conflicts, secret-looking content, and the exact Git steps to merge it yourself.
- **Approval wait per project** for agent tool requests: 5, 15, 30 or 60 minutes. The default is 5, and an expired request is denied.
- **Overview** shows the current branch and Shared Project Mode, and can turn it on. Work items show their title first, with copyable IDs.
- **`yallaflow doctor`** always runs collision diagnostics and detects duplicate project-memory IDs.

**Disabled in 1.5.0:**
- **Parallel execution.** It stays off until a real-agent test confirms its security boundary.
- **Automated Merge.** YallaFlow commits and merges nothing itself.

## Steps

```bash
npm install -g yallaflow@1.5.0
yallaflow --version      # 1.5.0
yallaflow doctor
yallaflow agent refresh  # Agent Contract v11 -> v12
```

`agent refresh` keeps any text you added outside the managed contract block. If someone hand-edited the managed block, it refuses and says so, and changes nothing.

**What does not change:**

- **No migration.** Existing work items, project memory, sources and evidence load as before. Nothing is rewritten.
- **YallaFlow still does not commit, merge or push for you.**
- **No new runtime dependency, no new service, no API keys.** Agents run on your existing Codex and Claude Code subscriptions.

## What changes in behavior

- **Agent Contract v12.**
  - It names `work/<id>/integration.yaml` as YallaFlow-owned state.
  - It adds rules against commits, merges and Git configuration changes in managed lanes. These rules are behavioral guidance only.
  - `brief` reports the older contract until you run `yallaflow agent refresh`.
- **Minimum version.** Declaring merge checks with `yallaflow execution checks set` asks you to confirm `--accept-minimum-version 1.5.0`. From then on, older CLIs can read the project but refuse to change it. Projects that never declare merge checks are untouched.
- **New files.** These appear only when you use the feature:
  - git-ignored personal state under `.yallaflow/local/`: `execution/` (queue runs and events) and `approval.json` (approval wait);
  - `execution.mergeChecks` in `.yallaflow/config.yaml`, if you declare merge checks.
- **Git reads.** Every Git command YallaFlow starts turns off repository-configured fsmonitor, hooks and submodule recursion.

## Mixed versions

In a Shared Project, upgrade every teammate's CLI before anyone declares merge checks. After that, the project requires 1.5.0.
