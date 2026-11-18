# Projects page — final UX polish review (owner, 2026-11-17)

Direction approved; final focused polish before acceptance:
1. Eliminate excessive empty card space; compact, content-driven card heights instead of stretching to the tallest card in the row; keep layout balanced.
2. Remove duplicate empty-work messages; one clear message such as "All tasks completed" when appropriate.
3. Audit project work statistics; the highlighted task must genuinely be the correct current open work item.
4. Distinguish an open work item from an agent-associated historical task.
5. Clarify filter labels; determine whether counts overlap; avoid wording implying an agent is running when only open tasks exist.
6. Distinguish running, paused/resumable and historical agent sessions accurately.
7. Verify the Continue Task action navigates to the correct task context.
8. Verify dropdown behavior, keyboard accessibility and remove-project confirmation.
9. Review Arabic RTL alignment, English labels and responsive card layout.
Constraints: keep the visual design and Tailwind styling; no new dashboard features; preserve data, security and functionality; focused regression tests; verify real browser interactions; before/after screenshots desktop+mobile; no commit, push, tag, publish or global reinstall.
