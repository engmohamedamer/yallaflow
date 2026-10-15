# PF-0006 — Release YallaFlow v1.0.1 (automatic work-routing fix)

## Raw Request

Release YallaFlow v1.0.1 (automatic work-routing fix)

## Routing

**Status:** pending

The coding agent must classify this request using the YallaFlow routing contract.

## Routing Decision

**Status:** routed
**Work type:** release
**Scope:** bounded
**Confidence:** high
**Reason:** Explicitly classified by the user: `yallaflow release --scope bounded`.
**Timestamp:** 2026-10-15T10:44:52.912Z
**Workflow:** release
**Required capabilities:** discover, plan, implement, verify, review
**Behavior contract:** registry v8
**Skills:** context-discovery, implementation-planning, implementation, verification, code-review
**Read-only:** no

## Intake

The owner approved the v1.0.1 patch release on 2026-10-15: run the release checks, commit, add an annotated tag v1.0.1, and push main and the tag without force. Stop before the GitHub Release until the owner confirms the npm Trusted Publisher configuration. The release does not wait on the Sekaya real-agent acceptance test; the reporting developer validates after publication. Nothing in the Sekaya repository is modified or published.

## Known Facts

- Before release: origin/main = HEAD = 6c01a54 (v1.0.0). npm yallaflow latest = 1.0.0, published manually with no provenance.
- PF-0005 (the approved fix) is DONE, with its records, evidence and promoted knowledge in the working tree.
- The `gh` CLI is not installed. The owner publishes the GitHub Release in the web UI; workflow results can be read from the public GitHub API.

## Open Questions

## Requirement

Release only the approved automatic work-routing fix and its documentation, as package 1.0.1 on dist-tag latest, through GitHub Release → release.yml → npm Trusted Publishing with provenance. Every earlier tag and version stays immutable, and no npm token is stored.

## Business Rules

## Acceptance Criteria

## Discovery

## Specification / Expected Behavior

## Implementation Plan

1. Update the version mentions (README, installation, using-yallaflow), date the CHANGELOG 1.0.1 section, and add .github/release-notes/v1.0.1.md.
2. Run the release checklist (docs/releasing.md): npm ci + npm run check, doctor, npm audit, the pack file list, the real-tarball inspection and secret scan, the packed-candidate smoke test, the provider scan and git diff --check.
3. Make one release commit, add the annotated tag v1.0.1, and push main and the tag (fast-forward, no force). Check that the remote tag peels to the release commit.
4. Stop: hand the owner the exact Trusted Publisher configuration. Publish the GitHub Release only after confirmation.

## Verification Evidence

- npm ci && npm run check: 680/680 on Node 20.19.0. Recorded as governed evidence with `yallaflow verify -- npm run check`. Nodes 22 and 24 run in release.yml before publish.
- git diff --check: clean (V-001). doctor: healthy (V-002). npm pack: yallaflow 1.0.1, 177 entries (V-003).
- npm audit: 2 moderate entries, both from the known, documented and mitigated file-type advisory GHSA-5v7r-6r5c-r473 via officeparser. No new finding.
- Real tarball yallaflow-1.0.1.tgz (sha256 c221afdd…6eb890d6): the file list equals the `files` allowlist; it contains no tests, no .yallaflow/, no .env and no logs; the secret scan is clean; the version reads 1.0.1 in package.json and src/version.js.
- Packed-candidate smoke test from an isolated prefix:
  - --version 1.0.1.
  - Greenfield init installs the Claude and Codex bootstraps (contract v9, bootstrap v3), and brief shows the route-before-edit line.
  - The Brownfield first request is refused with PROJECT_UNDERSTANDING_REQUIRED.
  - A v1.0.0 workspace (contract v8, bootstrap v2) is reported outdated and refreshed to current.
  - Shared Project enable + clone: brief shows minimum >= 0.3.10-internal.1 compatible, shared check PASS, doctor healthy.
- Provider/network scan of src/: no network, model-provider or telemetry code.
- Release scope: src changes only in agent/contract.js, agent/bootstrap.js, commands/brief.js and version.js. Everything else is tests, fixtures, docs, CHANGELOG, release notes, the refreshed agent instructions and YallaFlow records (PF-0005, PF-0006, promoted project memory).

## Decisions / Rulings

## Knowledge Updates

## Result

Release 1.0.1 is prepared and verified. This record closes at the release commit. The tag, push, Trusted Publisher configuration, GitHub Release, workflow run and npm verification happen after it and are confirmed against GitHub and npm, as with PF-0004. Real-agent acceptance (Sekaya scenario) has not been performed; the reporting developer validates it after publication.
