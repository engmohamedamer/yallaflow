# PF-0155 — Console board: the greeting header (hero) flashes/fades in again whenever an agent-needs-attention notification arrives. Seen on the lalaff board when PF-0003 started waiting for a reply. Likely cause (not yet verified): .hero in resources/console/app.css line 64 has an entrance animation (rise .7s both) and the board re-render on a new snapshot recreates the hero element, replaying it. The entrance animation should play only on first paint, not on live updates.

## Raw Request

Console board: the greeting header (hero) flashes/fades in again whenever an agent-needs-attention notification arrives. Seen on the lalaff board when PF-0003 started waiting for a reply. Likely cause (not yet verified): .hero in resources/console/app.css line 64 has an entrance animation (rise .7s both) and the board re-render on a new snapshot recreates the hero element, replaying it. The entrance animation should play only on first paint, not on live updates.

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** bug
**Scope:** bounded
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow bug --scope bounded`.
**Timestamp:** 2026-11-15T20:17:07.122Z
**Workflow:** bug
**Required capabilities:** discover, systematic-debugging, implement, verify
**Behavior contract:** registry v9
**Skills:** context-discovery, systematic-debugging, implementation, verification
**Read-only:** no

## Intake

## Known Facts

## Open Questions

## Reproduction

## Evidence

## Hypothesis

## Root Cause

## Discovery

## Specification / Expected Behavior

## Implementation Plan

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0118
**Type:** file
**Name:** Screenshot from 2026-11-15 22-14-28.png

Raw source preserved in: `.yallaflow/sources/SRC-0118/Screenshot from 2026-11-15 22-14-28.png`. Read it directly; it is not duplicated here.
