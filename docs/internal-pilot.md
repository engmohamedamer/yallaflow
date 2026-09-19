# Internal Pilot

This is the pilot guide for the internal prerelease baseline. It is for humans using YallaFlow on real engineering work, not for the coding agent.

## Goal

Use YallaFlow on real engineering work and report friction.

## Starting Point

Use the normal public CLI, exactly as any first-time user would:

```bash
npm install /path/to/yallaflow-<version>.tgz   # or: npm link, from a checkout
yallaflow init
yallaflow --help
```

If you have an existing requirements file, use it directly instead of retyping it into a prompt:

```bash
yallaflow intake SRS.md
```

(supported types this release: `.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.csv` — not PDF or DOCX). Otherwise, start from plain text: `yallaflow start "<a plain-text request>"`.

From there, follow whatever the CLI and its documentation (`README.md`, `yallaflow --help`, `yallaflow <namespace> --help`) tell you to do next. Do not skip ahead using internal engineering notes, prior dogfood transcripts, or this repository's test fixtures as a script — that would test a different, easier path than a real user gets.

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
- requirement intake (plain text and file)
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
- everyday CLI usability

Keep reports practical and short — a real friction log beats a polished one.
