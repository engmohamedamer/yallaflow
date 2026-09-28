# Delivery Convergence

## Purpose

Establish, with evidence, whether the delivered implementation matches the approved intent. This is not verification (do the recorded technical checks pass?) and not code review (is the implementation technically acceptable?). Tests can pass while a requested behavior is missing, only partly built, or built differently than approved.

## Behavior

1. Start from the work item's structured intent: `yallaflow requirement list <work-id>`. The approved specification (or the clarified request) remains authoritative; the requirement ledger identifies what must be proven.
2. For every active acceptance criterion, inspect the implementation and its verification evidence, then decide one finding:
   - **satisfied** — implemented, and the evidence you cite demonstrates it;
   - **partial** — some, but not all, of the criterion is implemented;
   - **missing** — not implemented;
   - **contradicts** — the implementation behaves contrary to the criterion.
3. Give every finding a concrete reason and evidence: repository paths (`path`, `path#symbol`, `path:12-40`), `verification:V-###` runs, `runtime:`/`user:` observations, or — for a decomposed parent — a child's assessment (`convergence:PF-####/CV-###`). A satisfied finding needs more than free-text references.
4. Record implemented behavior that no active criterion requested as unrequested (`UR-###`), and resolve each one explicitly: `accepted` with a reason (a deliberate, necessary addition) or `removed` once it is taken out.
5. Record the assessment: `yallaflow convergence record <work-id> --file convergence.json`.

```json
{
  "summary": "Assessed after V-004 passed.",
  "findings": [
    { "criterion": "AC-001", "status": "satisfied", "reason": "Export endpoint returns the calendar as ICS.", "evidence": ["src/Export/CalendarExport.php#export", "verification:V-004"] },
    { "criterion": "AC-002", "status": "partial", "reason": "Refund creation exists but the required approval rule is not implemented.", "evidence": ["src/Services/RefundService.php#create"] }
  ],
  "unrequested": [
    { "summary": "Added a CSV export button.", "evidence": ["resources/views/calendar.blade.php"], "disposition": "open" }
  ]
}
```

Resolve every gap in the implementation, re-verify, and record a new assessment for the affected criteria. Assessments are append-only; do not try to hide an earlier finding.

## Staleness

A finding becomes stale — its history stays, its current reliability does not — when the work is reopened or revised after it, when its criterion is revised, when an impact assessment invalidates convergence, or when a repository file it cites changes. Re-assess stale criteria with fresh evidence. `yallaflow convergence status <work-id>` lists what blocks DONE.

## Guard

This skill judges intent and records evidence. It does not authorize unrelated implementation changes, replace verification or review, or let YallaFlow decide semantic meaning on its own.

## Result

Every active acceptance criterion currently satisfied with evidence, every unrequested behavior deliberately accepted or removed, and the `delivery-convergence` checkpoint completed.
