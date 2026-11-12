# PF-0121 — v1.5.2 major UI/UX overhaul: three high-fidelity interactive design directions, comparison, recommendation, design system, frontend architecture and migration plan — design approval stage, no production changes

## Raw Request

v1.5.2 major UI/UX overhaul: three high-fidelity interactive design directions, comparison, recommendation, design system, frontend architecture and migration plan — design approval stage, no production changes

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** investigation
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow investigate --scope architectural`.
**Timestamp:** 2026-11-10T22:58:26.590Z
**Workflow:** investigation
**Required capabilities:** discover, systematic-debugging, verify
**Behavior contract:** registry v9
**Skills:** context-discovery, systematic-debugging, verification
**Read-only:** yes

## Intake

## Known Facts

## Open Questions

## Investigation Question

Which visual and interaction direction should the 1.5.2 console overhaul take, and with which frontend architecture, design system and migration plan? Design-approval stage: prototypes and documents only.

## Evidence

## Findings

Three high-fidelity interactive prototypes were built on one shared fake dataset (research/ux-1.5.2/directions/: atelier.html, mission-control.html, daylight.html, data.js), with 44 uniform screenshots (shots/) and a side-by-side page (compare.html). Evaluation, design system, architecture (React + Vite + Tailwind v4 + Radix, built at publish, no user build), migration phases, parity list, risks and a measurable acceptance checklist are in research/ux-1.5.2/DESIGN-DIRECTIONS.md.

## Conclusion

Recommendation: Direction A (Atelier) as the foundation, with B's flow canvas as the Workspace Flow view and C's onboarding, decision cards and plain Run language; confirm with a unified prototype before production work. Open owner decisions O1-O6. Nothing implemented.

## Discovery

## Specification / Expected Behavior

## Implementation Plan

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

Awaiting the owner's choice of direction (O2) and the other decisions before any implementation is routed.
