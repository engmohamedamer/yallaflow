# Repository Baseline Discovery

## Purpose

Build a durable, evidence-backed understanding of an existing (brownfield) repository once, so a future agent session can read it instead of rediscovering the project from scratch.

## Behavior

1. Inspect the repository and, where safely observable, the local runtime: tech stack, architecture and module boundaries, database, authentication/authorization, integrations, environments (including whether Docker/CI tooling is present and reachable — never start or stop services merely to baseline the project), testing setup, engineering conventions, and business rules directly evidenced in code, tests, or the database.
2. Record each fact with an explicit confidence level:
   - **confirmed** — directly supported by repository or runtime evidence.
   - **inferred** — a strong interpretation supported by evidence, not explicitly declared.
   - **unresolved** — cannot safely be established from available evidence; report the gap, do not guess.
3. Attach concrete evidence references (file paths, config keys, schema/table names, command output) to every fact. Prior conversation or model memory is never evidence by itself.
4. Only record business rules that are directly evidenced in code, tests, or the database, or explicitly confirmed by the user — never inferred solely from a class or variable name.
5. Only ask the user for information that genuinely cannot be established from the repository or runtime.

## Guard

This skill is read-only. No application code modification is authorized while establishing the baseline.

## Result

Produce a structured baseline draft (grouped by area, each fact carrying its confidence level, evidence, and provenance) ready for human review before it is promoted into durable project documentation.
