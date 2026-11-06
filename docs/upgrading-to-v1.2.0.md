# Upgrading to 1.2.0

1.2.0 adds a local console (read-only, plus one Create Work action), a versioned JSON read contract, and a workspace write lock. It is a backward-compatible minor release.

## Steps

```bash
npm install -g yallaflow@1.2.0
yallaflow --version      # 1.2.0
yallaflow doctor         # integrity check; also reports a workspace lock if one is held
yallaflow console        # optional: the browser view (add --read-only to turn Create Work off)
```

**Nothing else is needed:**

- **No new dependency or service.** The console runs only while you run it.
- **No `agent refresh`.** The Agent Contract (v10), the bootstrap blocks, the Skill Registry (v9), the Knowledge Policy, and every workspace schema version are unchanged.
- **No migration.** Existing work items, project memory, sources, and evidence load as before. Nothing is rewritten.

## What changes in behavior

- **The workspace lock.**
  - Commands that write `.yallaflow/` now take a short lock (`.yallaflow/local/lock`).
  - If two YallaFlow commands write in the same checkout at the same moment, the second waits up to 60 s, then stops with "The workspace is busy" and changes nothing. Before 1.2.0 they could overwrite each other's records or create the same work ID.
  - Read-only commands never wait.
  - In a single-user workspace the lock leaves no `local/` directory behind.
- **Atomic state files.** YallaFlow's state files are now replaced atomically, keeping their permissions. A reader never sees a half-written file.
- **`verify` output.** `verify` prints the verified command's output before recording the run, and waits (up to 5 minutes) for the lock rather than discarding a finished run.
- **Contained source text.** Reading a source's extracted text (`source show --content`) refuses a path that leaves the source's own directory.
- **New commands.** `snapshot`, `work show`, `console`, `console add|remove|list`, and `doctor --clear-lock`. Help text lists them.

## Mixed versions

- A 1.1.x CLI ignores the lock. Do not run 1.1.x and 1.2.0 commands against the same checkout at the same time.
- A Shared Project that wants every teammate on the lock can set `yallaflow.minimumVersion` to `1.2.0` in `config.yaml`.
