# Legacy Context Reconciliation

## Purpose

Turn legacy (v0.3.5 append-only) durable project knowledge into canonical current project memory without duplicating, silently dropping, or blindly trusting it. Migration is not reconciliation: importing old statements is mechanical; deciding how each one relates to current project knowledge is an engineering judgement that must be explicit and reviewable.

The Agent reasons. YallaFlow validates and applies. A human reviews before anything becomes current truth.

## Behavior

1. Read the candidates: `yallaflow context reconcile show <work-id>` (add `--candidate RC-####` for full detail). Each `RC-####` preserves its original work item, BF/K identifier, area, wording, confidence, evidence, and legacy Markdown location. Also read the current canonical facts that may overlap: `yallaflow context list` / `yallaflow context show CTX-####`.
2. For every candidate, decide one explicit relationship, based on the recorded evidence (and, where needed, targeted re-inspection of the cited repository paths) — never on wording similarity alone:
   - **new** — a durable fact not already represented. It becomes one CTX fact. You may give a clearer canonical `summary` (and correct the `area`); the original wording stays in the historical record.
   - **merge-with** `RC-####` — collapse legacy candidates that state the same durable fact into one canonical fact (e.g. PF-0001 BF-013 and PF-0002 K-002 both describing the enabled root Codeception suites). The target is always another candidate; cross-area merges are allowed for a misfiled duplicate. History records `merged`.
   - **reconfirms** `CTX-####|RC-####` — this legacy item is one more historical observation of a truth that is already represented: an existing canonical fact, or the fact another candidate produces. It must be the same kind (area) of knowledge. It adds provenance only — the existing fact's evidence and verification point do not change. History records `reconfirmed`.
   - Choosing between them: several legacy items that *are the same statement* → `merge-with` (one of them, usually decided `new` with the clearest wording, is the target). A legacy item that *confirms a truth you can already point to* → `reconfirms`. To relate a candidate to an existing CTX fact, use `reconfirms`, `supersedes`, or `disputes` — never `merge-with`.
   - **supersedes** `RC-####|CTX-####` — newer truth that replaces the target; the target becomes history, lineage is kept.
   - **disputes** `RC-####|CTX-####` — evidence genuinely conflicts and you cannot settle it; the target is marked disputed, not overwritten.
   - **skip** — deliberately not migrated (execution noise, an outdated transient observation, or already represented). A `reason` is required.
   - **limitation** — the legacy item was really a discovery limitation ("lockfile was not inspected"), not project truth. Give `limitationType` (not-inspected, unavailable, out-of-scope, runtime-unavailable, insufficient-evidence, uncaptured-artifact); it is kept as a work-scoped limitation, never promoted.
3. A refinement (a later candidate that states the same truth in more detail) usually **reconfirms** the earlier one, with the more precise wording set as the canonical `summary` on the earlier candidate's `new` decision — or **supersedes** it when the earlier statement is no longer accurate. Say which in the `reason`.
4. Exact duplicates are flagged for you (`exactDuplicateOf`: same area, normalized text, and evidence). They still need an explicit decision — normally `merge-with`. Nothing is discarded automatically. `sameStatementAs CTX-####` flags identical wording to an existing fact; it is a hint, not a conclusion.
5. When you cannot safely decide whether two items are the same fact, separate facts, a supersession, or a contradiction: do not guess. Leave the candidate undecided and record the ambiguity with `yallaflow question add <work-id> --category architecture --text "RC-0012 vs RC-0041: ..."`. Undecided candidates never block the rest — an approved subset can be applied and the remaining ones decided later.
6. Record decisions with `yallaflow context reconcile plan <work-id> --file decisions.json`:

   ```json
   {
     "decisions": [
       { "candidate": "RC-0013", "action": "new", "summary": "Root codeception.yml enables only the api and apps suites." },
       { "candidate": "RC-0053", "action": "merge-with", "target": "RC-0013", "reason": "Both describe the enabled root Codeception suites." },
       { "candidate": "RC-0044", "action": "supersedes", "target": "CTX-0001", "reason": "..." },
       { "candidate": "RC-0050", "action": "limitation", "limitationType": "not-inspected", "reason": "Describes the discovery session, not the project." },
       { "candidate": "RC-0007", "action": "skip", "reason": "Transient execution observation." }
     ]
   }
   ```

   Files may be partial; decisions are upserted by candidate, and `"action": "pending"` clears one. Every change after approval invalidates it.
7. Preview the resulting current project memory with `yallaflow context reconcile preview <work-id>` before asking for review, then complete this checkpoint and ask a human to review (`yallaflow context reconcile approve <work-id>` or `feedback --changes-requested`). Apply only an approved plan: `yallaflow context reconcile apply <work-id>`.

## Guard

Read-only. Never edit historical work items (baseline.yaml, knowledge.yaml, work.md of earlier work) to make the migration cleaner, never edit `reconciliation.yaml` or `context/index.yaml` directly, and never approve your own plan on the human's behalf.

## Result

An approved, applied reconciliation plan: one canonical current fact per durable truth, every historical origin traceable (`yallaflow context show CTX-####`), superseded and disputed knowledge kept as lineage, skipped items and limitations recorded with reasons, and the retired legacy Markdown sections archived verbatim with this work item.
