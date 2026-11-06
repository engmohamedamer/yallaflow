# Owner design decisions (2026-11-06) for the workspace evolution (from PF-0040 proposal)

1. Gate approvals from the web console: Yes, with confirmation (approve / request changes on review screens, explicit confirm dialog, recorded as a console approval with the note; never automatic, never from an agent session).
2. Hold / Close — owner's words: "I approve Option 1: both Hold/Resume and Close without delivery. However, please make these lifecycle semantics explicit before implementation:
   1. HOLD is temporary. It must preserve the current workflow stage, progress, requirements, and evidence. Resume returns to the same valid state.
   2. CLOSED is not DONE. Cancelled, superseded, or duplicate work must never be counted as delivered, verified, or completed.
   3. Prefer separating lifecycle status from workflow stage where appropriate, rather than adding an artificial delivery station to the Flow.
   4. Reopening a closed item must be explicit, audited, and subject to the existing Core validation rules.
   5. Preserve backward compatibility with all existing YallaFlow work records and CLI commands.
   6. UI actions must call canonical Core operations. No arbitrary drag-and-drop stage changes or bypassed review gates.
   7. Add regression tests for hold, resume, close, reopen, completion metrics, active work, and old project records.
   Record this as my explicit design decision and proceed through the approved YallaFlow workflow. Do not interpret it as approval to publish either release or bypass any remaining verification."
3. Runtime profile: committed and shared (.yallaflow/runtime.yaml), confirmed once per checkout before the first run.
4. Implement first: Work management + Project Overview (phase 1.4.0), on a feature branch with tests, without releasing.
