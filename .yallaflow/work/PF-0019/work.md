# PF-0019 — Improve the public README landing page and Mermaid diagrams for v1.1.0 (docs only)

## Raw Request

Improve the public README landing page and Mermaid diagrams for v1.1.0 (docs only)

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** change
**Scope:** bounded
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow change --scope bounded`.
**Timestamp:** 2026-10-19T22:54:40.670Z
**Workflow:** change
**Required capabilities:** discover, clarify, plan, implement, verify
**Behavior contract:** registry v9
**Skills:** context-discovery, requirement-clarification, implementation-planning, implementation, verification
**Read-only:** no

## Intake

## Known Facts

## Open Questions

## Requirement

## Business Rules

## Acceptance Criteria

## Discovery

## Specification / Expected Behavior

## Implementation Plan

Docs-only rewrite of README.md as a landing page. No application code.

1. **First screen.** The tagline and a 2–3 line value proposition. Badges: npm version, license, Node engine, and supported agents. Install with `npm install -g yallaflow`, then `yallaflow init`, then describe the work.
2. **Diagram A: who does what.** Developer → coding agent ↔ YallaFlow, with memory, workflow and evidence.
3. **Diagram B: the engineering lifecycle.** Understand → route → specify/plan *when the work needs it* → implement → verify → check against intent → remember.
4. **What's new in 1.1.0, with diagram C.** A tracker ticket is an optional input into the same lifecycle. AI QC and Smart Demo are separate, on-request nodes with dotted, undirected links: no dependency between them, and none on finishing. Add natural-language examples and a "Good to know" list (off by default; a demo is not test proof; Git-ignored artifacts; committed ledgers; ffmpeg needed for video).
5. **Condense the existing sections.** First run on an existing project, new project, teams, who runs what and upgrading each become a few lines with links. The detail lives in docs/using-yallaflow.md, workflows.md, shared-projects.md and installation.md.
6. **Diagram style.** Default theme, no custom colours (so GitHub's light and dark themes apply), short labels, ```mermaid fences.
7. **Checks.**
   - Every relative link and #anchor resolves.
   - External URLs return 200.
   - Markdown structure is sound (one H1, ordered headings, balanced fences).
   - Every Mermaid block parses and renders in a real browser in light and dark themes (Playwright screenshots, scratch only).
   - A full-page render of the README with GitHub markdown styling is inspected.
   - Diff check, and the doc-related tests (cli, help, agent docs).
8. **One local docs commit.** No tag, push or publish.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0012
**Type:** file
**Name:** readme-request.md

Raw source preserved in: `.yallaflow/sources/SRC-0012/readme-request.md`. Read it directly; it is not duplicated here.
