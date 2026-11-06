# Owner decision: Agent Bridge feasibility phase (2026-11-06, agent session)

Agrees an ACP-first thin Agent Bridge is the preferred direction. Provisionally approves D2, D3, D4, D5, D6
subject to constraints. Does NOT approve production implementation. Requires a focused feasibility phase first.

Constraints: ACP preferred with capability detection and a clear fallback when a provider lacks an essential
capability; bridge inside the existing local Console unless experiments show a real need for isolation; only ONE
active managed agent session per checkout regardless of work item; Core authoritative for workflow state,
approvals, evidence; agent tool permissions separate from YallaFlow spec/review approvals; never auto-activate
work without an explicit user decision; adapters optional, user-installed, version-checked; never store or
expose provider credentials, tokens or sensitive raw session data; localhost auth and explicit opt-in; no
bypass-permissions mode; default-deny unanswered permissions, including on browser disconnect.

Authentication: Anthropic subscription auth is unresolved for third-party products. Document a compliant
API-key path; separately identify what written clarification is needed for use of the unmodified Claude Code
binary. A successful local login does not prove a distributed integration is permitted. Codex: validate the
user's own supported local authentication.

PoC: minimal, isolated, real ACP adapters, both providers where authorized: 1 session creation + streaming,
2 follow-up messages, 3 real tool permission requests with Allow/Deny, 4 cancellation, 5 resume after bridge
restart, 6 error recovery and connection loss, 7 an explicit YallaFlow activation and workflow update.
Temporary disposable repository only. Before consuming paid model usage: report expected credentials, billing
method and estimated upper cost, and request explicit approval for that spending.

Deliverable: side-by-side Claude/Codex capability matrix (verified, failed, uncertain) and a Go/No-Go
recommendation. Do not change the v1.2.0 release candidate, implement the production feature, commit, tag,
push or publish. Stop after the PoC report and request approval for the implementation plan.
