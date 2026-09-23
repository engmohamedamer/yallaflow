# Current Limitations (v0.3.6)

Known gaps and deliberate boundaries. Planned work is tracked in [`roadmap.md`](roadmap.md).

## Scope and distribution

- **Internal prerelease.** Not published to npm; install from a tarball or checkout.
- **Single-user, local-first.** No team mode, locking, or multi-user ownership. Concurrent edits to `.yallaflow/` from different branches are reconciled only by Git merge.
- **Platform coverage.** The regression suite runs in POSIX environments; Windows has not been verified in this release.

## Intake

- **No tracker, email, or message adapters.** Intake is plain text or local files.
- **No OCR or vision.** Images and scanned PDFs are preserved as sources, but no text is extracted.
- **PDF reading order** follows the content stream and may differ from visual order, notably for right-to-left scripts. `.odg`/`.epub` text extraction is not implemented.

## Workflow

- **YallaFlow does not run your agent.** It governs state; reasoning, code edits, and classification are the agent's. Write authorization is guidance the agent must follow.
- **Direct commands require `--scope`.** YallaFlow never guesses scope; use `yallaflow start` to let the agent classify.
- **Investigations cannot be reopened.** New proof after an investigation is DONE belongs in a new work item.
- **No execution engine yet.** Execution contracts and reviewed/multi-agent execution policies are future work.

## Project memory

- **No semantic judgment.** YallaFlow never detects duplicate or contradictory prose. The agent must declare `--reconfirms`, `--supersedes`, or `--disputes`.
- **Freshness is mechanical and coarse.** Only repository evidence has a verification point; runtime and user-confirmed facts show `UNKNOWN`. Any change under a cited directory marks the fact `MAY_BE_STALE`.
- **Limitation detection is exact-text only.** A limitation reworded as a fact is not caught.
- **No baseline refresh.** Only one approved baseline per workspace; living memory keeps it current.
- **Ledger and Markdown projection are not one transaction.** A rendering failure leaves canonical knowledge intact; `yallaflow context render` repairs the Markdown.
- **No knowledge graph, embeddings, or search.** The ledger is a small local file.

## Upgrades

- **`AGENT.md` refresh is manual.** Existing workspaces keep their old agent guidance until `yallaflow agent refresh` is run.
- **No downgrades or mixed versions** once v0.3.6 has written to a workspace ([upgrading-to-v0.3.6.md](upgrading-to-v0.3.6.md#mixed-versions-and-downgrades)).
- **Legacy `.projectflow/` workspaces** are not migrated automatically, and the `PF-####` work ID format is unchanged.
