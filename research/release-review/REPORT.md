# Consolidated v1.2.0 + v1.3.0 release review

Prepared 2026-11-07 (Cairo). Scope: recover review artifacts, verify the two existing release candidates, and prepare one manual acceptance session. The workspace evolution proposal is separate and remains proposed, not shipped.

**Decision: preparation is complete and ready for manual acceptance; publication is not authorized.** Final publication also depends on the owner's review, remote CI/publishing configuration, and the final release commit containing the reviewed corrections. This report does not claim a real provider session or a successful GitHub/npm release.

## Candidates and reproducibility

| Version | Existing local commit | SHA-256 of npm package |
| --- | --- | --- |
| 1.2.0 | `bc14db05fd60668c4da6da3437ecc7fc7b1816b5` | `bbad23be5806aa46d1556638ca08f92591cc16f26561d1f25536b5d89e4f4ab5` |
| 1.3.0 | `b700b2cb9d0f0d8eee1f440dc8484c8bb7382d14` + recorded review patch | `3dca4f4d283a5de9e093ba3fe3688346cba7418e283be7929af93b61255d153d` |

Packages and relative checksum sidecars are in [artifacts/](artifacts/). The original 1.2.0 checksum already matched the rebuilt artifact; its missing tarball is regenerated at `research/release-candidate/yallaflow-1.2.0.tgz`. Do not rely on a checksum file without its package.

`verify-artifacts.mjs` exports each immutable commit into temporary directories and applies [the recorded review patch](artifacts/1.3.0-review-fixes.patch) to 1.3.0. That patch has SHA-256 `21e5e20819fad06d549799ab8f797db16adb4528c850e07e7736260d0ccd9e2c` and contains only the console fix, its changelog, test-helper whitespace and the lock test synchronization fix. The script packs each candidate twice, checks package/version/lock agreement, inspects file boundaries, runs isolated packaged CLI smoke checks, and applies the exact baseline delta plus review patch to the exported 1.2.0 tree. Every resulting file and executable bit must match the corrected 1.3.0 export. It does not change the repository's index, branches or history. The current working-tree package also matches these reviewed bytes (V-034). The earlier 1.3.0 package is retained as `yallaflow-1.3.0-before-review-fixes.tgz`; it is not the final candidate.

## Architecture and changes by version

**1.2.0:** Core read contracts expose snapshots, work details, stations and evidence-derived progress. A workspace lock serializes mutations and ID allocation. A loopback console shows projects, Flow, work details, worktrees, insights and notifications. Create Work calls Core with fixed argv and attachment/idempotency handling; creation does not activate work. Core remains responsible for gates, integrity and truth.

**1.3.0:** opt-in Agent Workspace adds managed Codex sessions through the locally installed ACP adapter. Provider code stays in `src/agents/`; browser routes call the bridge, which uses local session/permission records and a checkout ownership lock. The adapter must report a ChatGPT account login; known API-key environment variables are stripped and full-access modes are refused. Local status reads do not claim an agent session. Tests use isolated user configuration so saved production projects are not opened.

**Claude distribution boundary:** experimental runtime files are absent from this release checkout and explicitly excluded by the package allowlist. Runtime loading refuses with `CLAUDE_NOT_INCLUDED`. Ordinary Claude coding-agent bootstrap documentation remains included. This check proves the package boundary; it does not establish provider policy approval or recover missing development-only experiment files.

**Release corrections discovered during recovery:** opening an existing/new item explicitly loads Agent Workspace state instead of relying on a workspace watcher event. Streamed message chunks preserve Stop/End/composer controls, and activation awaits its refresh. These changes are documented in the 1.3.0 changelog. One trailing blank line was also removed from `test-support/agent-fixtures.js`. The live-holder lock test now uses explicit parent/child synchronization instead of a 1.5-second expiry; production locking is unchanged. New review/rehearsal files are under `research/`; YallaFlow records are updated only through its CLI.

## Verification evidence

Raw commands, timestamps, failures and successful reruns remain in `.yallaflow/work/PF-0039/evidence/verification.json`. An earlier process interrupted by the daemon restart produced no completed run; it is not counted as a pass.

| Check | Outcome / evidence |
| --- | --- |
| Node 22.23.4 syntax + full suite | **PASS: 853/853, no skips**, V-002 |
| Node 20.16.0 full suite | **PASS: 853/853, no skips**, V-029; initial interrupted run is not counted |
| Node 24.13.0 full suite | **852 pass / 1 fail**, V-028: lock fixture expired during slow CLI startup. After synchronizing the fixture, the complete lock test file passed (V-035); no second full-suite pass is claimed |
| Revised lock regression on Node 20 / 22 | **PASS**, V-033 / V-032; targeted name filter selects two live-holder tests |
| Workspace doctor | **PASS**, V-001; 138 informational warnings at that time, including stale historical convergence and missing prior research evidence |
| Reproducible final packages, baseline + review-patch integration, CLI smoke | **PASS**, V-034 and [artifact manifest](artifacts/verification.json) |
| Clean prefix install and upgrade | **PASS**, V-027 on final package bytes: registry dependencies installed; 1.2.0 → 1.3.0 snapshot/work-detail/doctor preserve every workspace byte. `--ignore-scripts` used; dependency install hooks not exercised |
| Acceptance environment startup and shutdown | **PASS**, V-030; two isolated sample projects, no provider started |
| Release diff whitespace | Initial **FAIL** V-004; corrected working tree **PASS** V-006. The old commit itself is unchanged; the final release history must contain the fix |
| Dependency audit | V-005 exits 1: two moderate entries for the same documented `file-type` advisory through `officeparser`; no high/critical findings |
| Chromium 156.0.8078.4 | **PASS**, V-019 on the fixed console; existing-item regression, packed consoles, prototype and simulated session interactions |
| Firefox 156.0 | **PASS**, V-021 on the fixed console; earlier activation wait failure V-010 is retained |
| WebKit 26.0 | **PASS**, V-026 on the fixed console with ordinary pointer clicks. Earlier Stop/load failures and the prematurely completed three-second fake turn remain recorded; final harness gives the disposable turn a longer window |

Browser scenarios: create with Markdown attachment, item/Flow display, no implicit activation, theme regression, mobile RTL, prototype navigation/theme/onboarding/dialog and injection-safe text, and simulated Codex start/stream/deny/stop/end/resume/explicit activation. Screenshots and JSON results are in [screenshots/](screenshots/). These checks use disposable projects and the extracted packages. They are not real subscription tests.

No full 1.2.0 source test-matrix rerun is claimed here; 1.2.0 has fresh package, installation, integration and browser evidence. The full suites preceded the final test-only synchronization edit; focused reruns cover that edit, while browser checks cover the console corrections. This is not a green full matrix on an immutable final commit. Final release CI must test each selected tag separately on its declared matrix. Linux is the environment used; macOS and Windows are not validated by these runs.

## Review findings and limitations

1. **Corrected — release hygiene.** The blank line at the end of the test helper failed the release diff gate. The working-tree correction is verified and does not alter package bytes.
2. **Known residual dependency risk.** `npm audit` still reports `GHSA-5v7r-6r5c-r473`. The repository documents a signature gate before officeparser and no direct call to its vulnerable file-type parser. That is a mitigation, not removal of the dependency or proof that all malformed content is safe. A major parser upgrade is outside this release-preparation change; do not describe the dependency tree as clean.
3. **Browser regressions corrected.** A deterministic existing-item navigation check reproduced the loading failure on the old package (V-016). Explicit view loading fixes it. Streaming now preserves the controls, and activation awaits refresh. Chromium, Firefox and WebKit passed on corrected code. WebKit's short fake turn required a longer test window; no forced-click pass is claimed. Include Stop and activation in real manual acceptance.
4. **Local security boundary.** Reviewed fixed argv dispatch, token/Host/Origin guards, read-only restrictions, optional provider loading, Linux anchored local writes, checkout ownership, session-scoped permission mapping and process cleanup reporting. Unit/security regressions passed on Node 22. The console is not an isolation boundary against arbitrary code already running as the same OS user. Non-Linux path-race/process-cleanup limits remain documented.
5. **Manual acceptance outstanding.** Actual ChatGPT subscription chat, real permission behavior, owner UX acceptance and provider installation readiness are not established by fake ACP tests. The prepared session must record them honestly. No provider authentication or security setting was changed.
6. **Remote release readiness unverified.** The workflow configuration was inspected locally; no GitHub Release, npm publication, remote trusted-publisher setting or CI run was triggered or asserted. Existing local commits are not proof of publication.
7. **Historical evidence missing.** Several research outputs cited by prior completed work are absent. The UX outputs are reconstructed from the preserved request, not represented as the missing originals. Unrelated historical facts and completed records were not rewritten to hide warnings.
8. **Lock test timing corrected.** Node 24's full run exposed a fixture lifetime assumption: the holder could exit before the tested CLI reached the lock. The parent now holds it until the timeout/no-write assertions finish, then explicitly releases it and checks a successful write. The complete lock file and focused Node 20/22 checks pass. The original full-run failure remains visible.

Review was a separate inspection pass over the completed code and package boundaries in this session; it was not a separate-agent security audit. No new production implementation was added by the UX recovery.

## Handoff and decision

Run the single local startup command in [ACCEPTANCE.md](ACCEPTANCE.md), then record one consolidated acceptance decision for both versions. That document contains the exact existing commit references, sequential tag/release plan and rollback/recovery procedure. Publication must stop at the first failed version; do not publish 1.3.0 before verifying 1.2.0.

Review [the workspace proposal](../workspace-evolution/DESIGN.md) and [interactive prototype](../workspace-evolution/prototype.html) separately. Recommended sequencing: retain the current release scope; consider the small activation/onboarding improvements next; design work management/overview before the runtime runner and wizard. Owner review is still needed for browser gate approvals, hold/close semantics, runtime-profile storage and generator execution policy.
