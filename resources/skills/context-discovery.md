# Context Discovery

## Purpose

Understand the repository and its technical context before asking for information that can be discovered directly.

## Behavior

1. Start from durable project memory: read `.yallaflow/PROJECT.md` and only the `context/*.md` documents relevant to the work. The managed block (`yallaflow-context:begin`…`end`) holds current knowledge; legacy v0.3.5 sections outside it (`yallaflow-baseline:` / `yallaflow-knowledge:` markers) are unreconciled history, not current truth — treat them as leads to verify, and let `yallaflow brief` / `yallaflow upgrade status` tell you whether reconciliation is pending.
2. Check freshness before trusting it: `yallaflow context status` (or `yallaflow context affected`) reports facts whose supporting evidence changed since they were verified (`MAY_BE_STALE`), whose evidence disappeared (`STALE_EVIDENCE`), or that are `DISPUTED`. `MAY_BE_STALE` does not mean false — it means revalidate before relying on it.
3. Rediscover only where it matters: inspect the files, configuration, tests, integrations, and recent implementation patterns relevant to the work, plus any relevant fact that is stale, disputed, or unresolved. Do not rescan unrelated areas that durable context already covers with fresh evidence.
4. Record what the repository proves separately from assumptions and unresolved business decisions. Record what you could not inspect (no production access, out of scope, not sampled) as a work-scoped discovery limitation with `yallaflow limitation add` — never as a project fact.
5. Ask the user only for information that cannot reasonably be established from available project evidence.

## Guard

This skill is read-only. Do not modify application code while performing context discovery.

## Result

Produce a concise evidence-backed context summary that makes the next engineering step clear.
