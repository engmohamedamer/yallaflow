# PF-0004 — v1.0.0 First Public Stable Release

## Raw Request

Prepare YallaFlow v1.0.0 first public stable npm release: declare the 1.0 stability/compatibility contract, prepare public npm package metadata (remove private), audit packed contents and security/privacy, update README/docs/CHANGELOG for npm install, prepare GitHub release notes and trusted-publishing automation; stop before commit/tag/push/publish.

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** release
**Scope:** architectural
**Confidence:** high
**Reason:** A release, not a product change: no new features. Architectural scope because it declares the public 1.0 compatibility contract (SemVer promise over CLI and durable workspace behavior), is the first irreversible public npm publication (security boundary over packed contents), and touches packaging, docs, and release automation across the project.
**Timestamp:** 2026-10-13T11:20:52.360Z
**Workflow:** release
**Required capabilities:** discover, plan, implement, verify, review
**Behavior contract:** registry v8
**Skills:** context-discovery, implementation-planning, implementation, verification, code-review
**Read-only:** no

## Intake

## Known Facts

## Open Questions

## Requirement

## Business Rules

## Acceptance Criteria

## Discovery

Intent discovery against the approved self-baseline (46 current, fresh facts); no repository-wide rescan.

- Release base: HEAD = `c433e61` = tag `v0.3.10-internal.4` = `origin/main`; tree clean; all 13 internal tags present. Source and global CLI report `0.3.10-internal.4`. `npm test`: 664/664 pass. `doctor`: healthy (13 historical PF-0001 convergence-staleness warnings; DONE history unchanged).
- npm name: `npm view yallaflow` → E404; `yalla-flow`, `yalla_flow`, `yalla.flow`, `yallaflows` → E404. No conflict. `npm whoami` → ENEEDAUTH (not logged in).
- GitHub: `engmohamedamer/yallaflow` is public, issues enabled, no description/homepage. No `.github/` directory, no CI.
- Package: `"private": true` is the publish blocker; metadata lacks repository/homepage/bugs/keywords/license/author. `files` allowlist (`src`, `resources`, `docs`, README, CHANGELOG, LICENSE) already excludes `.yallaflow/`, tests, test-support, CLAUDE.md/AGENTS.md, `.idea`. Pack = 175 files, 418 kB.
- Version compatibility: `compareVersions('1.0.0', '0.3.10-internal.1') > 0`, so Shared Projects requiring `>= 0.3.10-internal.1` accept 1.0.0. `SHARED_MINIMUM_VERSION` need not change. Only two tests assert the literal package version (`test/cli.test.js`, `test/pilot-hardening.test.js`).
- Version domains (unchanged by this release): Agent Contract v8, bootstrap v2, Skill Registry v8, Knowledge Policy v1, newest supported context ledger schema v2 (this workspace: v1), knowledge schema v2, config schema v1/v2, source schema v2, all other work-record schemas v1.
- Privacy surface: `src/` imports no network module and contains no URL; the only spawned processes are local read-only `git` and the developer-requested `yallaflow verify` command. PDF parsing runs with worker/eval/autofetch/fonts disabled.
- `npm audit`: 2 moderate entries = one advisory (GHSA-5v7r-6r5c-r473, `file-type` via `officeparser`), already documented as mitigated in docs/releasing.md.
- Docs with primary-path internal references: README (install, status, upgrade link), docs/installation.md, docs/using-yallaflow.md, docs/releasing.md (pre-1.0 policy), docs/upgrading-to-v0.3.10.md (install line), docs/cli.md header, docs/security.md, SECURITY.md (private-reporting wording), CHANGELOG preamble, docs/internal-pilot.md, docs/shared-projects.md CI snippets.

## Specification / Expected Behavior

## Implementation Plan

1. **Version** — `package.json` and `src/version.js` → `1.0.0`; the two literal version assertions in tests follow. No Agent Contract, bootstrap, Skill Registry, Knowledge Policy, or schema bump (no behavior or shape change).
2. **Package metadata** — remove `"private": true`; add license, author, repository, homepage, bugs, keywords, `publishConfig` (`access: public`, `provenance: true`); keep name, bin, engines, `files`.
3. **Stability contract** — rewrite docs/releasing.md "Semantic Versioning" for 1.0 (PATCH/MINOR/MAJOR, independent version domains, pinned behavior, immutable instructions, readable workspaces, no history rewrite) and the release checklist (npm + trusted publishing).
4. **Docs** — README primary install `npm install -g yallaflow`, status section → 1.0.0; installation/using-yallaflow/upgrading/cli/security/SECURITY/limitations/shared-projects/internal-pilot primary references; add docs/upgrading-to-v1.0.md (short: no workspace changes). Historical text unchanged.
5. **CHANGELOG** — `1.0.0` product-level section with "Why 1.0 now"; preamble no longer says nothing is published; internal entries kept verbatim.
6. **Release automation** — `.github/workflows/release.yml`: on GitHub Release published → `npm ci`, `npm run check`, version/tag match, `npm pack` smoke, `npm publish --provenance` via OIDC trusted publishing (no token). Document the npm UI step.
7. **Release notes** — draft GitHub Release notes (not created).
8. **Verification** — full suite, doctor, packed-tarball inspection + secret scan, isolated install smoke (version, init Greenfield/Brownfield, Claude/Codex bootstraps, Shared clone), link/anchor check, `git diff --check`.

## Verification Evidence

Final evidence (after the independent review fixes): syntax V-012; full suite 664/664 on Node 20.19.0 (V-013), 22.23.3 (V-014), 24.21.0 (V-015); final tarball audit V-016 (176 files, allowlist only, no secrets or machine paths); packed-candidate first-user smoke test from an isolated `npm install -g` prefix, 19 checks (V-017); `npm pack --dry-run` V-018; `git diff --check` V-019; doc links/anchors V-020; doctor V-021; agent status V-022; `npm audit --audit-level=high` V-023 (one known moderate advisory); no network/provider/telemetry code V-024. Earlier runs V-001…V-011 remain in the ledger. Release-workflow guard logic was simulated against the live registry (package absent, version published, version missing, registry unreachable).

## Decisions / Rulings

- Package version only: Agent Contract v8, bootstrap v2, Skill Registry v8, Knowledge Policy v1 and all schema versions unchanged.
- `publishConfig.provenance` not set: provenance comes from the workflow, so the manual first publish works without CI.
- 1.0.0 is published manually by the owner; the trusted publisher is created with the first automated release, because npm expires an unused configuration after 2 days.
- CHANGELOG usage statements kept in the owner's wording, without numbers.

## Knowledge Updates

Superseded: CTX-0004 (distribution → public npm package), CTX-0034 (no CI → release workflow), CTX-0039 (release process from 1.0.0), CTX-0037 (versioning → 1.0 SemVer promise). Reconfirmed after revalidation: CTX-0001, 0002, 0003, 0006, 0007, 0008, 0009, 0031, 0032, 0033, 0035, 0040, 0046 (still unresolved), 0056, 0057.

## Result

YallaFlow 1.0.0 is prepared and verified for its first public npm release: public package metadata, the 1.0 compatibility promise, npm-first documentation, CHANGELOG and GitHub release notes, and a token-free release workflow. Nothing is committed, tagged, pushed, or published; the first publication waits for the owner's explicit approval.
