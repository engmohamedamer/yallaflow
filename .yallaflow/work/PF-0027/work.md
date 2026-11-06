# PF-0027 — yallaflow console: local read-only server and Flow, Work and Item views with live updates and previews

**Type:** feature
**Status:** INTAKE
**Scope:** bounded
**Parent:** PF-0024
**Read-only:** no

## Requirements

REQ-005, REQ-006, REQ-007, REQ-008

## Acceptance Criteria

AC-005, AC-006, AC-007, AC-008, AC-012

## Intake

## Known Facts

## Open Questions

## Requirement

## Business Rules

## Acceptance Criteria

## Discovery

## Specification / Expected Behavior

## Implementation Plan

## Implementation

- **`yallaflow console [--port N] [--no-open] [--project DIR]...`** (`src/commands/console.js`) is a read-only command that takes no lock. It prints a link carrying a token for this run only, opens the browser, and stops on Ctrl-C. The port is 4747, or the next free one.
- **`src/console/server.js`**:
  - `node:http` on 127.0.0.1, with Host checking (421), Origin checking (403), the token (401) and GET/HEAD only (405).
  - The UI files come from a fixed file map; everything else returns 404. The page CSP has `script-src 'self'`.
  - `/api/projects`; `/api/events` (streamed); `/api/p/<id>/snapshot`; `/work/<PF>`; `/sources/<SRC>/original` (images, PDF and text from an allowlist, with a sandbox CSP and `nosniff`; the file's real path must lie inside `sources/`); `/sources/<SRC>/text`.
  - A missing work item returns 404.
- **`src/console/runner.js`** spawns this package's own CLI (`snapshot --json` / `work show --json`), two at a time with a 30 s timeout, and caches results per project.
- **`src/console/watch.js`** uses a recursive `fs.watch`, debounced to 250 ms and ignoring the lock and temp files, with a 2 s polling fallback.
- **`resources/console/`** (index.html, app.js, app.css, favicon, Readex Pro TTF with its OFL licence) implements the Flow v4 design on real data:
  - **Map:** the New gate, 5 stations and the Done line, the bottleneck (work waiting on a person), filters, search and a 4-card limit per station.
  - **Work lines.**
  - **Item:** the chain, with each station's handoff taken from its checkpoint summaries; the history (checkpoints, revisions as handbacks, verification runs); details in 5 tabs; and drawers for attachments (shown as blobs) and handoff artifacts.
  - **Live:** a re-read on every event, with the baton for forward and back moves, card sliding, toasts and a celebration on reaching Done.
  - **Actions:** each one shows the exact CLI command, with a copy button. New work prepares its command.
  - Arabic RTL and English, light and dark, reduced motion, and per-paragraph text direction for project text.
- **Core (additive):** `work show` checkpoints carry their `station` (`stationForSkill`) and a `knowledge` section. The schema is updated to match.
- **`test/console-server.test.js`** (4 tests): security, data and sources, a live event in under 2 s with the cache invalidated, and no writes while browsing.
- **Browser checks** (playwright-cli, Chromium), on this repository and on a demo project:
  - 0 console errors;
  - no horizontal scroll at 390 px on the map or an item;
  - English item view;
  - a live CLI `advance` animates the baton from Understand to Decide, moves the card, raises the ring from 8 to 11% and shows the toast.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result
