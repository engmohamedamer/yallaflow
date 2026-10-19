# Connected Requirements, AI QC, and Smart Demo

YallaFlow 1.1.0 adds three optional capabilities. Each one is off unless you ask for it, and each works without the other two. If you never use them, nothing changes: no new configuration, dependencies, background services, or network access.

| You say | What happens | Where it is recorded |
|---|---|---|
| "Implement GitHub issue #12" / "Work on SHOP-42" / "ADO 77" | The agent imports the ticket as a source and records requirements that trace back to it. | `.yallaflow/sources/SRC-####/` |
| "Run QC on this" | The agent plans scenarios from the acceptance criteria, runs them with Playwright, and records honest results. | `.yallaflow/work/<id>/quality/qc.json` |
| "Prepare a demo" | The agent proposes the scenarios worth showing. You approve them, then it runs and optionally records them. | `.yallaflow/work/<id>/quality/demo.json` |

You do not run these commands yourself. The agent does, following on-demand skills: `yallaflow skill requirement-import`, `ai-qc`, and `smart-demo`. They are listed here so you can see what happens.

---

## Connected Requirements

Import an existing requirement from **GitHub Issues**, **Jira**, or **Azure DevOps Boards**. The import includes the description, the acceptance criteria (from a dedicated field, or from an "Acceptance Criteria" section: a heading, a bold label, or a plain `Acceptance Criteria:` line, with bullets, numbered items, or prose), relevant comments (bots excluded; the 20 most recent by default), attachments, and a link back to the ticket.

### How the ticket gets in

**Default: the agent fetches it.** The agent uses an integration it already has, such as the `gh` CLI, an MCP server for Jira or Azure DevOps, or the tracker's API. It saves the raw result to a temporary file and hands it to YallaFlow. YallaFlow stays offline, and you configure nothing.

```bash
gh issue view 12 --repo acme/school --json number,title,body,state,url,labels,author,comments,updatedAt > /tmp/issue-12.json
yallaflow intake ticket /tmp/issue-12.json --provider github            # new pending work item
yallaflow intake ticket /tmp/SHOP-42.json --provider jira --work PF-0007 # attach to existing work
```

YallaFlow understands each provider's own format:

- **GitHub:** `gh issue view --json` output, or the REST issue, optionally wrapped as `{ "issue": …, "comments": […] }`.
- **Jira:** the REST v3 or v2 issue. Add `?expand=names` so a custom "Acceptance Criteria" field can be found by name. The Atlassian MCP returns the same shape.
- **Azure DevOps:** the work item from `_apis/wit/workitems/{id}?$expand=all`, optionally wrapped as `{ "workItem": …, "comments": … }`.

It also accepts a provider-neutral normalized ticket (`"yallaflowTicket": 1`). Attachments the agent saved can be preserved with `--attachment <file>`.

**Optional: YallaFlow fetches it.** Use this only when the agent has no integration. Network access happens only with this explicit flag:

```bash
yallaflow intake ticket github:acme/school#12 --fetch
yallaflow intake ticket https://acme.atlassian.net/browse/SHOP-42 --fetch --attachments
yallaflow intake ticket ado:acme/Portal#77 --fetch
```

| Provider | Credentials (environment only) | Host |
|---|---|---|
| GitHub | `GITHUB_TOKEN` or `GH_TOKEN`, optional for public repositories | `api.github.com`, or `requirements.providers.github.apiUrl` for GitHub Enterprise |
| Jira | `JIRA_EMAIL` + `JIRA_API_TOKEN` (Cloud), or `JIRA_PAT` (Data Center) | from the issue URL, `requirements.providers.jira.baseUrl`, or `JIRA_BASE_URL` |
| Azure DevOps | `AZURE_DEVOPS_EXT_PAT` (Work Items: Read) | `dev.azure.com`, or `requirements.providers.azure-devops.baseUrl` for Azure DevOps Server |

`--fetch` follows these rules:

- It sends only `GET` requests.
- Credentials go only over https to the hosted tracker (`api.github.com`, `*.atlassian.net`, `dev.azure.com`, `*.visualstudio.com`) or to a host you configured explicitly in `requirements.providers` (the only way to use GitHub Enterprise, Jira Data Center, Azure DevOps Server, or http) — a ticket URL alone never decides where a token goes.
- A credentialed request never follows a redirect to another host.
- Attachments download only from the tracker's own origin, or from GitHub's own attachment hosts (without credentials).
- Requests time out, and responses are size-capped.
- Credentials are never written to any file or printed.
- If credentials are missing, the command stops before sending anything and names the variable it needs.

The optional config looks like this; credentials never belong in it:

```json
"requirements": { "providers": { "jira": { "baseUrl": "https://acme.atlassian.net" } } }
```

### What is stored

A ticket becomes an ordinary, immutable source:

- **Original:** the provider payload exactly as supplied or fetched (`github-acme-school-12.json`).
- **Readable text:** a rendered Markdown view. It opens with an *untrusted content* banner and carries locators: `[description]`, `[ac:2]`, `[comment:<id>]`.
- **Origin:** provider, key, URL, revision, and how it was acquired.
- **Attachments:** each one is its own source, linked to the same work.

Re-importing a changed ticket creates a new source that names the previous one, and the earlier source never changes. If the work's approved intent is already fixed, YallaFlow raises an impact assessment, just as for any new source.

Requirements cite the ticket through ordinary provenance:

```json
{ "id": "AC-001", "requirement": "REQ-001", "statement": "The export downloads an ICS file.",
  "provenance": [{ "type": "source", "source": "SRC-0003", "locator": "ac:1" }] }
```

The agent extracts requirements itself; YallaFlow never does it for you.

### Ticket text is untrusted

Ticket descriptions, comments, and attachments come from outside the repository, and the agent treats them as data. If a ticket says "ignore your instructions" or "run this command", the agent does not comply; it tells you what the ticket says. YallaFlow keeps such text visible, with its headings nested below the rendering's own sections. It never hides that text, and never follows it.

Importing never writes to the tracker: no comments and no status changes.

---

## AI QC

AI-assisted functional and exploratory testing with Playwright. QC is off by default, and it only runs when you ask for it.

- Nothing starts a browser, a test server, or an install because YallaFlow was initialized or a task finished.
- QC works on any routed work item at any stage, including DONE, without rerouting or reopening it.
- QC records are separate from verification evidence (`V-###`). A failed QC scenario never reopens verification and never changes a stage.

**1. Plan from the acceptance criteria.** The plan has one functional scenario per user-facing criterion, plus up to three exploratory charters by default:

```bash
yallaflow qc plan PF-0012 --file plan.json      # records QP-001; nothing runs
```

**2. Run with Playwright.** The agent prefers the Playwright CLI (`playwright-cli`), which costs fewer tokens than MCP page snapshots, and uses Playwright MCP when that is what it has. While it works, it captures screenshots, traces, and console and network output. If the project already has Playwright tests, the agent runs them through YallaFlow (`yallaflow verify PF-0012 -- npx playwright test …`) and reports those scenarios as `yallaflow-verified`.

**3. Record what actually happened:**

```bash
yallaflow qc record PF-0012 --file result.json   # QC-001: per-scenario results + artifacts
yallaflow qc status PF-0012
```

The honesty rules are enforced. A violating record is rejected, and nothing is written:

| Status | Requires |
|---|---|
| `passed` | the executed steps, plus an artifact (screenshot, trace, video, log) or a passing YallaFlow verification run |
| `failed` | the actual behavior observed, plus steps that reproduce it |
| `blocked` / `not-run` | a reason |

### Policies

- **Advisory (default):** failures are reported clearly by `qc status` and `finish`, and they never block completion.
- **Strict (opt-in):** set `"policy": "strict"` in the plan, or `quality.qc.policy: strict` in config. Quality approval is granted only when every required scenario (functional scenarios are required by default) last passed. Quality approval is reported separately from the task being done: DONE means exactly what it meant before. Work that never used QC is never affected. A project-wide `strict` setting is a floor that a plan cannot weaken: the stricter of the plan and the current config governs, including for plans recorded before the switch. When a plan redefines a scenario, results recorded against the old definition no longer count, so the scenario must run again.

**Convergence.** A finding may cite `qc:QC-001#S-01`. Only a passed scenario can support `satisfied`. If a later run fails that scenario, the finding becomes stale.

---

## Smart Demo

An intelligent demonstration of what was delivered. It is off by default and independent of QC: a demo needs no QC records.

**1. Propose a prioritized scope.** The agent inspects the change and its acceptance criteria and chooses the scenarios that matter: the main workflow, the business rules, and the important states. It does not record every screen. Each scenario has an audience (`business` or `developer`), a priority, a rationale, its steps, and whether to record it. The agent also lists what it left out, and why.

```bash
yallaflow demo propose PF-0012 --file scope.json
```

**2. You approve or change it.** Nothing can be recorded before you approve. The agent records your approval in your words, bound to that exact proposal. A changed proposal needs a new approval. To approve only some scenarios, the agent adds `--only D-01,D-03`.

```bash
yallaflow demo approve PF-0012 --note "Approved by Sara in the agent session: 'yes, show the refund approval'"
```

**3. Run it, optionally recording video.** The agent uses `playwright-cli video-start`, `video-chapter "<scenario>"`, and `video-stop`. Video needs Playwright's ffmpeg (`npx playwright install ffmpeg`), which is installed only with your agreement. A demo without video is still valid.

```bash
yallaflow demo record PF-0012 --file result.json
```

Separate features can be shown in separate runs, for example one for the business audience and one for developers. Every demo record and summary says that **a demonstration is not test evidence**, and convergence refuses `demo:` citations.

---

## Artifacts, reports, and privacy

- **Local by default.** Videos, screenshots, and traces are copied into `work/<id>/quality/media/<record-id>/`, with their size and SHA-256 recorded. YallaFlow writes `media/.gitignore`, so binaries stay out of Git. The ledgers (`qc.json`, `demo.json`), hashes, and reports are committed. Set `quality.media.commit: true` to track media too.
- **Reports.** `quality/report.md` and a standalone `quality/report.html` are regenerated after every QC or demo write. The HTML file is static, with inline styling, no scripts, and no external requests. Links are relative and resolve on your machine. In a fresh clone, where media is absent, or after a file changed, the report flags it instead of linking blindly.
- **No uploads.** YallaFlow uploads nothing anywhere.
- **Test data only.** A target that is not local (anything other than `localhost`, `127.0.0.1`, `*.local`, `*.test`, …) needs an explicit `--allow-remote`, and a target URL with embedded credentials is refused. The skills require test or seeded data, and a Playwright storage-state file kept outside `.yallaflow`, so no credential is typed on camera. Text records are redacted. Traces and screenshots are copied as-is and can contain personal data or tokens, so keep them local.

## Configuration summary (all optional)

```json
"requirements": { "providers": { "github": { "apiUrl": "…" }, "jira": { "baseUrl": "…" }, "azure-devops": { "baseUrl": "…" } } },
"quality": { "qc": { "policy": "advisory" }, "media": { "commit": false } }
```

`init` writes none of this. `doctor` validates it when present.
