# Repository Baseline Discovery

## Purpose

Build a durable, evidence-backed understanding of an existing (brownfield) repository once, so a future agent session can read it instead of rediscovering the project from scratch.

## Behavior

1. Inspect the repository and, where safely observable, the local runtime: tech stack, architecture and module boundaries, database, authentication/authorization, integrations, environments (including whether Docker/CI tooling is present and reachable — never start or stop services merely to baseline the project), testing setup, engineering conventions, and business rules directly evidenced in code, tests, or the database.
2. Record each fact with an explicit confidence level:
   - **confirmed** — directly supported by repository or runtime evidence.
   - **inferred** — a strong interpretation supported by evidence, not explicitly declared.
   - **unresolved** — cannot safely be established from available evidence; report the gap, do not guess.
3. Attach concrete evidence references to every fact. Prefer repository paths that exist (`config/db.php`, `config/db.php#components`, `src/Order.php:40-80`) — YallaFlow records their location, a content hash, and the current Git commit so later changes can be detected mechanically. Use `runtime:<observation>` for runtime evidence and `user:<confirmation>` for facts a user confirmed. Prior conversation or model memory is never evidence by itself.
4. Separate project facts from discovery limitations. "The lockfile was not deeply inspected", "JS indentation was not sampled", or "production schema was not reachable" describe this discovery session, not the project. Record them under the draft's `limitations` array (`type`: not-inspected, unavailable, out-of-scope, runtime-unavailable, insufficient-evidence; plus `area`, `summary`, `reason`) — never as `unresolved` facts. `unresolved` is for a genuine project question the evidence cannot settle (e.g. "production hosting provider cannot be established").
5. Only record business rules that are directly evidenced in code, tests, or the database, or explicitly confirmed by the user — never inferred solely from a class or variable name.
6. Only ask the user for information that genuinely cannot be established from the repository or runtime.

## Guard

This skill is read-only. No application code modification is authorized while establishing the baseline.

## Result

Produce a structured baseline draft (grouped by area, each fact carrying its confidence level, evidence, and provenance, plus any discovery limitations) ready for human review. On approval each fact becomes a canonical project-context fact (`CTX-####` in `.yallaflow/context/index.yaml`) projected into `PROJECT.md`/`context/*.md`; limitations stay with the baseline work item. The baseline is the initial foundation only — later work keeps project memory current by reconfirming, superseding, or disputing facts, not by re-running the baseline.
