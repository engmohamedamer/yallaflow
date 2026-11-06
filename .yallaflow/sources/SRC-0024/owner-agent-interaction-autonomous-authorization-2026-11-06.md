# Owner authorization: Agent Interaction development phase (v1.3.0), autonomous (2026-11-06, agent session)

The owner approves proceeding with the Agent Interaction development phase based on the completed research and
the revised hybrid architecture, and authorizes autonomous work while away: implementation, integration, testing,
documentation and stabilization. Explicitly: "Recording this message as my explicit authorization for the defined
Agent Interaction scope", "Preparing specifications and implementation plans", "Implementing the approved
features", "Conducting independent code and security reviews", "Performing final regression tests", "Preparing a
release-readiness report". "Do not invent approvals for decisions not explicitly authorized here."

Non-negotiable: existing Claude Code / Codex subscription and authenticated local installation only; no API keys,
no API billing, no alternative accounts, no credential extraction or OAuth manipulation, no unsupported auth
workarounds, no silent fallback to paid API.
Architecture: Codex via ACP with the user's authenticated local Codex (native App Server as future fallback);
Claude Code via official Channels connecting to the user's own running unmodified session, with supported hooks for
activity and final-message observation; no Agent SDK, no claude -p, no third-party ACP adapters with subscription
auth; never launch or authenticate Claude through an unsupported path. Shared: thin Agent Bridge inside the
existing local Console; one unified Agent Workspace UI; provider capability detection; provider-neutral session
and event contracts; Core authoritative; no second workflow engine.
Protect 1.2.0: inspect git state; preserve the release candidate; isolated development workspace; never
overwrite/reset/stash/discard; do not modify the tarball; treat as v1.3.0; do not expand 1.2.0.
Permission investigation: minimal safe test in a disposable repository with Claude Code's normal default mode; if
it needs the owner, document and continue; fixtures/simulations for automated tests, labelled; never bypass.
Bridge capabilities: detect providers, check adapter compatibility, start managed Codex sessions, connect Claude
Channels sessions, send messages, receive responses, stream activity, permissions where supported, follow-ups,
cancel/interrupt and resume where supported, errors/disconnects/console restarts, accurate status.
UI: one coherent Agent Workspace (Select Project → Select/Create Work → Choose Agent → Connect/Start → Chat →
Track Execution → Review Results), project and work item, provider selection, subscription status, connection
state, chat and follow-ups, live activity, Allow/Deny where supported, visible permission mode and explicit warning
when the provider auto-approves, Stop/Start/Resume/Connect only when supported, errors and reconnection, workflow
state alongside, mobile/desktop/light/dark/Arabic/English; preserve Flow identity; no terminal clutter.
Workflow: never auto-activate; explicit activation before operations that need it; preserve CLI and agent
contracts; show the real next valid action; agents record progress via canonical commands; chat is not evidence;
tool permissions are not approval gates; never auto-approve specs, plans, delivery gates or releases; sessions
separate from work records; session metadata local and excluded from Git.
Security: explicit opt-in; localhost only; auth + Origin on every sensitive endpoint and stream; no credentials or
tokens in URLs, logs, or browser payloads; no bypass; default-deny unanswered permissions where enforceable; never
claim YallaFlow denied something the provider approved independently; one managed session per checkout; process
ownership and cleanup; managed execution restricted to the project checkout; protect against session-ID spoofing,
path traversal, command injection, unsafe reconnection; browser disconnect never approves; read-only console stays
read-only; never commit/push/merge/deploy/publish. Document provider-unenforceable limits.
Claude compliance: keep Claude interactive functionality experimental/disabled for normal distribution until
compliance is resolved; implement and test in isolation; finalize ANTHROPIC_REQUEST_DRAFT.md for review; never
contact Anthropic without approval.
Verification: tests for detection, ACP lifecycle, Channels, chat, streaming, permissions + timeout, auth/Origin,
isolation, one-session concurrency, activation, workspace boundary, cancel/resume, reconnection/restart, crashes,
unsupported capabilities, no-API-key auth, CLI back-compat, governance integrity, UI across browsers/languages; at
least one real Codex end-to-end walkthrough on the subscription; real Claude tests only where safe without new
human interaction; label real vs mocked; no API billing.
Deliverables 1-12 (architecture, features, matrix, screenshots, Codex walkthrough, Claude status and blockers,
security/concurrency, test results, blocked items, limitations, local trial instructions, Go/No-Go).
Stop conditions: no commit/tag/push/npm/GitHub release; no change to the 1.2.0 RC; no production data edits or
Vult repair; no subscription bypass or API billing; no org/provider security setting changes; never accept security
warnings or permissions on the owner's behalf; never silently authorize agent tool calls outside approved isolated
tests; never distribute experimental Claude integration.
