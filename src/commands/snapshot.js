import { findProjectRoot } from '../core/workspace.js';
import { collectSnapshot, collectWorkDetail } from '../flow/snapshot.js';

const STATION_LABEL = { understand: 'Understand', decide: 'Decide', change: 'Change', verify: 'Verify', remember: 'Remember' };

// `--json` prints exactly one JSON document on stdout — the contract — and, on failure,
// `{ "error": { code, message } }` with exit code 1, so a script never has to parse prose.
async function withRoot(json, run) {
  const root = await findProjectRoot();
  if (!root) return fail(json, 'NO_WORKSPACE', 'No .yallaflow workspace found. Run `yallaflow init` first.');
  try {
    return await run(root);
  } catch (error) {
    return fail(json, error.code ?? 'ERROR', error.message);
  }
}

function fail(json, code, message) {
  if (!json) throw new Error(message);
  process.stdout.write(`${JSON.stringify({ error: { code, message } })}\n`);
  process.exitCode = 1;
  return null;
}

export async function snapshotCommand({ json = false } = {}) {
  return withRoot(json, async (root) => {
    const snapshot = await collectSnapshot(root);
    if (json) return process.stdout.write(`${JSON.stringify(snapshot)}\n`);
    console.log(`${snapshot.project.name} — ${snapshot.completion}% complete across ${snapshot.items.length} work item(s)`);
    const counts = snapshot.counts;
    console.log(`Waiting for you: ${counts.you} · Active: ${counts.active} · Failing: ${counts.fail} · Paused: ${counts.paused} · New: ${counts.new} · Done: ${counts.done}`);
    for (const item of snapshot.items.filter((entry) => entry.state !== 'done')) {
      const where = item.currentStation ? STATION_LABEL[item.currentStation] : item.state === 'new' ? 'New' : '—';
      console.log(`- ${item.id} ${String(item.completion).padStart(3)}% ${where} (${item.state}) — ${item.title}`);
    }
    console.log('\nMachine-readable: yallaflow snapshot --json');
  });
}

export async function workShowCommand(workId, { json = false } = {}) {
  return withRoot(json, async (root) => {
    if (!workId) return fail(json, 'USAGE', 'Usage: yallaflow work show <work-id> [--json]');
    const detail = await collectWorkDetail(root, workId);
    if (json) return process.stdout.write(`${JSON.stringify(detail)}\n`);
    const { item } = detail;
    console.log(`${item.id} — ${item.title}`);
    console.log(`${item.type ?? 'unrouted'} / ${item.scope ?? '—'} · ${item.completion}% · ${item.state}${item.stage ? ` · ${item.stage}` : ''}`);
    for (const station of item.stations) {
      const steps = station.steps.map((step) => `${step.id}${step.status === 'done' ? ' ✓' : step.status === 'now' ? ' →' : ''}`).join(', ');
      console.log(`  ${STATION_LABEL[station.key].padEnd(10)} ${station.status.padEnd(7)} ${steps || '(not needed)'}`);
    }
    if (detail.sources.length) console.log(`Sources: ${detail.sources.map((entry) => `${entry.id} ${entry.name}`).join(', ')}`);
    if (detail.criteria.length) console.log(`Criteria: ${detail.criteria.filter((entry) => entry.convergence === 'satisfied').length}/${detail.criteria.length} satisfied`);
    if (item.waitingFor) console.log(`Waiting for you: ${item.waitingFor.action}`);
    else if (item.nextAction) console.log(`Next: ${item.nextAction}`);
    console.log(`\nMachine-readable: yallaflow work show ${item.id} --json`);
  });
}
