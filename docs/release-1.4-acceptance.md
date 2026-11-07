# 1.4.0 acceptance candidate

Status as of 2026-11-07, branch `feature/workspace-1.4`. **This is not a release.** It is the candidate for the owner's acceptance. It is not merged into `main`, tagged or published.

## What is in it

| Milestone | Work item | Status |
|---|---|---|
| v1.3.0 release fixes carried into 1.4 | PF-0044 | Done |
| Work lifecycle: hold, resume, close without delivery, reopen closed | PF-0041 (and PF-0042, the closed-child regression test) | Done; evidence refreshed |
| Console work management and review-gate decisions (Option B) | PF-0043 | Done; evidence refreshed |
| Project Overview and onboarding | PF-0046 | Done; evidence refreshed |
| Development Runtime Manager | PF-0047 | Done; security-reviewed; evidence refreshed |
| New Project Wizard | PF-0048 | Done; security-reviewed |
| doctor no longer reports a gate awaiting review as a failure | PF-0050 | Done |
| Integration and work-ID reconciliation plan | PF-0045, [`release-1.4-integration.md`](release-1.4-integration.md) | Plan done; merge blocked (see below) |

## Install the candidate without replacing your 1.3.0

Option 1: run it in place. Nothing is installed:

```bash
cd ~/Amasi/YallaFlow-1.4 && npm ci
alias yf14="node ~/Amasi/YallaFlow-1.4/src/cli.js"
yf14 --version            # 1.4.0
```

Option 2: install the packaged candidate. This replaces the global `yallaflow`:

```bash
cd ~/Amasi/YallaFlow-1.4 && npm pack       # yallaflow-1.4.0.tgz
npm install -g ./yallaflow-1.4.0.tgz
# back to the published version: npm install -g yallaflow@1.3.0
```

Use a disposable project for the trials below, not a production repository. `yf14` stands for either option.

## Manual acceptance scenarios

**1. Overview (existing project).** In a copy of an existing project without YallaFlow:
- Run `yf14 init` and `yf14 overview`.
- Expect "Project understanding needed" and a stack table where every row names its file and shows a basis: *declared*, *detected* or *inferred*.
- `.env` values never appear.
- Run `yf14 console` → **Overview** tab. Flow and Work show the same onboarding card. Nothing on the page can start or approve onboarding.

**2. Runtime manager.** In a project with a dev server:
- `yf14 runtime suggest`, then `yf14 runtime add --from-suggestion <n>`. Nothing runs.
- `yf14 runtime start <id>` → refused: not trusted.
- `yf14 runtime trust <id>` in a terminal → type the id.
- `yf14 runtime start <id>` → `running`. Then `yf14 runtime logs <id>`, `restart`, `stop`.
- In the console, **Setup** tab: the same, with Trust needing the typed id.
- Edit the port in `.yallaflow/runtime.yaml` → Start is disabled until you trust it again.
- Kill the service yourself → it shows **failed**, never a false "running".
- Close the console → the service keeps running; `yf14 runtime stop --all` stops it.

**3. New Project Wizard.**
- **In the console:** **All projects → New project**. Choose a parent folder and the **Empty** stack (no network), review the plan, type the hash prefix, then Create.
- **With a real generator (needs the network):** `yf14 new plan --name demo --parent /tmp --stack react-vite`, then `yf14 new create <id> --confirm <prefix>` in a terminal. The project is Greenfield, and `yf14 brief` says "generated code not reviewed".
- **Existing folder:** choose a folder that already exists → refused; nothing is touched.

**4. Work lifecycle and console work management** (unchanged from the earlier 1.4 reports):
- Hold, resume, close and reopen a work item from the CLI and the console.
- Drag a card only to the next station.
- Decide a review gate in the console: type the gate name and a note; it is recorded as "identity not verified".

**5. Old projects.** Open a 1.2.0/1.3.0 project with `yf14`.
- `brief`, `overview`, `snapshot` and the console read it without changing anything.
- Only the first hold or close asks to record the 1.4.0 minimum version.
- `runtime.yaml` is optional and ignored by older CLIs.

## Test results

- **Full suite (`npm run check`):** 902/902 on the final tree (PF-0048 V-003). The final integration run is recorded in PF-0051.
- **Targeted refresh runs:** lifecycle, snapshot and doctor (PF-0041 V-003), console (PF-0043 V-002), overview and console server (PF-0046 V-003), runtime and network guard (PF-0047 V-003).
- **Browser regression** (`research/release-1.4/browser-check.mjs`): Overview, Setup and New project in Chromium, Firefox and WebKit, in English and in Arabic with dark theme, plus mobile at 390 px. All pass with no page errors. Screenshots are in `research/release-1.4/screenshots/`.
- **Real generators, end to end:** Laravel 13.11.0, create-vite 9.3.4 (React; Vue with install), create-next-app 16.4.5 and @nestjs/cli 12.0.12 created and initialized as Greenfield.

## Security reviews

An independent reviewer worked on isolated copies with the real repositories read-only, ran proofs of concept, and re-reviewed every fix.

**Runtime Manager.** Found:
- 4 high: logs rotated through symlinks; hard-linked log files; `stop` signalling processes YallaFlow did not start, through forged run records; trust that could be forged inside the checkout.
- 1 medium: console trust not bound to the definition the user reviewed.
- several low.

All are fixed:
- Trust, run records and locks moved to a 0700 user folder outside the repository.
- Logs are opened only through anchored handles that refuse links, and showing logs never writes.
- Ownership also checks the process group.
- Trust is bound to the definition hash and must be typed by a person.
- Dependencies are trust-checked before anything starts.
- Control and bidirectional-override characters are refused, and reads are FIFO-safe.

**New Project Wizard.** Found:
- 1 medium: `npx` inherited a parent folder's `.npmrc` and `node_modules`.
- several low: a retry could re-label a destination that had been replaced; the progress log followed links; failure output was not redacted; a rename race; plan-store checks; non-interactive create.

All are fixed:
- Staging is npm's own project root, verified with `npm prefix`.
- The destination is claimed exclusively and identity-checked.
- Log reads go through anchored folders.
- Failure output is redacted.
- `create` is limited to a terminal or the console.

## Release blockers (owner decisions needed)

1. **Merge into `main`.** Blocked. Both branches use PF-0041..PF-0043 for different work. A Git merge would mix the histories. The proposed fix is a new, verified `work adopt` command that imports items under new IDs and keeps them byte-identical; it needs your approval first. See [`release-1.4-integration.md`](release-1.4-integration.md).
2. **Release authorization.** Version, tag, GitHub Release and npm publish all need your explicit go-ahead after acceptance.

## Residual risks (documented, not blocking by themselves)

- **Trust covers definitions, not contents.** Command trust covers the definition, not what package scripts or local scripts do.
- **Confirmations are not a security boundary.** "Human decision" confirmations (runtime trust, `new create`) prevent automation from confirming its own actions. A process with full control of your user account can bypass them.
- **Log redaction is best effort.**
- **`project.origin` can be added by hand.** Adding it to a config makes `brief` and the Overview show Greenfield wording. The enforced understanding gate already trusts the recorded `kind`, which can be edited just as easily, so this is advisory. Both are unchanged from earlier versions in principle.
- **cwd symlink-swap race.** A narrow race exists between the runtime's cwd check and the spawn.
- **Windows.** The runtime manager and the wizard are refused on Windows. They are verified on Linux; macOS support follows the same code paths but was not run here.
- **Generators need the network** and are pinned versions. Updating them is a deliberate catalog change.
