# PF-0132 — Implement the approved console information architecture (prototype research/ux-1.5.2/ia, PF-0129): merge Agents into Projects (Needs-you inbox on top, agents inside each project card); one Project destination with Overview / Run / Settings tabs replacing Project and Setup & Run; team mode as an optional New-project step and Settings section plus a permanent header indicator (Team/Solo + current branch) and a Workspace off-integration-branch banner; header tabs Workspace · Project · More; old routes keep working

## Raw Request

Implement the approved console information architecture (prototype research/ux-1.5.2/ia, PF-0129): merge Agents into Projects (Needs-you inbox on top, agents inside each project card); one Project destination with Overview / Run / Settings tabs replacing Project and Setup & Run; team mode as an optional New-project step and Settings section plus a permanent header indicator (Team/Solo + current branch) and a Workspace off-integration-branch banner; header tabs Workspace · Project · More; old routes keep working

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** change
**Scope:** architectural
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow change --scope architectural`.
**Timestamp:** 2026-11-11T14:13:00.487Z
**Workflow:** change
**Required capabilities:** discover, clarify, brainstorm, plan, implement, verify, converge, review
**Behavior contract:** registry v9
**Skills:** context-discovery, requirement-clarification, design-exploration, implementation-planning, implementation, verification, delivery-convergence, code-review
**Read-only:** no

## Intake

## Known Facts

## Open Questions

## Requirement

## Business Rules

## Acceptance Criteria

## Discovery

## Specification / Expected Behavior

Approved direction: PF-0129 prototype (research/ux-1.5.2/ia, SRC-0075..0078), owner screenshot SRC-0079.

- **Header:** logo · project switcher · team indicator (👥 Team / 👤 Solo + current branch; amber dot when Solo and off the integration branch) · tabs Workspace · Project · More (Insights, Worktrees) · Create work · Live · bell · language · theme. No Agents and no Setup & run tab.
- **Projects (#/projects, #/agents):** Needs-you inbox (the existing agent permission cards, all projects) above the cards when agents are on; each project card gains an Agents block with that project's lanes (existing lane data). #/agents is an alias that scrolls to the inbox.
- **Project (#/overview, #/run, #/settings; #/setup → Run):** one page head (name, readiness, path) and a tab bar.
  - Overview: today's overview content regrouped — summary + key numbers, needs-care list, areas as expandable sections, stack table; two columns on desktop.
  - Run: Start/Stop project and status bar; one compact row per service; a failure is one line + View log / Ask the agent to fix / Start again; links and definitions collapsed; quick links and the setup analysis ("How this was set up") collapsed in a side column.
  - Settings: section menu; Agents (today's agents section), Team mode (today's team card and confirmed enable flow), Services (stack, analysis, add a service), Project (folder, remove).
- **Workspace:** banner when the checkout is not on the integration branch (warning when Solo, note when Team).
- **New project:** after a successful creation, an optional "Turn on team mode" step using the existing confirmed flow.

Out of scope: queue controls on cards; any server API change except what the moves strictly need; Agents data model.

## Implementation Plan

1. Routing + header (app.js): route aliases (agents→projects#inbox, setup→run), `projectTab()` for overview/run/settings, new header tabs, team indicator from `projectOverview.data.git` (load the overview for every project view), bell → #/projects.
2. Projects: `viewProjects()` renders the inbox (`xPermCard`) and per-card lanes (`xLane` compact variant); `loadForView` loads execution on #/projects.
3. Project page: split `viewSetup()` into `viewRun()` (runtime/services part) and `viewSettings()` (agentsSection, gitLine team section, stackSection/setupGuide/add service, project folder); add `projTabs()`; regroup `viewOverview()` into a two-column layout. Keep every data-* action attribute so existing handlers keep working; scroll anchors (#setup-agents, #setup-run) map to the new tabs.
4. Run compaction: service failure summary line + log on demand (existing log action), collapsed links/definitions and analysis.
5. Team: header indicator, Workspace banner (reuse `sharedHint` logic, Team variant), wizard success step button reusing `data-shared-open`.
6. CSS in app.css (and Tailwind classes only if already built; rebuild tw.css with the pinned CLI if new ones are needed, keeping the freshness check green).
7. Tests: new test/console-ia.test.js; update existing tests that assert the Agents/Setup tabs. Verify with npm run check plus a Playwright pass (ar/en, light/dark, 1440/390 px).

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result

## Source Added

**Source ID:** SRC-0075
**Type:** file
**Name:** 01-projects-light.png

Raw source preserved in: `.yallaflow/sources/SRC-0075/01-projects-light.png`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0076
**Type:** file
**Name:** 03-project-run-light.png

Raw source preserved in: `.yallaflow/sources/SRC-0076/03-project-run-light.png`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0077
**Type:** file
**Name:** 05-project-settings-light.png

Raw source preserved in: `.yallaflow/sources/SRC-0077/05-project-settings-light.png`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0078
**Type:** file
**Name:** 02-project-overview-light.png

Raw source preserved in: `.yallaflow/sources/SRC-0078/02-project-overview-light.png`. Read it directly; it is not duplicated here.

## Source Added

**Source ID:** SRC-0079
**Type:** file
**Name:** Screenshot from 2026-11-11 15-06-07.png

Raw source preserved in: `.yallaflow/sources/SRC-0079/Screenshot from 2026-11-11 15-06-07.png`. Read it directly; it is not duplicated here.
