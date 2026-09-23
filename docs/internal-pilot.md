# Internal Pilot

This is the pilot guide for the internal prerelease baseline. It is for humans using YallaFlow on real engineering work, not for the coding agent.

## Goal

Use YallaFlow on real engineering work and report friction.

## Starting Point

Use the normal public CLI, exactly as any first-time user would:

```bash
npm install -g /path/to/yallaflow-<version>.tgz   # isolated CLI; or: npm link, from a checkout
yallaflow init
yallaflow --help
```

On a legacy repository, never add YallaFlow to the application's `package.json` — it can make npm rewrite an old lockfile. See [`installation.md`](installation.md#legacy-and-brownfield-repositories). Upgrading an existing v0.3.5 pilot workspace: [`upgrading-to-v0.3.6.md`](upgrading-to-v0.3.6.md).

If you have an existing requirements document, use it directly instead of retyping it into a prompt — the same command handles text, Office/OpenDocument, PDF, and image files:

```bash
yallaflow intake SRS.docx
yallaflow intake requirements.docx payment-rules.xlsx   # multiple files in one work item
yallaflow intake add PF-0001 client-notes.docx           # attach one later
```

OCR/scanned-document understanding is not implemented — an image or a scanned PDF is preserved as a source but no text is extracted from it; `yallaflow source show <id> --content` tells you exactly what YallaFlow could and couldn't read. Otherwise, start from plain text: `yallaflow start "<a plain-text request>"`.

From there, follow whatever the CLI and its documentation (`README.md`, [`workflows.md`](workflows.md), `yallaflow --help`, `yallaflow <namespace> --help`) tell you to do next. Do not skip ahead using internal engineering notes, prior dogfood transcripts, or this repository's test fixtures as a script — that would test a different, easier path than a real user gets.

## Pilot Rule

**Do not modify YallaFlow itself while using it on a pilot project.** If something is awkward, missing, or wrong, do not patch around it in `src/` — record it as friction instead (see below) and keep working with the product as shipped. Fixing YallaFlow is a separate, later activity informed by what the pilot finds.

## What to Record

For every issue, however small, record:

```text
ID
Project/context
What I tried to do
What I expected
What happened
Impact
Workaround
```

Severity:

```text
blocking  — could not continue without a workaround outside YallaFlow
major     — completed, but the result or process was significantly wrong or costly
minor     — worked, but was confusing, slow, or needed extra steps
polish    — cosmetic, wording, or nice-to-have
```

## What We Are Testing

- first-time setup
- requirement intake (plain text and file — including real Office documents, PDFs, and mixed-format work items)
- extraction quality for your actual document formats (tables, headings, non-English/RTL text) — report it as friction if extracted text is unusable, not just if intake fails outright
- source traceability (`yallaflow source list`/`show`, and whether a fresh agent can find the original file)
- routing
- Discover Before Ask
- clarification
- specification quality
- readiness (`SPEC_READY` / `PLAN_READY` / `DONE`)
- checkpoint friction
- resume
- implementation handoff
- verification
- knowledge review
- Brownfield baseline and living project memory (`context status`, freshness, reconfirm/supersede/dispute)
- material user-provided artifacts (screenshots/files captured as sources, or recorded as `uncaptured-artifact`)
- cross-agent handoff and `agent status`/`agent refresh`
- everyday CLI usability

Keep reports practical and short — a real friction log beats a polished one.
