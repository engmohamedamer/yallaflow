# PF-0060 — Claude Code as a selectable agent in the console alongside Codex (owner decision 2026-11-07 reverses the 1.3.0 exclusion): agent picker, subscription-only, own security review

## Raw Request

Claude Code as a selectable agent in the console alongside Codex (owner decision 2026-11-07 reverses the 1.3.0 exclusion): agent picker, subscription-only, own security review

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** feature
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow feature --scope architectural`.
**Timestamp:** 2026-11-07T19:11:47.179Z
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

Let the developer choose the agent in the console's floating chat: Codex (managed session, unchanged) or Claude Code (experimental). Claude Code joins a session the developer starts in a terminal with the command the console shows; chat then works both ways. In scope: shipping the existing Claude channel files in the package, the picker, the opt-in, the connect flow in the floating window, honest limits, docs and a full security review. Out of scope: YallaFlow launching `claude`, the Agent SDK / ACP adapter / `claude -p` (not allowed on a subscription), Stop for Claude, token streaming.

### Actors and Permissions

- Developer: enables agents, opts in to Claude Code, runs the launch command, chats, answers permission prompts.
- Claude Code: the developer's own unmodified binary and subscription login; YallaFlow never starts or authenticates it.
- Console: relays chat and permission prompts through the YallaFlow channel (bridge token per run) and records activation only through Core.

### Functional Requirements and Business Rules

1. The five Claude files, its test and its document move into the repository and the package (package.json exclusions removed; CLAUDE_NOT_INCLUDED stays as the guard for builds without them).
2. Opt-in: Claude Code is never on by default. CLI: `yallaflow console --agents --experimental-claude` (unchanged). Console: the "Enable agents" confirmation offers a separate, unchecked "Also allow Claude Code (experimental)" choice; it lasts for the run only and is refused in `--read-only`.
3. Picker in the floating chat: Codex and Claude Code, each with its readiness (installed, version, login type from `claude auth status`, never a credential) and its limits; Claude is labelled experimental.
4. Connecting Claude Code: the window shows the exact launch command (including `--dangerously-load-development-channels`) and explains the development warning Claude will show; it writes only the git-ignored local connection files; after the developer starts Claude, the window shows "connected" and chat works both ways (whole messages).
5. Limits shown honestly: no Stop from the console, replies arrive whole, permission prompts are relayed when Claude asks (Claude's own mode decides), a mode that skips permissions is flagged and messages are refused.
6. API keys are never used or required; ANTHROPIC_API_KEY is never passed or read.
7. Codex behavior is unchanged; one agent session per checkout.

### Workflows and Lifecycle

### Data and Integrations

### Validation and Error Behavior

### Security and Privacy

Restored surface: the bridge routes for the channel and hooks (bridge token, no browser Origin), the local connection files under .yallaflow/local, `claude auth status` parsing. Full independent security review on an isolated copy before DONE (the 1.3.0 review of these files is input, not a substitute).

### UI / Screens

### Acceptance Criteria

### Unresolved Items

- Anthropic's written answer (D1) on distributing the channel is still pending; the feature ships as experimental and off by default, and the docs say so.
- Permission relay was not exercised on a real session in the 1.3 PoC (auto mode approved everything); a manual-mode relay check on the owner's subscription needs the owner to run Claude Code (planned as the last verification step, with the owner).

## Implementation Plan

1. Bring the files from ~/Amasi/YallaFlow-agent-1.3 (read only there): src/agents/claude.js, claude-files.js, claude-detect.js, resources/agents/claude-channel.mjs, claude-hook.mjs, test/agent-claude-experimental.test.js, docs/agents-claude-experimental.md; reconcile with main's newer bridge.js; remove the package.json exclusions.
2. Server: enable route accepts {confirm, claude?}; Claude only with an explicit true; GET /api/agents reports Claude readiness when opted in.
3. UI: picker and connect flow inside the floating chat; enable dialog with the separate Claude choice; limits text.
4. Docs/CHANGELOG: experimental status, D1 pending, launch command, limits.
5. Verification: full suite, simulated Claude channel tests, browser check of the picker, independent security review on an isolated copy, then a real-session check with the owner (manual mode: chat, a permission prompt allowed and denied).

## Verification Evidence

- V-005 (before the commit) and V-006 (2026-11-07, fresh on the working tree including PF-0063/PF-0064 changes): `npm run check` passed, 954/954.
- Independent security review on an isolated copy: recorded as a ruling in progress.yaml (2 medium, 2 low, 3 info; all addressed).
- Real-session check with the owner (2026-11-07, 23:20–23:43, global install packed from the working tree; Claude Code 2.1.319 logged in with a claude.ai subscription; console opted in through the Enable agents dialog):
  - Connected: the channel joined the restarted console by itself; the handshake (HMAC proof) was confirmed directly.
  - Mode: `auto` shown with its warning after the first hook.
  - Activity: tool calls appeared in the floating chat live.
  - Chat both ways: a console message reached the session and the reply came back (chat 1).
  - Answered in Claude Code: a Read permission prompt raised in auto mode was answered in the terminal; the console closed it as "Answered in Claude Code".
  - Deny from the console: `touch /tmp/claude-1000/yf-perm-deny.txt` was refused ("Denied via channel yallaflow"); the file was not created.
  - Allow from the console: `touch /tmp/claude-1000/yf-perm-allow2.txt` ran outside auto mode after the owner answered the prompt; that the answer came from the console (not the terminal) was not independently confirmed.
- Found during the session: right after a console restart, messages are refused until Claude Code reports its permission mode (MODE_UNKNOWN), and the console then shows nothing because `agentAction` clears the error when it reloads the agent state (resources/console/app.js:509-515 with :325). That code predates PF-0060 (v1.3.0); it is routed as separate bug work.

## Decisions / Rulings

## Knowledge Updates

## Result
