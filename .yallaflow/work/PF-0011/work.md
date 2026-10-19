# PF-0011 — v1.1.0 C4 — Integration, Agent Contract v10, documentation and release verification

**Type:** release
**Status:** INTAKE
**Scope:** bounded
**Parent:** PF-0007
**Read-only:** no

## Requirements

REQ-011

## Acceptance Criteria

AC-025, AC-026, AC-027

## Intake

## Known Facts

## Open Questions

## Requirement

## Business Rules

## Acceptance Criteria

## Discovery

## Specification / Expected Behavior

## Implementation Plan

This executes the C4 milestone of PF-0007's approved plan.

1. **Versions.** package.json, package-lock.json and src/version.js go to 1.1.0 (MINOR). The domain versions already changed in C1–C3: Agent Contract v10 and Skill Registry v9. The bootstrap stays v3, Knowledge Policy v1, and every schema is unchanged. New ledgers start at qc.json v1 and demo.json v1. Update the version assertions in tests.
2. **Mixed-version test against the frozen v1.0.1.** A workspace that used tickets, QC, demo and `qc:` citations must still be readable by 1.0.1 (status, doctor, brief, guide). Record any gap as a documented limitation.
3. **Docs:**
   - CHANGELOG 1.1.0, `docs/upgrading-to-v1.1.0.md`, and `.github/release-notes/v1.1.0.md`;
   - README and `docs/using-yallaflow.md`: short sections;
   - `docs/cli.md`: the new commands;
   - `docs/security.md`: the network boundary, credentials and media privacy;
   - `docs/limitations.md`: no live tracker run, ffmpeg needed for video, quality approval is not a lock;
   - `docs/architecture.md`: the provider layer, quality ledgers and on-demand skills;
   - `docs/roadmap.md`: tracker intake delivered;
   - `docs/releasing.md`: the scan line.
4. **This repository.** Run `agent refresh` (contract v9 → v10) with the source CLI, then `doctor`.
5. **Project memory:**
   - supersede the module map (CTX-0047) and the documentation-set fact;
   - correct the QC citation form in the PF-0009 fact;
   - revalidate the facts flagged MAY_BE_STALE.
6. **Release checklist:** `npm ci` plus `npm run check`, doctor, `npm audit`, `npm pack --dry-run` plus a real tarball file list and secret scan, a packed-candidate smoke test from an isolated prefix, the network/provider scan, and `git diff --check`.
7. **Stop.** No commit, tag, push or publish without explicit approval.

## Verification Evidence

## Decisions / Rulings

## Knowledge Updates

## Result
