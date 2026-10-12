# Claude Adapter

YallaFlow is agent-agnostic: the only behavioral contract is the workspace's `.yallaflow/AGENT.md`, generated and versioned by YallaFlow. This adapter does not restate it.

## Setup

`yallaflow init` installs this block automatically (v0.3.10-internal.3), together with the other first-party provider's. The explicit commands are for recovery and manual control:

```bash
yallaflow agent setup claude      # adds a managed bootstrap block to the repository-root CLAUDE.md
yallaflow agent status             # AGENT.md and bootstrap block: current / outdated / modified / not set up
yallaflow agent refresh            # after upgrading YallaFlow
```

The block imports the contract with Claude Code's documented `@.yallaflow/AGENT.md` import (resolved relative to `CLAUDE.md`), so a Claude Code session loads it at launch.

The block contains only the session-start sequence, run automatically before the first request (the developer never has to say "use YallaFlow"):

1. Confirm `.yallaflow/` exists.
2. Follow `.yallaflow/AGENT.md`.
3. Run `yallaflow brief`.
4. `yallaflow resume` / `yallaflow handoff` the active work.
5. `yallaflow guide` for the current objective and next valid action.
6. Follow the pinned Behavior Contract.
7. Record progress and evidence only through `yallaflow` commands.
8. Before saying a task is done, run `yallaflow finish <work-id>` and relay its outcome.

In a [Shared Project](../../../docs/shared-projects.md), commit this file with `.yallaflow/` so every teammate's sessions orient automatically.

Existing content in `CLAUDE.md` is preserved byte-for-byte; only the managed block is ever updated, and a hand-edited block is refused unless `--preserve-existing`. See [`docs/guide.md`](../../../docs/guide.md#agent-bootstrap-codex-claude).
