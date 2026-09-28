# Project Memory and Living Context

> **Work records preserve history. Project memory preserves current understanding.**

Project knowledge goes stale as a repository evolves. YallaFlow therefore keeps project memory as an evidence-backed ledger that evolves through normal work, instead of append-only notes that end up holding two competing truths.

## Kinds of memory

| Memory | Question | Where | Changes by |
|---|---|---|---|
| **Work history** | What happened during PF-####? | `work/PF-####/` | the work itself; an **immutable** record, never rewritten afterwards |
| **Project memory** | What is currently believed true about the project? | `context/index.yaml` → `PROJECT.md`, `context/*.md` | baseline approval, knowledge promotion, applied reconciliation — **evolving** current truth |
| **Historical knowledge** | What used to be believed, and what replaced it? | superseded facts in `context/index.yaml` | supersession |
| **Reconciliation history** | How did old (v0.3.5) knowledge become current memory? | `work/PF-####/reconciliation.yaml`, `legacy-context.md` | `yallaflow context reconcile` — interprets old knowledge without rewriting work history |
| **Discovery limitations** | What could this investigation not inspect? | `work/PF-####/discovery.yaml`, baseline drafts | `yallaflow limitation add` — never promoted |

## The canonical ledger

`.yallaflow/context/index.yaml` is the single structured source of truth for durable project knowledge. It is created by the first approved baseline, promoted knowledge candidate, or applied reconciliation; reads never create it. Each fact:

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

### Multi-origin facts (v0.3.7)

One current fact may have been established by several historical work items. This needs **context schema v2**, where every fact records its provenance in exactly one field, `origins` (the introducing origin first), instead of v1's single `origin`. The two are never mixed. v0.3.7 reads v1 ledgers as-is, keeps a ledger at v1 while its content fits, and moves it to v2 only when a mutation needs it; `context reconcile apply` is the usual path ([storage contract](upgrading-to-v0.3.7.md#context-ledger-storage-contract-schema-v1--v2)).

```json
"origins": [
  { "workId": "PF-0001", "baselineFactId": "BF-013", "adopted": true, "reconciliation": { "workId": "PF-0006", "candidate": "RC-0013" } },
  { "workId": "PF-0002", "candidateId": "K-002",     "adopted": true, "reconciliation": { "workId": "PF-0006", "candidate": "RC-0053" } }
]
```

Adding an origin to an existing fact is provenance only: its evidence, verification point, state, and freshness do not change. A `merged` history event (candidates collapsed into this fact) or a `reconfirmed` one (one more historical observation of it) records which relationship was chosen. An origin appears at most once per fact and on at most one fact. `yallaflow context show` lists every origin.

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
| `UNKNOWN` | no repository verification point (runtime/user evidence, adopted or reconciled legacy facts) |

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

## Legacy knowledge reconciliation (v0.3.7)

v0.3.5 appended one Markdown section per promoted fact. After many work items, the same durable truth can appear several times in different words:

```text
A  PF-0001 BF-013  Root Codeception enables api/apps.
B  PF-0002 K-002   Root Codeception includes api/apps and excludes the other checked-in suites.
```

Importing both would give two current facts for one truth. Whether two statements are the same fact, a refinement, a supersession, or a contradiction is an engineering judgement, so legacy knowledge becomes canonical only through reconciliation:

```text
legacy facts → RC candidates → Agent decisions → preview → human review → atomic apply → CTX ledger
```

```bash
yallaflow context reconcile start                  # RC-#### candidates in a read-only work item
yallaflow context reconcile show                   # the Agent inspects them
yallaflow context reconcile plan --file d.json     # explicit relationships
yallaflow context reconcile preview                # resulting current memory, nothing changed
yallaflow context reconcile approve                # a human approves (hash-bound)
yallaflow context reconcile apply                  # one atomic ledger write
```

For the example above, `A: new` plus `B: merge-with A` gives one canonical current fact with both origins preserved. `merge-with` collapses candidates that are the same statement, so its target is always another candidate. `reconfirms` records one more observation of a truth already represented (an existing `CTX-####`, or another candidate's fact) of the same kind. The actions are `new`, `merge-with`, `reconfirms`, `supersedes`, `disputes` (targeting a candidate or an existing `CTX-####`), `skip` (with a reason), and `limitation` (kept as a work-scoped discovery limitation). YallaFlow validates the relationship graph and applies it deterministically. The only thing it compares automatically is exact textual identity (`exactDuplicateOf`), which it reports and never acts on. Ambiguous pairs stay undecided with a question for the human, and the rest applies. Reconciled legacy sections that are byte-for-byte what v0.3.5 generated are archived with the reconciliation work item and removed from the documents. Hand-edited ones are kept and flagged for review. The full walkthrough is in [upgrading-to-v0.3.7.md](upgrading-to-v0.3.7.md#4-reconcile-legacy-project-context).

`yallaflow context adopt` imports directly only when that is provably duplicate-free (one legacy item, no current facts); otherwise it points to reconciliation.

## State ownership

Agents never edit YallaFlow-owned structured or history state directly when a supported command exists. YallaFlow enforces this with guidance (the agent contract) and deterministic `doctor` checks, not with locks: `.yallaflow` stays ordinary, reviewable, Git-tracked files.

| Owner | Files | Changed only by |
|---|---|---|
| **CLI** | `work/<id>/meta.yaml`, `progress.yaml`, `progress.md`, `knowledge.yaml`, `reviews.yaml`, `questions.yaml`, `baseline.yaml`, `discovery.yaml`, `decomposition.yaml`, `reconciliation.yaml`, `legacy-context.md`, `evidence/` (verification ledger); `context/index.yaml`; `sources/SRC-####/` (originals + metadata); `state/current.yaml`; generated `decisions/ADR-*.md` | the matching `yallaflow` command |
| **Projection** | the managed blocks in `PROJECT.md`, `context/*.md`, `AGENT.md` | `yallaflow context render`, `yallaflow agent refresh` |
| **Shared** | `work/<id>/work.md` | the Agent writes the narrative sections (discovery notes, specification, plan, findings, result); CLI-appended lifecycle records (Routing Decision, Source Added, Request Revised) are history and are never edited |
| **Human** | `config.yaml`; content outside managed blocks | deliberate human edits |

Deterministic tamper checks include strict schema validation of every ledger, the reconciliation plan's approval fingerprint, projection drift, source checksums, and (a warning) a Routing Decision in `work.md` that no longer matches `meta.yaml`.

## Agent contract

`.yallaflow/AGENT.md` tells agents how to work with YallaFlow: the project memory sequence (read relevant context, check freshness, rediscover only what changed, relate new knowledge to existing facts), legacy reconciliation, state ownership, and `yallaflow brief` as the first command of a fresh session. It carries a versioned managed block (v3 since v0.3.7). `doctor` and `status` warn when it predates the installed contract, and `yallaflow agent refresh` updates it deliberately. See [`upgrading-to-v0.3.7.md`](upgrading-to-v0.3.7.md#3-refresh-the-agent-contract-v2--v3).

## No baseline refresh

A Brownfield baseline is the initial foundation. A second approved baseline is refused; normal work keeps memory current by reconfirming, superseding, or disputing facts.
