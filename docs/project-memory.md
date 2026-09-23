# Project Memory and Living Context

> **Work records preserve history. Project memory preserves current understanding.**

Project knowledge goes stale as a repository evolves. YallaFlow therefore keeps project memory as an evidence-backed ledger that evolves through normal work, instead of append-only notes that end up holding two competing truths.

## Four kinds of memory

| Memory | Question | Where | Changes by |
|---|---|---|---|
| **Work memory** | What happened during PF-####? | `work/PF-####/` | the work itself; never rewritten afterwards |
| **Project memory** | What is currently believed true about the project? | `context/index.yaml` → `PROJECT.md`, `context/*.md` | baseline approval, knowledge promotion |
| **Historical knowledge** | What used to be believed, and what replaced it? | superseded facts in `context/index.yaml` | supersession |
| **Discovery limitations** | What could this investigation not inspect? | `work/PF-####/discovery.yaml`, baseline drafts | `yallaflow limitation add` — never promoted |

## The canonical ledger

`.yallaflow/context/index.yaml` is the single structured source of truth for durable project knowledge. It is created by the first approved baseline or promoted knowledge candidate; reads never create it. Each fact:

```json
{
  "id": "CTX-0048",
  "area": "database",
  "state": "current",
  "confidence": "confirmed",
  "summary": "Read replica is active for reporting.",
  "provenance": "repository",
  "origin": { "workId": "PF-0010", "candidateId": "K-001" },
  "evidence": [
    { "type": "repository", "path": "common/config/db.php", "contentHash": "sha256:…", "gitCommit": "abc123…" }
  ],
  "verifiedAt": "2026-09-23T10:00:00.000Z",
  "verifiedAtCommit": "abc123…",
  "supersedes": ["CTX-0017"],
  "supersededBy": null,
  "history": [{ "action": "introduced", "at": "…", "workId": "PF-0010", "candidateId": "K-001", "supersedes": "CTX-0017" }]
}
```

- **State** — `current`, `superseded` (replaced; kept as history), or `disputed` (conflicting evidence; not settled truth).
- **Confidence** — `confirmed`, `inferred`, or `unresolved`. Separate from state.
- **Provenance** — `repository`, `runtime`, or `user-confirmed`.
- **Areas** — `project`, `tech-stack`, `architecture`, `database`, `integration`, `environment`, `convention`, `business-rule`. Decisions remain ADRs under `decisions/`.

### Evidence references

Evidence is given as ordinary `--evidence` strings (or baseline `evidence` entries):

```text
config/db.php                 existing repository path — location, sha256 content hash, and Git commit are recorded; never contents
config/db.php#components      …with a symbol
config/db.php:40-80           …with a line range
runtime:pg_stat_activity showed report queries on the replica
verification:V-002            a recorded verification run of this work item
user:DBA confirmed the nightly backup window
```

Anything else is stored as a free-text reference with no verification point. Prior chat or model memory is never evidence.

## Knowledge evolution

Knowledge enters and evolves only through work items, so every change keeps a work item as its origin. The agent declares the relationship; YallaFlow validates that the fact exists and the transition is legal — it never decides semantic truth or equivalence.

```bash
yallaflow knowledge propose PF-0010 --kind database --source implementation-runtime \
  --summary "Read replica is active for reporting." --evidence common/config/db.php --supersedes CTX-0017
yallaflow knowledge promote PF-0010 --candidate K-001
```

| Relation | Allowed from | Effect |
|---|---|---|
| *(none)* | — | a new `current` fact |
| `--reconfirms CTX-####` | current, disputed | same fact and summary; evidence and verification point replaced (prior evidence kept in history); resolves a dispute |
| `--supersedes CTX-####` | current, disputed | a new `current` fact; the old one becomes `superseded` with two-way lineage and leaves the Markdown |
| `--disputes CTX-####` | current | the fact becomes `disputed`, conflicting evidence retained; shown as unsettled until reconfirmed or superseded |

Evolution needs at least one resolvable evidence reference (an existing path, `runtime:`, `verification:`, or `user:`). A fact can never gain two current successors. Historical work records are never edited when later work learns something new.

## Freshness

Freshness is mechanical and read-only. For each fact's repository evidence, YallaFlow compares the recorded content hash with the file now (directories use `git diff` against the recorded commit):

| Status | Meaning |
|---|---|
| `FRESH` | evidence unchanged since verification |
| `MAY_BE_STALE` | evidence changed since verification — **revalidate before relying on it; it does not mean false** |
| `STALE_EVIDENCE` | evidence file no longer exists |
| `UNKNOWN` | no repository verification point (runtime/user evidence, adopted legacy facts) |

Nothing is rewritten, invalidated, or superseded automatically. Revalidation is agent work: targeted rediscovery, then reconfirm, supersede, or dispute.

```bash
yallaflow context status                    # per-area counts and the facts to revalidate
yallaflow context affected --since main     # facts citing paths changed since a ref (path mapping only)
yallaflow context affected config/db.php    # …or for explicit paths
yallaflow context list --area database      # current facts; --all includes superseded
yallaflow context show CTX-0017
yallaflow context history CTX-0017          # lineage and events
```

`doctor` reports stale and disputed facts as warnings, and `handoff`/`resume` show the stale or disputed facts relevant to the work.

## Markdown projection

Each context document (`PROJECT.md`, `context/*.md`) holds exactly one managed block rendered deterministically from the ledger: current facts, then disputed facts under an explicit warning. Superseded facts never appear there. Content outside the block — your notes, bootstrap hints, pre-v0.3.6 sections — is preserved. Freshness is deliberately not rendered, so the Markdown changes only when the ledger does.

Do not edit inside the block. `doctor` reports drift; `yallaflow context render` regenerates the blocks.

**Crash safety.** The ledger file is written atomically (temp file + rename). Ledger and Markdown are not one transaction: if rendering fails, canonical knowledge is intact, `doctor` reports the drift, `context render` repairs it, and retrying `knowledge promote` or `baseline approve` never duplicates facts, history, or lineage.

## Sources, evidence, generated artifacts, and discovery limitations

| Kind | What it is | Where | How |
|---|---|---|---|
| **Source** | Original user/project input: requirement file, screenshot, PDF, DOCX, spreadsheet | `sources/SRC-####/` — immutable, checksummed, linked to work items | `yallaflow intake`, `yallaflow intake add` |
| **Evidence** | Proof produced during engineering or verification | `work/PF-####/evidence/` (append-only runs), checkpoint `--evidence` references | `yallaflow verify`, `yallaflow checkpoint` |
| **Generated artifact** | An optional output of the work (export, report, build output) | the application repository | not tracked by YallaFlow; becomes a source only if later provided as an input |
| **Discovery limitation** | What an investigation could not inspect | `work/PF-####/discovery.yaml` or baseline `limitations` | `yallaflow limitation add` |

> **Material user-provided artifacts must not exist only in conversation memory.**

- If a screenshot or file materially shapes a request and the agent can reach it, it registers the original: `yallaflow intake add PF-0004 attendance-ui.png`. `handoff` and `resume` then point any later agent to `.yallaflow/sources/SRC-####/<file>`, and `doctor` fails if the preserved original is missing or no longer matches its checksum.
- If the agent cannot access the bytes (an image pasted only into chat), it records `yallaflow limitation add PF-0004 --type uncaptured-artifact --area requirement --summary "<what it showed>" --reason "<why it could not be captured>"` instead of implying it was preserved.
- A source attached to **DONE** work requires `--reason` and is recorded as a *recovered source* (`linkedAt`, `workStatusAtLink: DONE`, reason). The work stays DONE, `work.md` is not rewritten, and `handoff`, `resume`, and `source show` label it as not available during the original execution.
- Not every request needs a file — only material ones.

Discovery limitation types: `not-inspected`, `unavailable`, `out-of-scope`, `runtime-unavailable`, `insufficient-evidence`, `uncaptured-artifact`. "The lockfile was not deeply inspected" or "production schema was not reachable" describe a session, not the project: a candidate restating a limitation of its own work item is refused, a baseline fact may not restate one of its limitations, and `doctor` fails if one reaches the ledger.

## Agent contract

`.yallaflow/AGENT.md` tells agents how to work with YallaFlow, including the project memory sequence (read relevant context, check freshness, rediscover only what changed, relate new knowledge to existing facts). It carries a versioned managed block. `doctor` and `status` warn when it predates the installed contract; `yallaflow agent refresh` updates it deliberately — see [`upgrading-to-v0.3.6.md`](upgrading-to-v0.3.6.md#3-refresh-the-agent-contract).

## No baseline refresh

A Brownfield baseline is the initial foundation. A second approved baseline is refused; normal work keeps memory current by reconfirming, superseding, or disputing facts.
