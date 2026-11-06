# PF-0037 — Agent Interaction (v1.3.0): Agent Bridge with Codex managed sessions via ACP and Claude Code Channels connection, unified Agent Workspace in the console

## Raw Request

Agent Interaction (v1.3.0): Agent Bridge with Codex managed sessions via ACP and Claude Code Channels connection, unified Agent Workspace in the console

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** feature
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow feature --scope architectural`.
**Timestamp:** 2026-11-06T16:07:38.244Z
**Workflow:** feature
**Required capabilities:** discover, clarify, brainstorm, specify, plan, implement, verify, converge, review
**Behavior contract:** registry v9
**Skills:** context-discovery, requirement-clarification, design-exploration, specification, implementation-planning, implementation, verification, delivery-convergence, code-review
**Read-only:** no

## Intake

## Known Facts

## Open Questions

Structured material questions are authoritative in `questions.yaml`.

## Confirmed Decisions

## Discovery

## Architecture / Technical Decisions

Classify only relevant decisions as confirmed, proposed, unresolved, or not applicable.

## Design

## Specification

### Goal and Scope
Agent Interaction v1.3.0 as authorized in SRC-0024. Not part of 1.2.0. Developed in the isolated workspace `YallaFlow-agent-1.3` (a copy of the 1.2.0 working tree); the 1.2.0 release candidate is untouched.

### Components
- `src/agents/acp.js`: dependency-free JSON-RPC-over-stdio client (ACP).
- `src/agents/events.js`: `yallaflow.agent-event/1` events, capability records, ACP → event normalization.
- `src/agents/detect.js`: provider detection (codex, codex-acp, claude), versions, subscription auth checks, never reading credentials.
- `src/agents/codex.js`: managed Codex session over ACP (start, prompt, stream, permission requests, set safe mode, cancel, resume, crash detection). Adapter env strips `OPENAI_API_KEY` and `CODEX_API_KEY`; start is refused unless the adapter reports a ChatGPT account login.
- `src/agents/claude.js`: Claude user-session link (channel registration, inbox, permission relay, hook events, honest outcome reporting).
- `src/agents/bridge.js`: one managed session per checkout, pending-permission map with default-deny timeout, event fan-out, session records in `.yallaflow/local/agent-sessions/` (git-ignored), process cleanup.
- `resources/agents/claude-channel.mjs`: zero-dependency MCP stdio channel server (`claude/channel`, `claude/channel/permission`, `reply` tool), spawned by the user's Claude Code, dialing the console bridge on localhost with a separate bridge token from `.yallaflow/local/agent-bridge.json` (mode 0600).
- `resources/agents/claude-hook.mjs`: command hook forwarder (observe only; never decides).
- Console:
  - `--agents` opt-in (Codex);
  - `--agents --experimental-claude` adds Claude;
  - routes under `/api/p/:pid/agent/…` (browser token, Origin, POST discipline) and `/api/agent-bridge/claude/…` (bridge token);
  - agent events multiplexed on the existing event stream;
  - Agent panel on the work item.
- CLI:
  - `yallaflow agents detect` (read-only);
  - `yallaflow agents claude-files` (writes the local MCP and settings files under `.yallaflow/local/agent/` and prints the launch command).

### Security and Privacy
See REQ-005/AC-005. Bypass and full-access modes are never selectable. Permission timeout default 5 minutes (`YALLAFLOW_AGENT_PERMISSION_TIMEOUT_MS`). No transcript or credential is stored by YallaFlow.

### UI / Screens
Per research/agent-interaction/AGENT_WORKSPACE_UX.md: one panel, capability-driven controls, subscription and permission-mode chips, auto-approval warning, permission cards distinct from review gates, explicit "Make this the active work item" action through Core.

### Acceptance Criteria
AC-001…AC-005 (`yallaflow requirement list PF-0037`).

## Implementation Plan
1. Bridge core (acp, events, detect, codex, claude, bridge) and the two resource scripts.
2. Console integration (opt-in flags, routes, event multiplexing) and CLI (`agents detect`, `agents claude-files`).
3. Agent panel UI.
4. Tests: an ACP agent fixture, an MCP client fixture for the channel, server security and concurrency tests.
5. Real Codex walkthrough.
6. Browser regression and screenshots.
7. Independent security review, then fixes.
8. Docs and CHANGELOG 1.3.0; version 1.3.0 in the dev workspace.
9. Full suite, then the release-readiness report.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0024
**Type:** file
**Name:** owner-agent-interaction-autonomous-authorization-2026-11-06.md

Raw source preserved in: `.yallaflow/sources/SRC-0024/owner-agent-interaction-autonomous-authorization-2026-11-06.md`. Read it directly; it is not duplicated here.
