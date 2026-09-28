# Codex Adapter

YallaFlow is agent-agnostic: the only behavioral contract is the workspace's `.yallaflow/AGENT.md`, generated and versioned by YallaFlow. This adapter does not restate it.

## Setup

```bash
yallaflow agent setup codex      # adds a managed bootstrap block to the repository-root AGENTS.md
yallaflow agent status             # AGENT.md and bootstrap block: current / outdated / modified / not set up
yallaflow agent refresh            # after upgrading YallaFlow
```

Codex reads `AGENTS.md` but has no import syntax, so the block tells the agent to read `.yallaflow/AGENT.md` before any project work.

The block contains only the session-start sequence:

1. Confirm `.yallaflow/` exists.
2. Follow `.yallaflow/AGENT.md`.
3. Run `yallaflow brief`.
4. `yallaflow resume` / `yallaflow handoff` the active work.
5. `yallaflow guide` for the current objective and next valid action.
6. Follow the pinned Behavior Contract.
7. Record progress and evidence only through `yallaflow` commands.

Existing content in `AGENTS.md` is preserved byte-for-byte; only the managed block is ever updated, and a hand-edited block is refused unless `--preserve-existing`. See [`docs/guide.md`](../../../docs/guide.md#agent-bootstrap-codex-claude).
