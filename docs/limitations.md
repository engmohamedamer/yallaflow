# Current Limitations (v0.3.8)

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

- **No semantic judgment.** YallaFlow never detects duplicate or contradictory prose. The agent must declare `--reconfirms`, `--supersedes`, or `--disputes` — and, for legacy knowledge, an explicit reconciliation action per candidate. The only automatic comparison is exact textual identity (`exactDuplicateOf`), which is reported, never acted on.
- **Reconciliation is manual by design.** Every legacy candidate needs an Agent decision and a human review; a large v0.3.5 workspace takes real reviewing effort. Undecided candidates can wait, but their legacy sections stay until reconciled.
- **Reconciled legacy facts have `UNKNOWN` freshness.** Their original verification point is unknown; reconfirm them with fresh evidence through normal work.
- **Hand-edited legacy sections are never removed automatically.** After reconciliation they remain outside the managed block until a human removes them (`doctor` warns).
- **State ownership is not enforced by locks.** Agents are told not to edit CLI-owned files, and `doctor` detects what is deterministic (schemas, fingerprints, drift, checksums, the `work.md` Routing Decision); free-form edits to narrative text are not detectable, by design.
- **Freshness is mechanical and coarse.** Only repository evidence has a verification point; runtime and user-confirmed facts show `UNKNOWN`. Any change under a cited directory marks the fact `MAY_BE_STALE`.
- **Limitation detection is exact-text only.** A limitation reworded as a fact is not caught.
- **No baseline refresh.** Only one approved baseline per workspace; living memory keeps it current.
- **Ledger and Markdown projection are not one transaction.** A rendering failure leaves canonical knowledge intact; `yallaflow context render` repairs the Markdown.
- **No knowledge graph, embeddings, or search.** The ledger is a small local file.

## Delivery convergence

- **Convergence is the Agent's judgment.** YallaFlow validates that every finding names a real, active criterion, carries a reason and evidence, and that `satisfied` rests on more than free text; it cannot tell whether the judgment is right. Review the assessment like any other engineering claim.
- **Applies to feature work and architectural changes only.** Bounded changes, bugs, refactors, releases, investigations, and work routed before v0.3.8 have no requirement identity, convergence, or impact gate — by design.
- **Staleness is mechanical.** A repository file cited as evidence that changes (any byte) makes the finding stale, even when the change is unrelated to the criterion; directory evidence uses Git diff. Runtime, user, and reference evidence cannot go stale mechanically.
- **Impact is raised for two events only:** a source attached, or requirements changed, after the intent checkpoint was completed. A change of intent communicated only in conversation is invisible to YallaFlow until the Agent records it.
- **One pending impact at a time.** Further triggers join it; it is assessed as a whole.
- **Decomposed children do not receive their parent's impacts.** A parent revising a criterion a child answers for makes the child's finding stale (reported, and DONE is blocked for a child not yet DONE); the parent owns the impact assessment.
- **No human review gate for convergence.** Convergence is a hard correctness gate; there is no optional `approve --stage convergence` in this release.

## Agent bootstrap

- **Two providers.** `agent setup` supports Codex (`AGENTS.md`) and Claude (`CLAUDE.md`). Other agents can follow `.yallaflow/AGENT.md` directly.
- **Instruction files only.** No hooks, plugins, or settings files are written; whether a session actually reads the bootstrap file is up to the agent product.
- **Mixed versions.** A v0.3.7 CLI does not know the delivery gate and can complete v0.3.8-routed feature work without convergence (v0.3.8's `doctor` then reports it). Upgrade everyone together.

## Upgrades

- **`AGENT.md` refresh is manual.** Existing workspaces keep their old agent guidance until `yallaflow agent refresh` is run (`yallaflow upgrade status` reports it). The same holds for provider bootstrap blocks.
- **No automatic upgrade.** `upgrade status|plan` only report; each step is a deliberate command.
- **No downgrades or mixed versions** once a newer version has written to a workspace ([upgrading-to-v0.3.8.md](upgrading-to-v0.3.8.md#mixed-versions-and-downgrades), [upgrading-to-v0.3.7.md](upgrading-to-v0.3.7.md#mixed-versions-and-downgrades)).
- **Legacy `.projectflow/` workspaces** are not migrated automatically, and the `PF-####` work ID format is unchanged.
