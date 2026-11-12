# PF-0120 — v1.5.2 UX & onboarding redesign: research and proposal (console IA, agent setup, project entry, readiness, Setup & Run, clipboard, frontend stack) — no implementation

## Raw Request

v1.5.2 UX & onboarding redesign: research and proposal (console IA, agent setup, project entry, readiness, Setup & Run, clipboard, frontend stack) — no implementation

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** investigation
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow investigate --scope architectural`.
**Timestamp:** 2026-11-10T22:36:20.214Z
**Workflow:** investigation
**Required capabilities:** discover, systematic-debugging, verify
**Behavior contract:** registry v9
**Skills:** context-discovery, systematic-debugging, verification
**Read-only:** yes

## Intake

## Known Facts

## Open Questions

## Investigation Question

What should the 1.5.2+ console experience be for first-time users (agent setup, connecting an existing project, mandatory readiness, navigation, Setup & Run, clipboard), and is Tailwind or a frontend framework justified? Research and proposal only.

## Evidence

- resources/console/app.js: render() replaces #app.innerHTML on every change (3082-3115); Setup re-renders every 3 s (2219-2223); New-column + is a decorative span (297); copy() uses only navigator.clipboard with no failure message (1471-1475); 7-tab nav (203-218).
- src/console/greenfield.js:63-76: registering a folder without .yallaflow returns 422 NOT_A_YALLAFLOW_PROJECT (the Laravel trial dead end).
- src/console/create.js:56 and Core start/route: PROJECT_UNDERSTANDING_REQUIRED already enforced by Core.
- src/agents/detect.js, codex.js:129-142: detection is binary-only; the ChatGPT login is proven only by the ACP handshake at session start.
- src/commands/init.js:18-44: init is transactional with byte-exact rollback and writes CLAUDE.md/AGENTS.md bootstrap blocks.
- server.js:45-75: fixed UI file map and strict CSP (script-src 'self'); package has no build step.
- test/console-presentation.test.js:7: UI tests assert on app.js source text; no browser tests.

## Findings

Confirmed issues C1-C11 and the reusable building blocks are listed in research/ux-1.5.2/PROPOSAL.md §1. The root UI defect is the full-page innerHTML redraw (lost clicks, focus/typed-value preservation hacks, PF-0115). Tailwind addresses none of the observed problems and would add a build step; Preact+htm vendored without a build would. Readiness can be derived from existing Core state with no new persisted state.

## Conclusion

Recommendation: no Tailwind; Preact+htm (vendored, no build) as a 1.6.0 foundation; 1.5.2 limited to P0 (honest clipboard + render scheduler, working + on the board, Connect existing project via Core init with preview, derived readiness + server guards with an onboarding allow-list, Agent setup v1 with real handshake verify and optional confirmed install, light nav consolidation). Ten owner decisions (D1-D10) are open. Nothing implemented.

## Discovery

## Specification / Expected Behavior

## Implementation Plan

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

Deliverables: research/ux-1.5.2/PROPOSAL.md and research/ux-1.5.2/prototype.html (standalone, non-production). Awaiting the owner's decisions before any implementation work is routed.
