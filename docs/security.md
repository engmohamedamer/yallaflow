# Security and Trust Model

This describes what YallaFlow does and does not protect, so you can decide what belongs in `.yallaflow/`. To report a vulnerability, see [`SECURITY.md`](../SECURITY.md).

## What YallaFlow is

A local CLI that reads and writes files under `.yallaflow/` in your repository, reads repository files you cite as evidence, and runs commands you ask it to run through `yallaflow verify`. It runs with your user's privileges.

## Guarantees

- **No implicit network access and no model calls.** YallaFlow calls no AI provider and sends no telemetry. The only command that touches the network is the explicit, opt-in `yallaflow intake ticket <ref> --fetch` (1.1.0): read-only `GET` requests to the tracker's API (GitHub, Jira, Azure DevOps), credentials read from environment variables; credentials go only over https to the hosted tracker (`api.github.com`, `*.atlassian.net`, `dev.azure.com`, `*.visualstudio.com`) or to a host you configured explicitly in `requirements.providers` (the only way to use GitHub Enterprise, Jira Data Center, Azure DevOps Server, or http) — a ticket URL alone never decides where a token goes (a credentialed request never follows a redirect to another host), never written to any file or printed. Every other command makes no network request. There is no YallaFlow server or account: your code, project memory, prompts, file paths, and captured sources are never transmitted anywhere by YallaFlow, and preserved source originals stay in your repository. Your coding agent is a separate program with its own data handling, and installing or updating the package contacts the npm registry through npm itself.
- **Untrusted input files are not executed.** File intake never runs macros, embedded scripts, or OLE objects; never fetches external links; never unpacks archives; applies size and entry-count limits to zip-based formats; and keeps every stored file name inside its own source directory. Format is detected from content, not trusted from the extension.
- **No source-control mutation without your approval.** The CLI never commits, pushes, pulls, fetches, rebases, or merges; its Git use is local and read-only (`rev-parse`, `diff`, `status`, `ls-files`, `check-ignore`, `symbolic-ref`, `config`). `yallaflow shared check` is safe in CI: read-only, no network, no model call. From 1.5.0 the console's Parallel and Review & Merge features change a repository only through one allow-listed module, and commit or merge only after you approve the reviewed content; see [Review & Merge and Git](#review--merge-and-git). YallaFlow never pushes, pulls, fetches, rebases, resets, reverts, stashes, cleans, checks out, deletes branches, or force-updates anything.
- **Development runtime (1.4.0) runs only what you trusted.** `yallaflow runtime` and the console's Setup tab run a service's argv (never a shell) only after you trusted that exact definition in this checkout; trust, run records and locks are kept in your user config folder, outside the repository, so they cannot be planted through the checkout. Services get a minimal environment plus the variables their profile names. They are stopped only while YallaFlow can match the process's pid and start time, never by port or name. The only network code is a TCP connect to `127.0.0.1` on configured ports with a 300 ms timeout. Logs stay in the git-ignored `.yallaflow/local/runtime/` and are redacted when shown (best effort). See [`runtime.md`](runtime.md).
- **Help never mutates state.** `--help`/`-h` on any command is read-only.
- **Reads never migrate.** Inspection commands (`status`, `guide`, `resume`, `handoff`, `doctor`, `context status`, `agent status`, …) do not change files.
- **Evidence references record location, not content.** A repository path cited as evidence is stored as path + SHA-256 hash + Git commit. File contents are never copied into the project-context ledger.
- **Secret values are redacted before they are persisted.** One sanitizer (`src/security/redact.js`) runs at YallaFlow's persistence boundary — every structured state file, the project-context ledger and its projection, work records (`work.md`, `progress.md`), generated ADRs, verification logs and command lines, and extracted source text. It replaces the *value* of recognizable secrets and keeps the name: secret-named assignments (`DB_PASSWORD=…`, `"api_key": "…"`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, …), `Authorization`/`Bearer`/`Basic` values, cookies, PEM private keys, credentials embedded in URLs, and well-known token formats (GitHub, GitLab, Slack, AWS, Google, Stripe, npm, `sk-…`, JWTs). `DB_PASSWORD=real-secret` is stored as `DB_PASSWORD=<redacted>`; the path `.env` stays valid evidence. It is conservative and pattern-based: it does not modify your files, and it cannot recognize a secret with no recognizable name or format.
- **Tamper detection, not tamper proofing.** `doctor` detects a source whose preserved original no longer matches its capture checksum, broken project-memory lineage, projection drift, and lifecycle contradictions. Nothing is cryptographically signed; Git history is the audit trail.

## What is stored, and where

| Data | Location | Sensitivity note |
|---|---|---|
| Captured sources | `.yallaflow/sources/SRC-####/` — the original file byte-for-byte, extracted text, and (for text files) the text in `source.json` | **The preserved original keeps its full contents byte-for-byte** (YallaFlow never alters it); extracted text and `source.json` text are redacted, and `intake` warns when a captured original appears to contain secret values. Do not capture files that contain credentials or personal data you would not commit. |
| Verification logs | `.yallaflow/work/<id>/evidence/V-###-verification.log` | Everything the command printed to stdout/stderr, with recognizable secret values redacted. Still avoid commands that print secrets. |
| Summaries, rulings, questions, knowledge, baseline facts | `work/<id>/*.yaml`, `context/index.yaml`, `*.md` | Written by your agent; recognizable secret values are redacted. Review before committing. |
| Imported tickets (1.1.0) | `.yallaflow/sources/SRC-####/<provider>-<key>.json` plus `extracted.txt` | The tracker payload is preserved byte-for-byte — it can include author names and, for Jira, account details the API returns. The rendered text is redacted and marked as untrusted content; the agent treats it as data, never as instructions. Credentials are never stored. |
| QC and demo records (1.1.0) | `.yallaflow/work/<id>/quality/` — `qc.json`, `demo.json`, `report.md`, `report.html`, `media/` | `qc.json`/`demo.json` are redacted and committed. **Media (videos, screenshots, traces) is copied byte-for-byte, and media and the generated reports are git-excluded by default** (`quality/.gitignore`); traces and screenshots can contain cookies, tokens, or personal data. Use test data and local environments; a non-local target needs `--allow-remote`. Nothing is uploaded. Integrity checks read media only inside the work item's media folder; a link pointing elsewhere is reported, never followed. |
| Command lines | `verification.json` | The command recorded for each run, with recognizable secret values redacted (the command itself runs unchanged). Avoid secrets in arguments. |

| Actor metadata (Shared Projects) | `work/<id>/memory.yaml` | `git config user.name` / `user.email` at work creation and staging — the same values your commits publish. No accounts, roles, or tokens. |
| Local identity (Shared Projects) | `.yallaflow/local/identity.yaml` (gitignored) | A random clone tag, a one-way fingerprint of the checkout path (never the path), a timestamp, and the last allocated sequence. Never committed; `doctor` fails if it is tracked. |

`.yallaflow/` is designed to be committed. Treat it with the same care as the rest of the repository: anything captured there is shared with everyone who can read the repository and its history.

YallaFlow has no secrets store. Tracker credentials for `intake ticket --fetch` are read from the environment at the moment of the request and never kept; there is no credential configuration (`doctor` rejects credential-like keys under `requirements.providers`). Redaction applies to what is written by 0.3.10-internal.4 and later (including 1.0.0); state an earlier prerelease already wrote is never rewritten retroactively. Structured state (`*.yaml`, `*.json`) is redacted again whenever YallaFlow next rewrites that file; append-only records (`work.md`, `progress.md`, verification logs) and preserved originals keep their earlier content. The projection never repeats a recognizable secret value.

## Review & Merge and Git

1.5.0 adds [Parallel work and Review & Merge](execution-modes.md). They are the only YallaFlow features that change a Git repository. All such changes go through one module, `src/execution/git-ops.js`, and only these operations:

| # | Operation | Git command | When |
|---|---|---|---|
| G1 | Create a lane | `worktree add -q -b yf/<slug> <project>.lanes/<slug> <base>` | You start Parallel work |
| G2 | Remove a lane folder | `worktree remove <lane>` (never `--force`; the branch stays), after the lane is listed again | You confirm Clean up |
| G3 | Preview a merge | `merge-tree --write-tree` (objects only; no checkout, index or ref change) | Every review |
| G4–G6 | Build the approved tree | `read-tree`, `add -A --pathspec-from-file`, `write-tree` on a private temporary index | Approve & merge |
| G7 | Create the merge commit object | `commit-tree` with two parents (`-S` when the repository signs) | Approve & merge |
| G8 | Stage exactly the approved paths | `add -A --pathspec-from-file` | Approve & merge |
| G9 | Commit the verified index | `commit --cleanup=verbatim -F <file>`, only when the index tree equals the approved tree | Approve & merge |
| G10 | Move a branch to the tested commit | `merge --ff-only --no-overwrite-ignore <commit>`, then HEAD, tree and index are verified | Approve & merge |

Read-only Git calls (such as `rev-parse`, `cat-file`, `status`, `ls-files`, `diff`, `config`, `var`, `check-ignore`) are used for checks.

Every call:

- runs `git` with an argument list (never a shell) and a timeout;
- uses a fixed prefix that turns off hooks (`core.hooksPath=/dev/null`), fsmonitor, the untracked cache and automatic maintenance, makes pathspecs literal, and disables the pager;
- runs in a cleaned environment: no inherited `GIT_*` redirection, editor, pager, askpass, SSH command or external diff; prompts are off and the locale is `C`;
- takes only validated arguments: lane names, absolute paths under a known root, and object ids that exist. Callers never pass raw arguments;
- overrides every filter and merge driver configured in any scope with an empty command, so Git cannot run one even where an attribute source is not detected;
- runs in a lane only while the lane is still a worktree of your repository. Its `.git` must point at your repository and back, so a lane cannot redirect Git to a repository of its own. The console checks the same before it runs anything in a lane, and then pins the lane's Git directory inside your repository (`GIT_DIR`, `GIT_WORK_TREE`), so the lane's own `.git` file is not read again. It knows a folder is a lane from your main checkout's lane list, never from files inside the lane. A lane's Team view lists your repository's worktrees, not what the lane points at.

Every other Git command YallaFlow starts carries `-c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.ignoreSubmodules=all`. Every `status` and `diff` also passes `--ignore-submodules=all` on its command line, which a `.gitmodules` entry cannot override. That covers status, diff and log reads in the CLI and the console. A repository's fsmonitor command, its hooks, and a submodule's own configuration therefore never run through YallaFlow.

Changing operations **fail closed**:

- **Unverified platform or Git version.** They run only on Linux with Git 2.43, the versions the transaction was validated on. Anywhere else, Parallel and Review & Merge refuse, and you work with Git by hand.
- **Submodules.** Repositories with submodules are refused for automated lanes, merges and Clean up. A nested repository brings its own configuration.
- **Filters and merge drivers.** They run only when the repository references no external filter or merge driver (for example Git LFS). References are found in every attribute source Git reads: tracked, untracked, ignored and staged `.gitattributes`, `info/attributes`, and the global and system attribute files. YallaFlow never runs project filters or merge drivers.
- **Interrupted or inconsistent state.** If Git is mid-operation, a lock file exists, or HEAD, the tree or the index differ from what was expected, YallaFlow stops. It never resets, repairs, removes locks or retries the change; the merge card explains what to do by hand.
- **Signing.** Commits are signed when the repository signs commits. SSH and OpenPGP signing are supported; other formats are refused.
- **Approval.** Your approval covers a hash of the plan. The plan includes:
  - the lane and target commits;
  - the approved files and their content;
  - the merge result;
  - the commit messages;
  - the checks;
  - the secret-looking files you ticked.

  Any difference before or during the merge stops it and asks for a new review. Files that look like secrets are excluded unless you tick them. That includes every version the lane adds to your branch history, whatever happened to the file later: versions committed and then edited or removed, versions only a merge commit brings in, binary content, and every path a version is committed under. The lane's commit messages and author fields are scanned too, and so is the lane commit message built from work titles. File names with invisible, space-like or direction characters block the review.
- **Checks.** Only the project's declared merge checks run, taken from your main checkout. Commands the lane's agent recorded are shown in full for information and are never run. Checks run only in a lane that holds exactly the merge commit, with no ignored files: YallaFlow never runs agent-controlled scripts, ignored executables or dependencies with your permissions. Otherwise Automated Merge is off for that task, with manual steps instead.
- **Clean up.** Clean up deletes ignored files only when they are recognised dependency folders (for example `node_modules/` beside a manifest and a lockfile) and shows the exact list first. These block it:
  - any other ignored file;
  - hidden (skip-worktree or assume-unchanged) changes;
  - an agent working in the lane;
  - uncommitted files;
  - an unmerged branch.

  The lane is listed again right before removal.
- **Personal state.** The run list, lane list, lane marker, approval wait and agent choice in `.yallaflow/local/` are read only when they are regular files that are yours, mode 0600 and not tracked by Git. Their content must have the shapes YallaFlow writes. A repository cannot plant a queue, a lane or a setting. A lane's runs are kept in your main checkout, out of the lane agent's reach.
- **Signing.** For the two commit operations only, your SSH or GPG agent socket stays available, so a key held by an agent can sign. No network operation exists to use it otherwise.

Each merge keeps a journal in `.yallaflow/local/execution/` (git-ignored). After a crash, the merge shows as interrupted. Continue merge re-validates every step before running it and never repeats a completed one. The result is recorded in `work/<id>/integration.yaml`. That record is committed and states that YallaFlow did not run CI.

**What this does not protect.**
- **Lane agents.** A lane's agent runs with your privileges in its own folder, and its tool requests go through the same approval prompts as any agent session.
- **Checks are not sandboxed.** The checks that run on the merged result are the commands you declared or ticked.
- **Declared checks run the merged code.** A declared check such as `npm test` runs the project's code at the merge commit, which you reviewed in the diff. That is the purpose of a check.
- **Agent Contract rules are guidance.** The rules against commits, merges and Git configuration changes in lanes guide the agent; YallaFlow does not rely on them. Whether the Codex sandbox lets a lane agent write the home repository's shared Git metadata is checked in the release's real-agent test.
- **Hooks are off.** Hooks are turned off for YallaFlow's own Git calls, so declare as merge checks anything your hooks or CI enforce.
- **Outside Git commands.** A Git command run by another program in the same repository during a merge is detected by the before-and-after checks and stops the merge. It is not prevented.
- **Small timing gaps.** One gap is between the last listing of a lane and its removal. Another is between YallaFlow writing its records and committing them. Both are milliseconds, and the agent is stopped in both.
- **Static scanning.** Test 51's static scan of the source for Git calls cannot follow values across files. The runtime boundary is `git-ops.js` itself.

## What YallaFlow does not enforce

- **Write authorization is guidance.** `guide` reports whether the workflow authorizes application-code changes, and the agent contract tells agents to obey it. YallaFlow cannot stop an agent or person from editing files directly.
- **`verify` is not a sandbox.** Argv, `--shell`, and `--script` modes run the command in your environment with your privileges. Only run commands you would run yourself. Argv mode avoids shell interpretation, not side effects.
- **Shared Projects have no permissions system.** Roles are not modeled and the integration branch is a policy, not access control; use your Git hosting's branch protection and review rules.
- **Baseline approval is conversational.** The agent records the developer's explicit approval with their words in `--note`; the contract forbids approving on its own judgment, but YallaFlow cannot verify who typed the reply.
- **Approvals are workflow evidence, not authentication.** Anyone who can run the CLI can `approve` a gate. Use your code-review and branch-protection process for real authorization.
- **Evidence proves what was recorded, not that a claim is true.** A passing run proves the command exited 0; a cited file proves it existed with that content. YallaFlow never judges whether prose, summaries, or knowledge are correct.
- **QC results and demos are recorded claims.** YallaFlow enforces that a `passed` scenario carries executed steps and evidence, and it hashes the artifacts, but it does not watch the browser: an agent-driven result is the agent's report, labelled as such. Strict-policy quality approval is a recorded signal, not a deployment lock.
- **Imported ticket text can try to instruct the agent.** It is bannered as untrusted and the contract tells the agent never to follow it; YallaFlow cannot prevent an agent from obeying it.
- **Direct edits bypass validation.** Hand-editing files under `.yallaflow/` skips the CLI's checks; `doctor` catches many, not all, resulting inconsistencies.

## Dependencies

Office and PDF extraction use third-party parsers. Known advisories and their mitigations are tracked in [`releasing.md`](releasing.md#known-residual-security-considerations). At 1.0.0 `npm audit` reports one moderate advisory (`file-type`, GHSA-5v7r-6r5c-r473, as 2 entries: `file-type` and `officeparser`, which depends on it); it is mitigated, not resolved — files reach `officeparser` only after YallaFlow's own format detection has accepted an Office/OpenDocument signature. The four runtime dependencies are all for source intake; none performs network access in YallaFlow's use. `--fetch` uses Node's built-in `fetch`; no dependency was added for it, and Playwright is never a YallaFlow dependency — the agent uses the project's or its own Playwright installation.
