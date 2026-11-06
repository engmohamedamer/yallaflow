# Owner decisions on the acceptance proposal (2026-11-06, agent session) — verbatim summary

1. Approved for 1.2.0: graceful handling of invalid work items, improved Doctor diagnostics for probable
   merge-related ID collisions, corrected empty, completed and paused project experiences. Preserve all
   existing records and evidence. Invalid items remain visible as integrity warnings and are never counted
   as valid or proven work.
2. Approved: Create Work in 1.2.0. "I explicitly approve revising Q-003 from a strictly read-only Console
   to a Console with one narrowly scoped, authenticated Create Work capability." Other Console mutations,
   approvals, agent execution and chat stay out of scope. UX: choose project; natural-language
   requirement; optionally select work type and scope; let the agent classify later without inventing a
   classification; attach a supported BRD/requirement file; create through existing Core commands;
   immediately show the created item and its real next valid action. Simple; no repeated command buttons
   or unnecessary fields.
3. Approved in principle: creating from the Console must not replace an existing active task. Design the
   smallest backward-compatible Core option for creating an item without activating it; existing CLI
   behavior unchanged. Do not automatically switch active work merely because another agent records
   progress on the new item; activation must have explicit, well-defined semantics.
4. Security/reliability: every write through Core validation and the workspace lock; no shell
   interpolation of user input; Host, Origin, authentication and authorization checks enforced; upload
   limits aligned with existing intake constraints; temporary files cleaned up safely; failed attachments
   reported without hiding a successfully created item; retries cannot silently create duplicates;
   Console actions recorded with accurate, unverified local-user provenance; read-only mode disables all
   mutations.
5. Vult: do not enable Shared Project mode or modify Vult; provide a read-only compatibility/preflight
   assessment first. Existing merged-ID corruption stays untouched until a separate repair design with
   backup and rollback is approved.
6. Route through YallaFlow; small testable steps; regression coverage for Vult's mixed-ledger case,
   zero-item projects, active-work preservation, upload failure, concurrent creation, retry behavior and
   Console security; full suite and browser tests; report results and screenshots, then STOP. No commit,
   tag, push, publish or Vult repair without further approval.
