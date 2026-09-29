# Installation

YallaFlow is a Node.js CLI. It needs **Node.js ≥ 20.16.0** to run — this is a requirement of the CLI, not of your application, which can use any language or Node version. YallaFlow is not published to the npm registry yet; install from a release tarball (`yallaflow-<version>.tgz`) or a checkout.

## Recommended: an isolated CLI

Install YallaFlow as a tool, separate from any project's dependencies:

```bash
npm install -g /path/to/yallaflow-<version>.tgz
yallaflow --version
```

If you prefer not to install globally, use a dedicated tools prefix and put its `bin` on your `PATH`:

```bash
npm install --prefix ~/.local/yallaflow /path/to/yallaflow-<version>.tgz
export PATH="$HOME/.local/yallaflow/node_modules/.bin:$PATH"
```

From a checkout (for YallaFlow development): `npm install && npm link`.

## Legacy and Brownfield repositories

**Do not install YallaFlow as a dependency or devDependency of a legacy application.** `npm install --save-dev yallaflow…` inside the application makes npm resolve the application's entire dependency tree. On an old project that can rewrite `package-lock.json`, upgrade transitive dependencies, or fail on engine constraints — changes unrelated to your work and hard to review.

Instead:

1. Install the CLI globally or in a tools prefix (above). YallaFlow never reads or modifies the application's `package.json` or lockfile.
2. If the application pins an older Node version (for example via `nvm` or `.nvmrc`), run YallaFlow with a Node ≥ 20.16 binary from its own install, and keep the application's toolchain for building and testing it. `yallaflow verify -- <command>` runs your project's commands in your current environment.
3. Run `yallaflow inspect` at the repository root (read-only; works before `init`) to see how YallaFlow classifies the repository, then `yallaflow init`, then follow the [Brownfield workflow](workflows.md#brownfield).

## After installing

```bash
cd your-project
yallaflow init
yallaflow agent setup codex     # optional: or `claude` — a thin pointer in AGENTS.md / CLAUDE.md
git add .yallaflow && git commit -m "Initialize YallaFlow"
```

`.yallaflow/` is durable project state and is meant to be committed; `doctor` warns when it is neither tracked nor deliberately ignored. Review [`security.md`](security.md) before capturing files that might contain sensitive data.

Upgrading an existing workspace: run `yallaflow upgrade status`, then see [`upgrading-to-v0.3.9.md`](upgrading-to-v0.3.9.md) (and [`upgrading-to-v0.3.8.md`](upgrading-to-v0.3.8.md), [`upgrading-to-v0.3.7.md`](upgrading-to-v0.3.7.md), [`upgrading-to-v0.3.6.md`](upgrading-to-v0.3.6.md) for earlier changes).

## Updating YallaFlow

YallaFlow never checks for, downloads, or installs updates by itself — there is no self-update and no network version check. Updating is a deliberate, local sequence:

1. **Install the target version.** Use the release tarball, or a checkout of the target tag (for example `git checkout v0.3.9-internal.1 && npm install && npm link`):

   ```bash
   npm install -g /path/to/yallaflow-<version>.tgz
   ```

2. **Confirm the installed version.** Update every machine and CI job that operates on the same workspace together.

   ```bash
   yallaflow --version
   ```

3. **Assess, read-only.** This reports the agent contract, provider bootstrap blocks, legacy structures, and integrity, as ordered commands.

   ```bash
   yallaflow upgrade status
   yallaflow upgrade plan
   ```

4. **Refresh the agent guidance explicitly.** YallaFlow never rewrites `AGENT.md` or a provider bootstrap block on its own. Preview first with `--dry-run`; use `--preserve-existing` if the managed block was hand-edited.

   ```bash
   yallaflow agent refresh --dry-run
   yallaflow agent refresh
   ```

5. **Check health.**

   ```bash
   yallaflow doctor
   ```

6. **Commit** the updated `.yallaflow/` (and `AGENTS.md` / `CLAUDE.md`, if refreshed).

Read the version's `upgrading-to-<version>.md` for behavior changes. Downgrades are not supported once a newer version has written to a workspace.
