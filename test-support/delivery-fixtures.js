// Shared fixtures for the v0.3.8 delivery tests (kept outside test/ so the runner does not load it as a test module).
import { mkdtemp, writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createPendingIntake, routeWorkItem } from '../src/behavior/routing.js';
import { checkpointWork } from '../src/core/progress.js';
import { advanceActiveWork } from '../src/core/transitions.js';
import { recordVerification } from '../src/core/evidence.js';
import { initWorkspace, loadWorkMetaOrThrow, workspacePath } from '../src/core/workspace.js';
import { recordRequirements } from '../src/delivery/requirements.js';

export async function workspace(mode = 'autonomous') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'yallaflow-delivery-'));
  await initWorkspace(root, 'demo', 'greenfield', mode);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'refund.js'), 'export function refund() { return true; }\n');
  await writeFile(path.join(root, 'src', 'export.js'), 'export function exportCalendar() { return "ics"; }\n');
  return root;
}

export async function routed(root, type, scope, request = `${type} ${scope} delivery fixture`) {
  const intake = await createPendingIntake(root, request);
  return routeWorkItem(root, intake.id, { work_type: type, scope, confidence: 'high', reason: 'Delivery test fixture.' });
}

export const INTENT = Object.freeze({
  requirements: [
    { id: 'REQ-001', statement: 'Staff can refund a payment.', provenance: [{ type: 'request' }] },
    { id: 'REQ-002', statement: 'Staff can export the calendar.', provenance: [{ type: 'request' }] }
  ],
  acceptanceCriteria: [
    { id: 'AC-001', requirement: 'REQ-001', statement: 'A refund can be created.', provenance: [{ type: 'request' }] },
    { id: 'AC-002', requirement: 'REQ-001', statement: 'A refund requires manager approval.', provenance: [{ type: 'request' }] },
    { id: 'AC-003', requirement: 'REQ-002', statement: 'The export is an ICS file.', provenance: [{ type: 'request' }] }
  ]
});

export async function complete(root, id, skillId, summary = `${skillId} done.`) {
  return checkpointWork(root, id, { skillId, status: 'completed', summary, evidence: [] });
}

// Bounded feature: INTAKE → IMPLEMENTATION with the intent recorded and fixed.
export async function boundedFeatureAtImplementation(root, intent = INTENT) {
  const meta = await routed(root, 'feature', 'bounded', 'Refunds and calendar export');
  await complete(root, meta.id, 'context-discovery');
  await recordRequirements(root, meta.id, structuredClone(intent));
  await complete(root, meta.id, 'requirement-clarification');
  for (let index = 0; index < 5; index++) await advanceActiveWork(root, meta.id);
  return meta;
}

export async function toVerified(root, id) {
  await complete(root, id, 'implementation');
  await advanceActiveWork(root, id);
  await recordVerification(root, id, { command: 'true', success: true, exitCode: 0 });
  await complete(root, id, 'verification');
}

export const meta = (root, id) => loadWorkMetaOrThrow(root, id);

export async function jsonFile(root, name, value) {
  const file = path.join(root, name);
  await writeFile(file, JSON.stringify(value));
  return file;
}

export async function readJson(root, id, file) {
  return JSON.parse(await readFile(path.join(workspacePath(root), 'work', id, file), 'utf8'));
}

export async function writeJson(root, id, file, value) {
  await writeFile(path.join(workspacePath(root), 'work', id, file), `${JSON.stringify(value, null, 2)}\n`);
}

export async function workspaceHash(root) {
  const base = workspacePath(root);
  const hash = createHash('sha256');
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else { hash.update(path.relative(base, full)); hash.update(await readFile(full)); }
    }
  }
  await walk(base);
  return hash.digest('hex');
}

export function satisfied(criterion, evidence = ['src/refund.js']) {
  return { criterion, status: 'satisfied', reason: `${criterion} is implemented.`, evidence };
}
