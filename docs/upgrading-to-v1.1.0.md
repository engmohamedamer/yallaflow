# Upgrading to 1.1.0

YallaFlow 1.1.0 is a minor release: three new capabilities, all optional and backward-compatible. If you do not use them, nothing about your project or your workflow changes: no new settings, files, dependencies, background services, or network access. Details: [Tickets, AI QC & Smart Demo](connected-requirements-and-quality.md).

## What is new

- **Connected Requirements.** `yallaflow intake ticket` imports a GitHub Issue, Jira issue, or Azure DevOps work item as an immutable source, with its description, acceptance criteria, comments, attachments, and a link back to the ticket.
  - By default the agent supplies the ticket from its own integration (the `gh` CLI, an MCP server, the tracker API), and YallaFlow stays offline.
  - The explicit `--fetch` lets YallaFlow fetch the ticket read-only, with credentials from environment variables that are never stored. It is the only network access in YallaFlow.
- **Optional AI QC.** `yallaflow qc plan|record|status` records Playwright-driven functional and exploratory testing, on request only.
  - Plans trace to acceptance criteria, and honesty rules apply to every result.
  - The policy is advisory by default. A strict policy is opt-in; it governs quality approval, never the task's completion.
  - QC records are separate from verification evidence.
- **Optional Smart Demo & recording.** `yallaflow demo propose|approve|record|status`, on request only and independent of QC.
  - The agent proposes prioritized scenarios, and you approve them before anything is recorded.
  - Video is optional.
  - A demo is never presented as test evidence.
- **Local quality artifacts and reports.** Media is stored under `.yallaflow/work/<id>/quality/media/` with hashes and is excluded from Git by default. `quality/report.md` and a standalone `quality/report.html` link everything locally.

Under the hood:

| Domain | 1.0.1 | 1.1.0 |
|---|---|---|
| Agent Contract (`.yallaflow/AGENT.md`) | v9 | **v10**: tickets as untrusted data, optional QC/demo rules |
| Skill Registry | v8 | **v9**: on-demand skills `requirement-import`, `ai-qc`, `smart-demo`; every required workflow chain is unchanged |
| Bootstrap block (`CLAUDE.md`/`AGENTS.md`) | v3 | v3 (unchanged) |
| Knowledge Policy | v1 | v1 (unchanged) |
| Workspace and file schemas | — | unchanged; new files `quality/qc.json` and `quality/demo.json` start at schema v1 |
| Runtime dependencies | 4 | 4 (Playwright is never a YallaFlow dependency) |

`verify` now captures up to 64 MiB of command output. Verbose suites, such as Playwright reporters, are no longer killed at Node's 1 MiB default and mis-recorded as failed runs.

## Upgrade an existing project

```bash
npm install -g yallaflow@1.1.0
cd your-project
yallaflow upgrade status          # read-only: reports the agent contract as outdated (v9 → v10)
yallaflow agent refresh --dry-run
yallaflow agent refresh           # updates only the YallaFlow-managed block
yallaflow doctor
```

Commit `.yallaflow/AGENT.md`. Your own text outside the managed block, your work items, and your project memory are not touched. If a pre-release 1.1.0 build set up the project (for example a pilot), `agent refresh` also updates its unedited v10 block to the final text. Until you refresh, 1.1.0 keeps working with the earlier contract. The new commands work either way, but the agent learns the new rules (untrusted tickets, QC/demo only on request) from v10.

Existing work items keep their pinned behavior. On-demand skills apply to them too, including finished work, without rerouting or reopening.

### Optional settings

None are required. `init` writes none of them, and `doctor` validates them when present:

```json
"requirements": { "providers": { "jira": { "baseUrl": "https://acme.atlassian.net" } } },
"quality": { "qc": { "policy": "strict" }, "media": { "commit": false } }
```

Credentials never go in config. If your repository ignores `*.log` or similar patterns, nothing changes for QC: media exclusion is handled by YallaFlow's own `media/.gitignore`.

## Mixed versions

A 1.0.x CLI keeps reading a workspace that used tickets, QC, and demos: `status`, `brief`, `guide`, `doctor`, `source`, and `convergence` all work, tested against the real v1.0.1. It does not have the `qc`, `demo`, or `intake ticket` commands. It reports Agent Contract v10 as "written by a newer YallaFlow" and never downgrades it. Upgrade everyone so that every agent follows the same rules.

## Before you rely on it

- QC and demo results are the agent's recorded claims, held to the honesty rules and hashed. YallaFlow does not watch the browser.
- Video recording needs Playwright's ffmpeg (`npx playwright install ffmpeg`).
- Traces and screenshots can contain cookies, tokens, or personal data. They stay local by default; use test data.

See [limitations](limitations.md#optional-quality-ai-qc-and-smart-demo) and [security](security.md).
