# Checking and updating an existing project (1.5.5)

Two commands help when a project was set up by an earlier YallaFlow, or when something in `.yallaflow/` looks wrong.

## `yallaflow health` — is this project in good shape?

Read-only: it writes nothing (not even a lock) and never repairs anything. It gives one answer:

| Answer | Meaning | What to do |
|---|---|---|
| **Healthy** | Everything YallaFlow checks is in order. | Nothing. |
| **Update available** | YallaFlow can refresh its own files (agent contract, bootstrap blocks). | `yallaflow refresh preview`, then `yallaflow refresh apply`. |
| **Repairable** | Something is missing or a refresh was interrupted, and a YallaFlow command fixes it. | The command shown next to the finding. |
| **Needs manual review** | A person has to decide: managed text edited by hand, a failed integrity check, legacy context to reconcile. | Read the finding; nothing is changed for you. |
| **Unsafe to update** | Do not update with this YallaFlow: a link leaves the project, or the project needs (or was written by) a newer YallaFlow. | Fix the link, or install the YallaFlow version the project needs. |

What it looks at: the agent contract (`.yallaflow/AGENT.md`) and the `AGENTS.md` / `CLAUDE.md` bootstrap blocks; links inside `.yallaflow/` and at managed paths; the project's minimum YallaFlow version and the project-memory format; every `yallaflow doctor` integrity check (work history, ledgers, project memory, sources, evidence links); projection drift; legacy context waiting for reconciliation; an interrupted refresh. `--json` prints the same report (schema `yallaflow.health/1`). Exit code 1 means *Needs manual review* or *Unsafe to update*.

## `yallaflow refresh` — update YallaFlow's own files safely

| Step | Command | Writes? |
|---|---|---|
| Check for updates | `yallaflow refresh check` | no |
| Preview changes | `yallaflow refresh preview` | no |
| Refresh YallaFlow integration | `yallaflow refresh apply` | yes, with a backup |
| Undo a refresh | `yallaflow refresh restore [backup-id]` | yes |
| List backups | `yallaflow refresh backups` | no |

**What is refreshed.** Only text YallaFlow can prove it wrote:
- the managed block in `.yallaflow/AGENT.md` (its begin marker records the hash of the text YallaFlow wrote), or an `AGENT.md` that is byte-for-byte a template an earlier YallaFlow generated;
- the YallaFlow bootstrap block in `AGENTS.md` and `CLAUDE.md` (hash-recorded the same way). A missing block is optional; `--add-missing` adds it, keeping the file's own text.

Text outside these blocks is never changed. Work records, progress and evidence ledgers, project memory, decisions, sources, preferences and runtime settings are never touched. Git is never run.

**When it stops.** Before writing anything, every managed file must be decidable:
- a block **edited by hand** is a conflict. Choose `--resolve FILE=keep` (leave it exactly as it is) or `--resolve FILE=preserve` (install the current block and keep your edited text verbatim right after it);
- a block from a **newer YallaFlow**, a **malformed** block, or a file that is a **link** leaving its folder or dangling is refused.

If any file is not decidable, nothing is written.

**Backups and recovery.** `apply` first copies every file it will change to `.yallaflow/local/backups/<id>/` (personal and git-ignored), with a manifest of each file's hash before, the hash it is about to get, and the hash it got. After writing it inspects every file again. If a refresh is interrupted, `yallaflow health` reports it; run `yallaflow refresh restore <id>` to go back, or `yallaflow refresh apply` again to finish. `restore` refuses if a file was changed after the refresh, and tells you where the copies are. It only ever writes the three managed files, and only from a backup this checkout made (a backup folder committed to a repository or copied from another folder is ignored). A file edited while a refresh runs is not overwritten: the refresh stops there. A second `apply` changes nothing.

`yallaflow agent refresh` and `yallaflow agent setup` still work as before; `refresh` adds the preview, the conflict decisions, backups and restore around the same updates.

# Branch Health (1.5.5)

`yallaflow branches` answers, for a team that promotes `feature/* → dev → qc → prod` and fixes production with `prod → hotfix/* → prod`:

- **Is dev ready for QC? Is QC ready for production?** For each step: *Up to date* (nothing waiting), *Ready* (Git expects no conflict; a fast-forward is noted), *Sync first* (the next branch has changes this one lacks, such as a hotfix; bring them in first), *Potential conflict* (the files are listed), *Check first* (your local branch is behind its upstream: update it and run again), or *Unknown* (something could not be checked, for example the conflict preview needs a newer Git).
- **Is a production hotfix missing from QC or dev?** Production changes that an earlier branch lacks are listed (a cherry-picked fix counts as present), with a conflict preview for merging production back. `hotfix/*` branches, local or only on the remote, are listed with where they are missing.
- **How fresh is this?** Local branches ahead of, behind or diverged from their upstream, upstreams that are gone, and the time of the last `git fetch`. A branch that exists only on the remote is read from its remote-tracking branch.

It is read-only: it never merges, cherry-picks, rebases, resets, checks out, fetches or pushes, and it does not touch the working tree, the index or refs. The conflict preview runs `git merge-tree` (Git 2.38 or later) with a temporary object store, so nothing is added to the repository; Git may refresh the timestamp of an existing object it reads again. Suggested next steps are printed as text, never run. Only committed branches are compared: uncommitted changes are not read (reading the working tree could run a repository's own filters). In a partial clone, Git 2.44 or later is told never to download a missing object; with an older Git the comparisons that need file contents are skipped and the report says so. `--json` prints schema `yallaflow.branches/1`.

**What it cannot tell you.** Git only predicts textual conflicts. A clean preview does not show that the promoted code works: behaviour, database migrations, configuration and runtime compatibility still need review and testing. Information about remote branches is as old as your last `git fetch`, which YallaFlow never runs for you.

**Configuring the flow.** Without settings, the flow is detected from branch names (`dev`/`develop`/`development`, then `qc`/`qa`/`staging`/`test`/`uat`, then `prod`/`production`/`main`/`master`). To set it for the project:

```bash
yallaflow branches configure --flow dev,qc,prod --hotfix "hotfix/*" --remote origin
yallaflow branches configure --clear
```

This writes only the `branches` block of `.yallaflow/config.yaml`; commit it to share it with the team. Older YallaFlow versions ignore the block.
