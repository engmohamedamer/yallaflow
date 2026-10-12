# Security and Trust Model

This describes what YallaFlow does and does not protect, so you can decide what belongs in `.yallaflow/`. To report a vulnerability, see [`SECURITY.md`](../SECURITY.md).

## What YallaFlow is

A local CLI that reads and writes files under `.yallaflow/` in your repository, reads repository files you cite as evidence, and runs commands you ask it to run through `yallaflow verify`. It runs with your user's privileges.

## Guarantees

- **No network access and no model calls.** YallaFlow makes no network requests, calls no AI provider, and sends no telemetry. Your coding agent is a separate program with its own data handling.
- **Untrusted input files are not executed.** File intake never runs macros, embedded scripts, or OLE objects; never fetches external links; never unpacks archives; applies size and entry-count limits to zip-based formats; and keeps every stored file name inside its own source directory. Format is detected from content, not trusted from the extension.
- **No source-control mutation.** YallaFlow never commits, pushes, pulls, fetches, rebases, or merges. Its Git use is local and read-only (`rev-parse`, `diff`, `status`, `ls-files`, `check-ignore`, `symbolic-ref`, `config`). `yallaflow shared check` is safe in CI: read-only, no network, no model call.
- **Help never mutates state.** `--help`/`-h` on any command is read-only.
- **Reads never migrate.** Inspection commands (`status`, `guide`, `resume`, `handoff`, `doctor`, `context status`, `agent status`, …) do not change files.
- **Evidence references record location, not content.** A repository path cited as evidence is stored as path + SHA-256 hash + Git commit. File contents are never copied into the project-context ledger.
- **Secret values are redacted before they are persisted (internal.4).** One sanitizer (`src/security/redact.js`) runs at YallaFlow's persistence boundary — every structured state file, the project-context ledger and its projection, work records (`work.md`, `progress.md`), generated ADRs, verification logs and command lines, and extracted source text. It replaces the *value* of recognizable secrets and keeps the name: secret-named assignments (`DB_PASSWORD=…`, `"api_key": "…"`, `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, …), `Authorization`/`Bearer`/`Basic` values, cookies, PEM private keys, credentials embedded in URLs, and well-known token formats (GitHub, GitLab, Slack, AWS, Google, Stripe, npm, `sk-…`, JWTs). `DB_PASSWORD=real-secret` is stored as `DB_PASSWORD=<redacted>`; the path `.env` stays valid evidence. It is conservative and pattern-based: it does not modify your files, and it cannot recognize a secret with no recognizable name or format.
- **Tamper detection, not tamper proofing.** `doctor` detects a source whose preserved original no longer matches its capture checksum, broken project-memory lineage, projection drift, and lifecycle contradictions. Nothing is cryptographically signed; Git history is the audit trail.

## What is stored, and where

| Data | Location | Sensitivity note |
|---|---|---|
| Captured sources | `.yallaflow/sources/SRC-####/` — the original file byte-for-byte, extracted text, and (for text files) the text in `source.json` | **The preserved original keeps its full contents byte-for-byte** (YallaFlow never alters it); extracted text and `source.json` text are redacted, and `intake` warns when a captured original appears to contain secret values. Do not capture files that contain credentials or personal data you would not commit. |
| Verification logs | `.yallaflow/work/<id>/evidence/V-###-verification.log` | Everything the command printed to stdout/stderr, with recognizable secret values redacted. Still avoid commands that print secrets. |
| Summaries, rulings, questions, knowledge, baseline facts | `work/<id>/*.yaml`, `context/index.yaml`, `*.md` | Written by your agent; recognizable secret values are redacted. Review before committing. |
| Command lines | `verification.json` | The command recorded for each run, with recognizable secret values redacted (the command itself runs unchanged). Avoid secrets in arguments. |

| Actor metadata (Shared Projects) | `work/<id>/memory.yaml` | `git config user.name` / `user.email` at work creation and staging — the same values your commits publish. No accounts, roles, or tokens. |
| Local identity (Shared Projects) | `.yallaflow/local/identity.yaml` (gitignored) | A random clone tag, a one-way fingerprint of the checkout path (never the path), a timestamp, and the last allocated sequence. Never committed; `doctor` fails if it is tracked. |

`.yallaflow/` is designed to be committed. Treat it with the same care as the rest of the repository: anything captured there is shared with everyone who can read the repository and its history.

YallaFlow has no secrets store. Credential integration for trackers or providers is intentionally not implemented. Redaction applies to what is written from internal.4 on; state an earlier release already wrote is not rewritten (the projection never repeats a recognizable secret value, though).

## What YallaFlow does not enforce

- **Write authorization is guidance.** `guide` reports whether the workflow authorizes application-code changes, and the agent contract tells agents to obey it. YallaFlow cannot stop an agent or person from editing files directly.
- **`verify` is not a sandbox.** Argv, `--shell`, and `--script` modes run the command in your environment with your privileges. Only run commands you would run yourself. Argv mode avoids shell interpretation, not side effects.
- **Shared Projects have no permissions system.** Roles are not modeled and the integration branch is a policy, not access control; use your Git hosting's branch protection and review rules.
- **Baseline approval is conversational.** The agent records the developer's explicit approval with their words in `--note`; the contract forbids approving on its own judgment, but YallaFlow cannot verify who typed the reply.
- **Approvals are workflow evidence, not authentication.** Anyone who can run the CLI can `approve` a gate. Use your code-review and branch-protection process for real authorization.
- **Evidence proves what was recorded, not that a claim is true.** A passing run proves the command exited 0; a cited file proves it existed with that content. YallaFlow never judges whether prose, summaries, or knowledge are correct.
- **Direct edits bypass validation.** Hand-editing files under `.yallaflow/` skips the CLI's checks; `doctor` catches many, not all, resulting inconsistencies.

## Dependencies

Office and PDF extraction use third-party parsers. Known advisories and their mitigations are tracked in [`releasing.md`](releasing.md#known-residual-security-considerations) (for example, a moderate `file-type` advisory reachable only through `officeparser`, mitigated by YallaFlow's own format detection).
