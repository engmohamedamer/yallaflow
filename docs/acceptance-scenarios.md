# Acceptance Scenarios

These scenarios exercise YallaFlow's project-knowledge boundary. They are examples for tests and acceptance review, not runtime classifiers.

## Scenario A — OSS CORS Bug

Durable candidate:

```text
Kind: integration
Aliyun OSS CORS configuration is required for browser-fetched FilePond image previews.
```

Useful evidence may reference the filesystem configuration and the observed missing response header. Inspected files, failed commands, temporary hypotheses, and raw debug logs remain in work history and are not promoted.

## Scenario B — Contract Management System

Potential durable candidates:

```text
business-rule: Contracts support Gold and Silver packages.
business-rule: Payment logs may transition a contract to Paid.
architecture: Contracts expose QR-based authenticity verification.
```

The agent must propose each candidate explicitly with evidence. YallaFlow validates and routes the candidate to project memory; it does not infer these statements from request text.

## Scenario C — APD-shaped Brownfield onboarding (v0.3.9)

**Repository shape:**
- No root manifest and no Git.
- `frontend-beneficiary/` declares `@angular/core ^16.2.12`; `frontend-corporate/` declares `@angular/core ^8.0.3`.
- `backend/*` Maven modules, some inheriting `spring-boot-starter-parent`, one with a `spring-boot-dependencies` BOM version held in a same-file property, one with only the build plugin.
- A `docker/` directory holding Docker Compose and Dockerfiles.
- `docs/` with a PDF design document, an XLSX integration sheet, a Markdown overview, and an `.odg` diagram.

**Expected behavior:**

1. `yallaflow inspect`, before `init`:
   - classifies the repository as Brownfield, with its reasons;
   - reports both Angular portals with their distinct majors (16 and 8), Spring Boot 2 from the parent and from the BOM property, and *version not declared in this manifest* for the plugin-only module;
   - lists the documents with their intake handling (the `.odg` marked *preserve-only, no text extraction*);
   - writes nothing and names `yallaflow init` as the next action.
2. `yallaflow init` records `brownfield`. Its `tech-stack.md` carries the nested hints under an *init-time deterministic bootstrap snapshot* label.
3. `yallaflow brief` shows the inventory headline and proposes `yallaflow baseline start`.
4. Asked to "understand this project, do not change application code", the Agent runs the following without asking again. It stops at the draft, because a human approves:
   - `baseline start`;
   - `intake add` for the material overview, then reads it back with `source show --content`;
   - completes the `repository-baseline` checkpoint;
   - `baseline draft`, with the unread PDF recorded as a `not-inspected` limitation.
5. Asked instead for a completely read-only look, the Agent runs only `inspect`, `brief`, and the `status` commands, and `.yallaflow` is unchanged.
6. After the human runs `baseline approve`, a fresh session's `brief` explains the project from its facts. When a cited manifest later changes, the fact appears under NEEDS CARE as `MAY_BE_STALE`; it is not rewritten.

**Inventory bounds.** Depth is capped at `INVENTORY_MAX_DEPTH` = 16 (a pre-freeze refinement approved over the originally reviewed 6, because deep Java package trees need it) and entries at `INVENTORY_MAX_ENTRIES` = 50,000. A scan that hits either bound says so.

**Container/CI hints.** `tech-stack.md`'s repository hints name the same meaningful container/CI files that classify the repository: Dockerfile, Docker Compose, and CI.

Regression coverage: `test/onboarding.test.js`, `test/inventory.test.js`, and the fixture `test-support/apd-fixture.js`.
