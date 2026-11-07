# One consolidated acceptance session

Use the installed 1.3.0 candidate to review both the 1.2.0 console and 1.3.0 Agent Workspace. This session is the owner's acceptance, not a second automated test run. The UX proposal is a separate [offline preview](../workspace-evolution/prototype.html); its future controls are not release features.

## Start

From the repository root, after `install-check.mjs` has passed:

```bash
node research/release-review/acceptance.mjs
```

Open the private loopback link printed in that terminal. The command creates fresh sample projects and an isolated console registry, so no saved production project is opened. It does not install or start a provider; start Codex explicitly from the Agent panel. It uses the existing provider installation and login. Never copy tokens or credentials into a review report.

If the temporary installation was removed, rebuild with `node research/release-review/verify-artifacts.mjs`, then `node research/release-review/install-check.mjs`. Installation downloads dependencies into a temporary prefix and skips dependency install hooks. `--no-agents` starts the manual console without agent controls. Ctrl-C stops the console and managed sessions; scratch projects are retained.

## Checklist — record Pass / Fail / Not run with a short observation

| Area | Action and expected result |
| --- | --- |
| Projects | Switch between the new and existing sample projects. The existing project explains the baseline gate; it cannot silently create normal engineering work. |
| Create work | In the greenfield project, create a work item with a harmless Markdown attachment. Request, source availability and item page agree. Existing active work stays active. |
| Flow and evidence | Inspect the five stations, request, source preview and next-step explanation. Pending work is not delivered/100%. CLI `snapshot --json` and `work show <id> --json` agree with the UI. |
| Browser experience | Change language and theme; click panels and navigation. Theme remains stable. Inspect a narrow viewport and keyboard focus, dialog Escape, and mobile RTL. |
| Real Codex login | Detect the installed tools. Start a session using the existing ChatGPT login. No API key is requested. Missing/unsupported adapter or login is reported, not silently installed or changed. |
| Real interaction | Ask for a brief read-only description of this sample project. Observe streamed reply. Confirm which work is active. This is the real provider check; automated fake-provider tests do not replace it. |
| Permissions | In the disposable project, request a harmless action that needs permission under the chosen mode. Inspect the exact prompt; test Deny and an offered single-use Allow. If the provider does not prompt for the selected action, record Not exercised rather than Pass. Session-scoped Allow appears only when offered by the provider. |
| Stop / End / Resume | Stop a running turn, end the session, then resume when offered. Check the app's reported cleanup result. No unverified leftover process is reported as clean. |
| Activation | Make the new item active explicitly; confirm the CLI active item changes. Creating or starting a session alone must not switch it. |
| Shutdown | Ctrl-C. Console and owned session stop; production projects and saved global registry remain unchanged. |

Automated install/upgrade, packaging, security and browser results are in [REPORT.md](REPORT.md). Record genuine manual findings before issuing a single acceptance decision for both releases. Publication remains a separate explicit authorization.

## Release sequence after authorization

The repository already contains separate local commits: `bc14db05fd60668c4da6da3437ecc7fc7b1816b5` (1.2.0) then `b700b2cb9d0f0d8eee1f440dc8484c8bb7382d14` (1.3.0 base). The console fixes, changelog, test-helper whitespace fix, lock test synchronization fix and review artifacts are uncommitted. The final candidate includes the [recorded review patch](artifacts/1.3.0-review-fixes.patch). No commit, tag, branch integration or publication has been performed by this recovery.

1. Review the complete Git diff and choose exactly which recovery files to commit. Keep unrelated research and user changes separate. The console fix, changelog and both test corrections belong in the final 1.3.0 release history. Do not rewrite the existing commits or released tags.
2. Verify selected release commits are on `origin/main`, package/version/changelog agree, the Node 20/22/24 CI matrix passes, and trusted publishing is configured. Local inspection cannot establish remote settings or CI success.
3. Tag the approved **1.2.0 commit** with `v1.2.0` and push only the authorized commits/tag. Publish the 1.2.0 GitHub Release; the workflow may publish to npm automatically. Verify that publication, registry version, integrity and install before proceeding.
4. Tag the approved **final 1.3.0 commit**, containing all reviewed corrections, with `v1.3.0`; push and publish its GitHub Release. Verify registry publication and installation. Do not point both versions at a combined tag or update a tag after publication.
5. Compare packages built from the final tagged commits with the reviewed checksums. The original 1.3.0 base package is superseded by the candidate with the recorded patch; use the final hash in REPORT.md.

The workflow is `.github/workflows/release.yml`: it checks tag/version/prerelease and ancestry, runs the matrix, packs/smokes the artifact, then publishes with provenance. It is triggered by publishing a GitHub Release, not by this preparation. The exact final 1.3.0 commit hash does not exist until the owner commits the reviewed fix.

## Rollback and recovery

Before upgrading real projects, retain a backup of their `.yallaflow/` and use a disposable copy for acceptance. Reads must not migrate data. Before publication, a failed candidate can be replaced and reverified without touching production. After publication, never overwrite a version or move its tag: stop the sequence, retain failed logs, fix forward with a new patch version, and restore a previously verified package in a separate local prefix if needed. Do not erase project history or blindly revert schema/state. Changing npm dist-tags, deprecation or publishing a fix requires explicit owner authorization.
