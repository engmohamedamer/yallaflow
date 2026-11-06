# YallaFlow 1.2.0 — Real-Project Acceptance Findings (owner, 2026-11-06, agent session)

Tested the Release Candidate on three projects: one existing project works; Vult API fails to load
("Progress ledger for PF-0091 uses registry v8, but its Behavior Contract uses registry v9."); a new
project opens but has no usable way to create a new work item from the Console.

1. Vult API compatibility failure — investigate exact cause; do not blindly rewrite registry versions,
   checkpoints, pinned contracts or evidence; propose the smallest safe auditable solution; one invalid
   work item should not necessarily prevent the whole project from displaying; distinguish project data
   errors from an offline Console.
2. Interactive New Work — select project; create feature/bug/change/investigation; natural-language
   requirement; optional BRD/requirement attachment; create through existing Core; show the item
   immediately in the Flow with its actual next valid action; keep continuing with Claude Code/Codex.
   No second work engine, no duplicated lifecycle rules, no auto-start of an agent. All mutations use
   Core validation, locking and audit. Review local API authorization and CSRF before enabling writes.
3. Empty project: helpful onboarding state, not an empty board with misleading 0%. Completed tracked
   work is distinct from completion of the whole software project. Do not show an inactive task as
   blocked or a project-data error as offline.
4. Preserve the Flow UI; clean, simple, polished; no Copy Command buttons everywhere; one clear Create
   Work action, contextual next steps, progressive disclosure.
