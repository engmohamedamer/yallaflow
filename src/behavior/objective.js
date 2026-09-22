// GAP-HANDOFF-001: a replacement agent must not have to infer why work was reopened
// or revised purely from lifecycle history — the single most relevant unresolved
// reason is surfaced explicitly. Sourced only from durable workflow facts (reopen
// reason, checkpoint-revision reason, active write-authorization blocker); never
// invented from code semantics. When both a reopen and a later checkpoint revision
// exist, the more recent event (by timestamp) wins.
export function resolvePrimaryObjective(meta, progressLedger, modification) {
  if (meta.status === 'DONE') return null;
  const lastReopen = [...(meta.lifecycleHistory ?? [])].reverse().find((entry) => entry.action === 'reopen');
  const lastRevision = (progressLedger?.history ?? []).at(-1);

  const candidates = [];
  if (lastReopen) candidates.push({ at: lastReopen.changedAt, text: `Reopened to ${lastReopen.toStage}: ${lastReopen.reason}` });
  if (lastRevision) candidates.push({ at: lastRevision.changedAt, text: `${lastRevision.skill} revised (${lastRevision.from} → ${lastRevision.to}): ${lastRevision.reason}` });
  if (candidates.length) {
    candidates.sort((a, b) => (a.at > b.at ? -1 : 1));
    return candidates[0].text;
  }

  if (modification && !modification.authorized) return modification.reason;
  return null;
}
