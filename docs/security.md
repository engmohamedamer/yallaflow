# Security and Trust Model

This describes what YallaFlow does and does not protect, so you can decide what belongs in `.yallaflow/`. To report a vulnerability, see [`SECURITY.md`](../SECURITY.md).

## What YallaFlow is

A local CLI that reads and writes files under `.yallaflow/` in your repository, reads repository files you cite as evidence, and runs commands you ask it to run through `yallaflow verify`. It runs with your user's privileges.

## Guarantees

- **No network access and no model calls.** YallaFlow makes no network requests, calls no AI provider, and sends no telemetry. Your coding agent is a separate program with its own data handling.
- **Untrusted input files are not executed.** File intake never runs macros, embedded scripts, or OLE objects; never fetches external links; never unpacks archives; applies size and entry-count limits to zip-based formats; and keeps every stored file name inside its own source directory. Format is detected from content, not trusted from the extension.
- **Help never mutates state.** `--help`/`-h` on any command is read-only.
- **Reads never migrate.** Inspection commands (`status`, `guide`, `resume`, `handoff`, `doctor`, `context status`, `agent status`, …) do not change files.
- **Evidence references record location, not content.** A repository path cited as evidence is stored as path + SHA-256 hash + Git commit. File contents are never copied into the project-context ledger.
- **Tamper detection, not tamper proofing.** `doctor` detects a source whose preserved original no longer matches its capture checksum, broken project-memory lineage, projection drift, and lifecycle contradictions. Nothing is cryptographically signed; Git history is the audit trail.

## What is stored, and where

| Data | Location | Sensitivity note |
|---|---|---|
| Captured sources | `.yallaflow/sources/SRC-####/` — the original file byte-for-byte, extracted text, and (for text files) the text in `source.json` | **Full contents are stored.** Do not capture files that contain credentials or personal data you would not commit. |
| Verification logs | `.yallaflow/work/<id>/evidence/V-###-verification.log` | Everything the command printed to stdout/stderr. Do not verify with commands that print secrets. |
| Summaries, rulings, questions, knowledge | `work/<id>/*.yaml`, `context/index.yaml`, `*.md` | Written by your agent; review before committing. |
| Command lines | `verification.json` | The exact command recorded for each run. Avoid secrets in arguments. |

`.yallaflow/` is designed to be committed. Treat it with the same care as the rest of the repository: anything captured there is shared with everyone who can read the repository and its history.

YallaFlow has no secrets store. Credential integration for trackers or providers is intentionally not implemented.

## What YallaFlow does not enforce

- **Write authorization is guidance.** `guide` reports whether the workflow authorizes application-code changes, and the agent contract tells agents to obey it. YallaFlow cannot stop an agent or person from editing files directly.
- **`verify` is not a sandbox.** Argv, `--shell`, and `--script` modes run the command in your environment with your privileges. Only run commands you would run yourself. Argv mode avoids shell interpretation, not side effects.
- **Approvals are workflow evidence, not authentication.** Anyone who can run the CLI can `approve` a gate. Use your code-review and branch-protection process for real authorization.
- **Evidence proves what was recorded, not that a claim is true.** A passing run proves the command exited 0; a cited file proves it existed with that content. YallaFlow never judges whether prose, summaries, or knowledge are correct.
- **Direct edits bypass validation.** Hand-editing files under `.yallaflow/` skips the CLI's checks; `doctor` catches many, not all, resulting inconsistencies.

## Dependencies

Office and PDF extraction use third-party parsers. Known advisories and their mitigations are tracked in [`releasing.md`](releasing.md#known-residual-security-considerations) (for example, a moderate `file-type` advisory reachable only through `officeparser`, mitigated by YallaFlow's own format detection).
