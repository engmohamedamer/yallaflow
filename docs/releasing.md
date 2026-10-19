# Releasing

YallaFlow is published to npm as [`yallaflow`](https://www.npmjs.com/package/yallaflow). `1.0.0` is its first public release and a deliberate stability boundary: from `1.0.0` onward the package follows standard [Semantic Versioning](https://semver.org/) with the compatibility promise below. Earlier versions (`0.2.0-internal.1` … `0.3.10-internal.4`) were internal prereleases, git-tagged only and never published to npm; their tags stay immutable.

## Versioning model

YallaFlow tracks **five independent version numbers**. They are not tied together, and a change to one does not imply a change to another.

| Version | Lives in | Identifies |
| --- | --- | --- |
| **Package version** | `package.json` `version` | The published npm package (CLI + built-in skill instructions + docs). What a consumer `npm install`s. |
| **Skill Registry version** | `src/skills/constants.js` (`REGISTRY_VERSION`) | The set and shape of built-in skills, their capabilities, prerequisites, and modes. Pinned into every routed work item's Behavior Contract. |
| **Knowledge policy version** | `src/knowledge/constants.js` (`KNOWLEDGE_POLICY_VERSION`) | Whether knowledge review is required before `DONE`, and how it is evaluated. Pinned into new work items' `meta.yaml`. |
| **Agent contract version** | `src/agent/contract.js` (`AGENT_CONTRACT_VERSION`) | The YallaFlow-managed guidance block in each workspace's `AGENT.md`. Existing workspaces are told (never forced) to refresh with `yallaflow agent refresh`. The provider bootstrap block (`src/agent/bootstrap.js`, `BOOTSTRAP_VERSION`) in `AGENTS.md`/`CLAUDE.md` is versioned the same way. |
| **Workspace/schema version** | `schemaVersion` fields in `config.yaml`, `state/current.yaml`, `progress.yaml`, `knowledge.yaml`, `questions.yaml`, `context/index.yaml`, `discovery.yaml`, `baseline.yaml`, `requirements.yaml`, `convergence.yaml`, `impact.yaml`, `source.json` | The on-disk shape of each durable file. |

A package release can ship without bumping the registry, policy, or schema versions (pure CLI/doc changes). Conversely, bumping the registry version (e.g. adding a new skill to the architectural chain) is a behavior-contract change that deserves its own changelog entry regardless of the package version it ships in. **Never infer one version from another.**

Work items pin the registry and knowledge-policy versions active when they were routed/created. A later package upgrade must never rewrite an existing work item's pinned versions — see the [architecture freeze](architecture.md#architecture-freeze-entering-v03).

## Semantic Versioning and the 1.0 compatibility promise

The **package version** follows SemVer from `1.0.0`:

- **PATCH (`1.0.x`)** — backward-compatible bug fixes and documentation corrections.
- **MINOR (`1.x.0`)** — backward-compatible functionality: new commands, flags, skills, workflow capabilities, or additive fields in durable files that older 1.x readers tolerate.
- **MAJOR (`x.0.0`)** — incompatible public CLI behavior (removed or changed commands, flags, or exit semantics a script or agent relies on), incompatible durable workspace behavior, or any other compatibility break that cannot be handled through backward-compatible reads or migrations.

The public surface this promise covers: the `yallaflow` command line (commands, flags, exit codes, and the documented outcome lines agents act on), the durable `.yallaflow/` workspace format, the Agent Contract and bootstrap blocks YallaFlow writes, and pinned Behavior Contracts. Internal modules under `src/` are not a programmatic API.

What every 1.x release guarantees:

- **Work items retain their pinned behavior.** A work item keeps the Skill Registry version, instruction versions, and Knowledge Policy it was routed with. An upgrade never re-pins existing work.
- **Released skill instructions are immutable.** Every instruction version a registry ever pinned is shipped byte-for-byte (hash-pinned in `src/skills/instructions.js`, archived under `resources/skills/archive/`). Changing an instruction means a new instruction version under a new registry version, never an edit to a released one.
- **Existing supported workspaces remain readable.** Every workspace written by a supported earlier release — including the `0.x` internal prereleases the test suite covers — loads without mutation. Reads never migrate; a format change is an additive, backward-compatible read or an explicit, documented command.
- **YallaFlow never silently rewrites historical work.** Work records, progress ledgers, evidence, sources, and baseline history are append-only history; project memory evolves through new, related facts (reconfirm, supersede, dispute), not by editing the past.
- **Agent guidance is refreshed explicitly.** A newer Agent Contract or bootstrap block is reported by `brief` / `agent status` / `upgrade status` and applied only by `yallaflow agent refresh`.

### Independent version domains

The package version and the internal version domains in the table above move **independently**. `1.0.0` itself bumps only the package version: Agent Contract v8, bootstrap block v2, Skill Registry v8, Knowledge Policy v1, and every workspace/schema version are unchanged from `0.3.10-internal.4`, because no behavior or durable shape changed. A domain version is bumped if and only if its own behavior or shape changes, and that bump is not by itself a MAJOR package release — it is MAJOR only when it breaks the compatibility promise above (for example, a schema an earlier 1.x CLI must read but cannot).

Workspace/schema evolution is handled through **additive, backward-compatible reads** wherever possible — see [`architecture.md`](architecture.md) and the compatibility tests (v0.1 work, v0.2.1 unpinned contracts, v0.2.2 missing ledgers, v0.2.3 missing knowledge policy, v0.3.5 legacy context, v0.3.9 pins all continue to load without mutation). A newer workspace may be refused by an older CLI with a clear message (for example a Shared Project's `yallaflow.minimumVersion`); it is never silently rewritten.

## Release checklist

Run in order from a clean checkout. Nothing is committed, tagged, pushed, or published without the maintainer's explicit approval.

```text
[ ] npm ci && npm run check           # syntax check + full test suite green
[ ] yallaflow doctor                  # on YallaFlow's own workspace (node src/cli.js doctor):
                                       # Skill Registry hashes, Agent Contract, lifecycle integrity
[ ] npm audit                         # classify every finding (see below); never claim zero
                                       # vulnerabilities while a known advisory remains
[ ] npm pack --dry-run                # confirm the packaged file set (the `files` allowlist)
[ ] npm pack                          # inspect the real tarball: file list + secret scan
[ ] packed-candidate smoke test       # install the tarball into an isolated prefix; then
                                       # --version, init (Greenfield and Brownfield), Claude and
                                       # Codex bootstraps, the Brownfield first-request gate,
                                       # a Shared Project clone, doctor
[ ] provider/inference scan           # no model-provider or telemetry code in src/; network code only in
                                       # src/intake/providers/ (opt-in `intake ticket --fetch`), loaded lazily
[ ] git diff --check                  # no whitespace errors
[ ] CHANGELOG.md updated              # new section under the version being released
[ ] version bumped                    # package.json + src/version.js, deliberately; domain
                                       # versions bumped separately if and only if they changed
[ ] git tag vX.Y.Z (annotated)        # matching the package version; tags are never moved
[ ] npm publish                       # automated: see "Publishing to npm"
[ ] GitHub release                    # from the tag, linking the CHANGELOG section
```

## Publishing to npm

The preferred flow is **GitHub Release → GitHub Actions → npm publish with provenance**, using npm [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC). No long-lived npm token is stored in the repository or its secrets.

`.github/workflows/release.yml` runs when a GitHub Release is published, in three jobs:

- **guard** — the release tag equals `v` + `package.json` `version`, the GitHub prerelease flag matches the version, and the tagged commit is on `main`; then it asks the registry whether this version already exists. An existing version ends the run with a notice (nothing is tested or published); a registry error fails it.
- **test** — `npm ci` and `npm run check` on Node 20, 22, and 24 (the `engines` range), with full Git history so the mixed-version tests run real frozen releases.
- **publish** — on Node 24 (bundled npm ≥ 11.5.1, required for Trusted Publishing): pack and smoke-test the tarball from an isolated prefix, then `npm publish --provenance` with `--tag latest` for a stable version or `--tag next` for a prerelease. npm exchanges the job's OIDC identity for a short-lived publish credential; only this job has `id-token: write`.

Actions are pinned by commit SHA, checkouts do not persist credentials, and runs never overlap (`concurrency`).

Preconditions: the GitHub repository is public (provenance for a public package requires it) and `package.json` `repository.url` matches it exactly (`git+https://github.com/engmohamedamer/yallaflow.git`). A version is published at most once, so publishing the GitHub Release for a version that was published manually is harmless.

### First publication (1.0.0) — one time

npm configures a trusted publisher in an existing package's settings, so the first version, `1.0.0`, is published manually by the package owner; automation takes over from the next release. In order:

1. **Freeze the release.** Commit, create the annotated tag `v1.0.0` on `main`, and push `main` and the tag. Do not publish the GitHub Release yet.
2. **Publish manually from the tagged checkout**, with an npm account that has 2FA enabled:

   ```bash
   git checkout v1.0.0 && git status          # clean
   npm ci && npm run check
   npm pack                                   # inspect; this is the exact artifact
   npm login                                  # interactive; never paste tokens into files or chats
   npm publish --dry-run yallaflow-1.0.0.tgz
   npm publish yallaflow-1.0.0.tgz            # access public (publishConfig), dist-tag latest; 2FA prompt
   npm view yallaflow version dist-tags       # 1.0.0, latest: 1.0.0
   ```

   The manual first publish has no provenance attestation (provenance is generated only from a supported CI provider).
3. **Lock publishing down** (npmjs.com → package `yallaflow` → Settings → Publishing access): *Require two-factor authentication and disallow tokens*. Interactive 2FA publishing by the owner and trusted publishing keep working; no token can publish.
4. **Publish the GitHub Release `v1.0.0`** with `.github/release-notes/v1.0.0.md`. The workflow runs, sees `1.0.0` already on npm, and ends with a notice — it cannot publish `1.0.0` twice (and npm refuses a republished version regardless).

### Enabling Trusted Publishing (with the first automated release)

npm expires a newly created trusted publisher configuration that has not completed a successful publish **within 2 days**. Create it when the next release (`1.0.1`, `1.1.0`, …) is ready, not right after `1.0.0`:

1. Bump the version, update the CHANGELOG, commit, tag, and push (the GitHub Release not yet published).
2. **Create the trusted publisher** (npmjs.com → package `yallaflow` → Settings → Trusted Publisher → GitHub Actions): organization or user `engmohamedamer`, repository `yallaflow`, workflow filename `release.yml`, environment empty. Fields are case-sensitive and npm validates them only at publish time.
3. **Publish the GitHub Release** the same day. The workflow tests and publishes with provenance; this first successful publish binds the configuration to the repository.

If that publish fails or misses the 2-day window, delete the configuration, create a new one, and re-run the release workflow. Every later release is only: bump, commit, tag, push, publish the GitHub Release.

Trusted publishing requires GitHub-hosted runners, npm ≥ 11.5.1 and Node ≥ 22.14 in the publishing job (the workflow publishes on Node 24), and a workflow that is not a reusable (`workflow_call`) workflow.

## Known residual security considerations

- **`file-type` DoS advisory ([GHSA-5v7r-6r5c-r473](https://github.com/advisories/GHSA-5v7r-6r5c-r473)), moderate.** Present in the dependency tree as an internal dependency of `officeparser`. **Mitigated, not resolved**: YallaFlow's own format detection (`src/intake/detect.js`) never calls the vulnerable package, and every file reaching `officeparser` has already passed our own signature gate first. `npm audit` reports this one advisory as **2 moderate entries** (`file-type` itself and `officeparser`, which depends on it) and will continue to report it on every check until `officeparser` ships a major version without it that also drops the OCR (`tesseract.js`) dependency we deliberately avoid — see `CHANGELOG.md`'s "Parser decisions" for the full evaluation. Re-evaluate on every `officeparser` upgrade; do not assume a clean release note means a clean `npm audit`.
