# Owner decisions: hybrid direction, Claude Channels PoC, unified Agent Workspace (2026-11-06, agent session)

Approves the revised hybrid direction; subscription-based usage is mandatory.
- D1: prepare the five Anthropic questions as a concise support/compliance request; do NOT send without review.
- D2': approved — Codex via ACP; Claude Code via its official Channels mechanism.
- D7': approved — small controlled Claude PoC on the existing Claude Code subscription; maximum five short turns;
  no API keys; no paid extra usage; disposable repository only.
- D8: approved — ACP preferred for Codex; native App Server as fallback when justified.
Before the Claude PoC: verify the installed Claude Code supports Channels and that required features and policies
are enabled. If testing a custom development channel requires an explicit warning or user confirmation, stop and
let the owner approve that step interactively. Never bypass tool permissions.
Product decisions: (1) one unified Agent Workspace UI with provider-specific capability detection; (2) no separate
chat interfaces for Claude and Codex; (3) Codex: managed sessions on the existing ChatGPT subscription; (4) Claude:
connect only to an explicitly started, unmodified Claude Code session on the user's subscription; (5) never
require, request or silently fall back to API keys; (6) one active managed agent session per checkout; (7) Core
authoritative for workflow decisions, memory and evidence; (8) do not expose unsupported controls (Stop/Start)
when the provider cannot perform them; (9) the whole feature is opt-in.
Next: execute only the isolated Claude Channels feasibility PoC and prepare the unified UX architecture; report
actual results, limitations and viability. No production implementation, no release-candidate change, no commit,
tag, push or publish. Stop after the PoC and architecture report for approval.
