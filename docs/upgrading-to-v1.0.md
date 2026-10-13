# Upgrading to 1.0

YallaFlow 1.0.0 is the first public npm release. It is the `0.3.10-internal.4` product declared stable: **no behavior, workspace format, Agent Contract, bootstrap block, Skill Registry, Knowledge Policy, or schema changes**. Only the package version, the npm packaging, and the documentation changed.

## 1. Install from npm

```bash
npm install -g yallaflow
yallaflow --version                  # 1.0.0
yallaflow upgrade status             # read-only: what the workspace needs
```

If you installed a prerelease from a Git tag or tarball, the npm install replaces the `yallaflow` command on your `PATH`. Check with `which yallaflow` if you used a custom tools prefix.

## 2. From 0.3.10-internal.4

Nothing to do. The workspace, the agent guidance (Agent Contract v8, bootstrap block v2), and every work item's pinned Behavior Contract are unchanged; `upgrade status` reports the workspace as current.

A Shared Project records `yallaflow.minimumVersion: 0.3.10-internal.1`; 1.0.0 satisfies it, so teammates on any `0.3.10-internal.N` and on 1.0.0 can work on the same project. Upgrade everyone and CI together anyway (`npm install -g yallaflow@1.0.0` pins the exact version).

## 3. From an earlier 0.3.x prerelease

1.0.0 reads every supported earlier workspace as-is; nothing is migrated on read. Follow `yallaflow upgrade plan`, which lists the explicit commands your workspace needs — typically refreshing the agent guidance:

```bash
yallaflow agent refresh --dry-run
yallaflow agent refresh
yallaflow doctor
```

For what changed in behavior along the way, read the prerelease upgrade notes in order from the version you are on: [v0.3.6](upgrading-to-v0.3.6.md), [v0.3.7](upgrading-to-v0.3.7.md), [v0.3.8](upgrading-to-v0.3.8.md), [v0.3.9](upgrading-to-v0.3.9.md), [v0.3.10](upgrading-to-v0.3.10.md).

## 4. What 1.0 promises from here

From 1.0.0, YallaFlow follows Semantic Versioning: PATCH for backward-compatible fixes and documentation, MINOR for backward-compatible functionality, MAJOR for incompatible CLI or durable workspace behavior. Work items keep their pinned behavior, released skill instructions stay immutable, supported workspaces stay readable, and historical work is never silently rewritten. The full promise is in [releasing.md](releasing.md#semantic-versioning-and-the-10-compatibility-promise).

## Versions at 1.0.0

| Version domain | Value | Changed by 1.0.0? |
|---|---|---|
| Package | `1.0.0` | yes (from `0.3.10-internal.4`) |
| Agent Contract | v8 | no |
| Agent bootstrap block | v2 | no |
| Skill Registry | v8 | no |
| Knowledge Policy | v1 | no |
| Workspace/schema versions | unchanged | no |
