# Releasing

YallaFlow has not yet made a public npm release (`package.json` remains `"private": true` at version `0.2.0`). This document defines the release policy the project will follow once publishing begins, and the checklist a maintainer runs before cutting a release.

## Versioning model

YallaFlow tracks **four independent version numbers**. They are not tied together, and a change to one does not imply a change to another.

| Version | Lives in | Identifies |
| --- | --- | --- |
| **Package version** | `package.json` `version` | The published npm package (CLI + built-in skill instructions + docs). What a consumer `npm install`s. |
| **Skill Registry version** | `src/skills/constants.js` (`REGISTRY_VERSION`) | The set and shape of built-in skills, their capabilities, prerequisites, and modes. Pinned into every routed work item's Behavior Contract. |
| **Knowledge policy version** | `src/knowledge/constants.js` (`KNOWLEDGE_POLICY_VERSION`) | Whether knowledge review is required before `DONE`, and how it is evaluated. Pinned into new work items' `meta.yaml`. |
| **Workspace/schema version** | `schemaVersion` fields in `config.yaml`, `state/current.yaml`, `progress.yaml`, `knowledge.yaml`, `questions.yaml` | The on-disk shape of each durable file. |

A package release can ship without bumping the registry, policy, or schema versions (pure CLI/doc changes). Conversely, bumping the registry version (e.g. adding a new skill to the architectural chain) is a behavior-contract change that deserves its own changelog entry regardless of the package version it ships in. **Never infer one version from another.**

Work items pin the registry and knowledge-policy versions active when they were routed/created. A later package upgrade must never rewrite an existing work item's pinned versions — see the [architecture freeze](architecture.md#architecture-freeze-entering-v03).

## Semantic Versioning, pre-1.0

YallaFlow follows [SemVer](https://semver.org/), interpreted for a `0.x` package: public APIs and workspace formats are still evolving, so **any** `0.x` release may contain breaking changes, per the SemVer spec itself. Until `1.0.0`, YallaFlow additionally distinguishes:

- **Patch release (`0.x.Y`)** — bug fixes, documentation, internal refactors with no observable CLI or workspace-format change.
- **Minor release (`0.X.y`)** — new CLI commands/flags, new skills or workflow stages, or other additive, non-breaking behavior.
- **Breaking pre-1.0 release** — a change to an existing command's flags/output shape, a workspace/schema-file format change, or a Skill Registry change that alters previously-pinned semantics for *newly routed* work. Called out explicitly in the CHANGELOG under its own heading; still expressed as a `0.x` bump (most often minor) since the package has not reached `1.0.0`.

Reaching `1.0.0` will itself be a deliberate decision, documented in the CHANGELOG, once the CLI surface, workspace schema, and Behavior Contract model are considered stable enough to promise standard SemVer compatibility guarantees.

Workspace/schema migrations (when a durable file's `schemaVersion` must change) are handled as **additive, backward-compatible reads** wherever possible — see the compatibility behavior already documented in [`architecture.md`](architecture.md) and exercised by the test suite (v0.1 work, v0.2.1 unpinned contracts, v0.2.2 missing ledgers, v0.2.3 missing knowledge policy all continue to load without mutation). A migration that cannot be read compatibly requires its own explicit, documented decision before release.

## Release checklist

Run in order. Every step should be reproducible from a clean checkout.

```text
[ ] npm run check                     # syntax check + full test suite green
[ ] node -e "require('./src/skills/validation.js')…"  # Skill Registry validation (see doctor)
[ ] npm pack --dry-run                # confirm packaged file set and size
[ ] standalone smoke test             # install the packed tarball into an empty
                                       # directory and run init → start → route →
                                       # guide → checkpoint → advance → ready → resume
[ ] provider/inference scan           # confirm no model-provider calls or semantic
                                       # inference were introduced (grep src/ resources/)
[ ] workspace compatibility           # legacy-work compatibility tests still pass
[ ] CHANGELOG.md updated              # new section under the version being released
[ ] version bumped                    # package.json, deliberately — see the versioning
                                       # model above; registry/policy/schema versions
                                       # bumped separately if and only if they changed
[ ] git tag                           # matching the package version
[ ] npm publish                       # remove "private": true first, deliberately
[ ] GitHub release                    # from the tag, linking the CHANGELOG section
```

This milestone (v0.2.6) does not execute any of the last five steps — no version bump, tag, publish, or GitHub release. It only establishes this policy and checklist.
