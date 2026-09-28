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
3. Run `yallaflow init` at the repository root, then follow the [Brownfield workflow](workflows.md#brownfield).

## After installing

```bash
cd your-project
yallaflow init
git add .yallaflow && git commit -m "Initialize YallaFlow"
```

`.yallaflow/` is durable project state and is meant to be committed; `doctor` warns when it is neither tracked nor deliberately ignored. Review [`security.md`](security.md) before capturing files that might contain sensitive data.

Upgrading an existing workspace: run `yallaflow upgrade status`, then see [`upgrading-to-v0.3.7.md`](upgrading-to-v0.3.7.md) (and [`upgrading-to-v0.3.6.md`](upgrading-to-v0.3.6.md) for the v0.3.5 → v0.3.6 changes).
