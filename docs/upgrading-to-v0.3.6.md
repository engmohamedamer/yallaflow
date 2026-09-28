# Upgrading from v0.3.5 to v0.3.6

v0.3.6 reads a v0.3.5 workspace as-is: **nothing is migrated on read**, and no file changes until you run a command that writes. Upgrades are explicit and can be done one step at a time.

## 1. Install the new CLI

```bash
npm install -g /path/to/yallaflow-0.3.6-internal.1.tgz
yallaflow --version                  # 0.3.6-internal.1
```

In legacy repositories, keep YallaFlow out of the application's dependencies ([installation.md](installation.md#legacy-and-brownfield-repositories)).

## 2. Check the workspace

```bash
yallaflow doctor
```

A healthy v0.3.5 workspace stays healthy. Expect up to two new **warnings** (informational; nothing is changed):

- `AGENT.md agent contract: predates versioned agent contracts …` — see step 3.
- `N v0.3.5 append-only context section(s) are not yet governed by the canonical ledger` — see step 4.

## 3. Refresh the agent contract

v0.3.6 adds agent rules for living project memory, freshness, reconfirm/supersede/dispute, material-artifact capture, argv-first verification, and scope-required direct commands (never guess a scope; use `yallaflow start` + `route` when type or scope is unknown). Existing `AGENT.md` files are never overwritten automatically.

```bash
yallaflow agent status
yallaflow agent refresh --dry-run    # preview
yallaflow agent refresh
```

- If your `AGENT.md` is exactly what an earlier YallaFlow generated, it is replaced with the versioned managed contract.
- If you customized it, `refresh` refuses. Use `yallaflow agent refresh --preserve-existing` to install the managed contract and keep your previous content verbatim under *Preserved project instructions* — then remove the superseded YallaFlow guidance from that section and keep your project-specific rules.
- A workspace that already has a v1 managed block (from a pre-release v0.3.6 build) is reported as `outdated (v1 → v2)` and upgraded in place.
- Future refreshes update only the managed block; content outside it is kept. Running `refresh` again changes nothing.

## 4. Bring project context under living memory (optional)

> **With v0.3.7 or later installed:** legacy facts are brought under the ledger through reviewed reconciliation (`yallaflow context reconcile start`), and `context adopt` imports directly only when that is provably duplicate-free. See [upgrading-to-v0.3.7.md](upgrading-to-v0.3.7.md#4-reconcile-legacy-project-context). The text below describes v0.3.6.

Existing `PROJECT.md`/`context/*.md` sections from v0.3.5 remain valid Markdown. The canonical ledger (`context/index.yaml`) is created automatically by the next baseline approval or knowledge promotion; new facts then appear in a managed block alongside the old sections.

To govern the old facts too — so they can be reconfirmed, superseded, or disputed:

```bash
yallaflow context adopt --dry-run    # lists approved baseline facts and promoted candidates to import
yallaflow context adopt
yallaflow context status
```

Adoption reads the structured work records (`baseline.yaml`, `knowledge.yaml`), never rewrites them, and removes only legacy Markdown sections that still exactly match what v0.3.5 generated. Hand-edited sections are left in place and reported. Adopted facts show `UNKNOWN` freshness (their original verification point is unknown) until you reconfirm them with fresh evidence.

## 5. Commit

```bash
git add .yallaflow && git commit -m "Upgrade YallaFlow workspace to v0.3.6"
```

## Behavior changes to know

| Area | v0.3.5 | v0.3.6 |
|---|---|---|
| Direct commands (`feature`, `bug`, `investigate`, …) | created contract-less work; scope optional | require `--scope`; create routed work with a pinned Behavior Contract (same as `start` → `route`) |
| Investigation DONE | could reach DONE without the verification checkpoint | DONE requires the completed verification checkpoint, which requires recorded successful evidence |
| Completing `verification` on read-only work | allowed without evidence | requires fresh successful `yallaflow verify` evidence |
| Failing `verify` after the checkpoint was completed | left the checkpoint completed | returns the checkpoint to `in_progress` (audited) |
| `verify` on DONE work | appended a run | refused — reopen first (or start new work for investigations) |
| `intake add` on DONE work | attached silently | requires `--reason`; recorded as a recovered source |
| Knowledge promotion | appended a Markdown section | writes a `CTX-####` fact to the ledger and re-renders the managed block |
| Rendered context labels | `**Status:** confirmed` | `**State:**` and `**Confidence:**` |
| New work item layout | eager `attachments/`, `evidence/`, `execution/` | only `meta.yaml`, `work.md`, `progress.md`; others appear when written |
| Baseline refresh | not supported | still not supported; living memory keeps knowledge current |

Existing contract-less work items (created by earlier direct commands) keep loading and keep their stage-only behavior. Existing empty directories are never deleted.

## Mixed versions and downgrades

Do not use v0.3.5 and v0.3.6 on the same workspace. Once v0.3.6 has written new fields (knowledge candidate relations and fact IDs, source link metadata, the context ledger), v0.3.5 may reject those files or report integrity failures. Upgrade everyone who works on the repository together. Downgrading after v0.3.6 has written to the workspace is not supported.
