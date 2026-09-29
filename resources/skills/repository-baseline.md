# Repository Baseline Discovery

## Purpose

Build a durable, evidence-backed understanding of an existing (brownfield) repository once, so a future agent session can read it instead of rediscovering the project from scratch.

## Behavior

0. Start from `yallaflow inspect`: a bounded, read-only inventory of manifests (with deterministic framework/version hints), recognized source files, documentation candidates, and container/CI configuration. It is an orientation aid, not evidence of behavior — confirm what matters in the files themselves.
1. Inspect the repository and, where safely observable, the local runtime: tech stack, architecture and module boundaries, database, authentication/authorization, integrations, environments (including whether Docker/CI tooling is present and reachable — never start or stop services merely to baseline the project), testing setup, engineering conventions, and business rules directly evidenced in code, tests, or the database.
2. Record each fact with an explicit confidence level:
   - **confirmed** — directly supported by repository or runtime evidence.
   - **inferred** — a strong interpretation supported by evidence, not explicitly declared.
   - **unresolved** — cannot safely be established from available evidence; report the gap, do not guess.
3. Attach concrete evidence references to every fact. Prefer repository paths that exist (`config/db.php`, `config/db.php#components`, `src/Order.php:40-80`) — YallaFlow records their location, a content hash, and the current Git commit so later changes can be detected mechanically. Use `runtime:<observation>` for runtime evidence and `user:<confirmation>` for facts a user confirmed. Prior conversation or model memory is never evidence by itself.
4. Separate project facts from discovery limitations. "The lockfile was not deeply inspected", "JS indentation was not sampled", or "production schema was not reachable" describe this discovery session, not the project. Record them under the draft's `limitations` array (`type`: not-inspected, unavailable, out-of-scope, runtime-unavailable, insufficient-evidence; plus `area`, `summary`, `reason`) — never as `unresolved` facts. `unresolved` is for a genuine project question the evidence cannot settle (e.g. "production hosting provider cannot be established").
5. Review the documentation candidates the inventory lists and read the ones material to understanding the project (architecture/design documents, requirement specifications, integration guides, user manuals). For a PDF, DOCX, XLSX, or PPTX you cannot read directly, register it with `yallaflow intake add <baseline-work-id> <path>` and read the extracted text with `yallaflow source show SRC-#### --content`; formats marked preserve-only have no extracted text. Cite a document inside the repository by its path (repository evidence). A document is evidence of what it says, not proof of what the code does — confirm against code or runtime where you can. Record material documents you did not read as `not-inspected` limitations.
6. Record durable truth, not transient runtime state. Declared configuration (a compose file's services, a CI pipeline's stages, configured ports) can be a fact; what happens to be running now (containers up, open ports, the current branch, process lists, tokens, machine-specific absolute paths) is not — keep such observations in work notes or limitations.
7. Freshness is mechanical and works without Git: repository file evidence is re-checked by SHA-256 content hash (a changed file becomes MAY_BE_STALE, a missing one STALE_EVIDENCE); directory evidence needs a Git commit and is otherwise UNKNOWN, which is not stale. Prefer file evidence for facts that should stay checkable.
8. Only record business rules that are directly evidenced in code, tests, or the database, or explicitly confirmed by the user — never inferred solely from a class or variable name.
9. Only ask the user for information that genuinely cannot be established from the repository or runtime.

## Guard

This skill is read-only for application code: no application code modification is authorized while establishing the baseline. The onboarding YallaFlow writes — `baseline start`, `intake add` for material documents, this checkpoint, and `baseline draft` — are authorized when the user asked to understand or onboard the project; if the user asked for a completely read-only / no-write operation, make none of them. Never approve the baseline: a human runs `yallaflow baseline approve`.

## Result

Produce a structured baseline draft (grouped by area, each fact carrying its confidence level, evidence, and provenance, plus any discovery limitations) ready for human review. On approval each fact becomes a canonical project-context fact (`CTX-####` in `.yallaflow/context/index.yaml`) projected into `PROJECT.md`/`context/*.md`; limitations stay with the baseline work item. The baseline is the initial foundation only — later work keeps project memory current by reconfirming, superseding, or disputing facts, not by re-running the baseline.
