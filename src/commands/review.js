import { exists } from '../utils/fs.js';
import path from 'node:path';
import { findProjectRoot, workspacePath } from '../core/workspace.js';
import { setGateStatus } from '../reviews/store.js';
import { GATE_NAMES } from '../behavior/interaction.js';

async function requireWorkItem(root, workId) {
  const metaFile = path.join(workspacePath(root), 'work', workId, 'meta.yaml');
  if (!await exists(metaFile)) throw new Error(`Work item ${workId} was not found.`);
}

export async function approveCommand(workId, input) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!workId) throw new Error('Usage: yallaflow approve <work-id> --stage GATE [--note TEXT]');
  await requireWorkItem(root, workId);
  requireGate(input.stage);
  const ledger = await setGateStatus(root, workId, input.stage, 'approved', input.note);
  console.log(`${workId} — ${input.stage}: approved`);
  if (ledger.gates[input.stage].note) console.log(`Note: ${ledger.gates[input.stage].note}`);
}

export async function feedbackCommand(workId, input) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!workId) throw new Error('Usage: yallaflow feedback <work-id> --stage GATE --changes-requested [--note TEXT]');
  if (!input.changesRequested) throw new Error('yallaflow feedback currently only supports --changes-requested.');
  await requireWorkItem(root, workId);
  requireGate(input.stage);
  const ledger = await setGateStatus(root, workId, input.stage, 'changes_requested', input.note);
  console.log(`${workId} — ${input.stage}: changes requested`);
  if (ledger.gates[input.stage].note) console.log(`Note: ${ledger.gates[input.stage].note}`);
}

function requireGate(stage) {
  if (!GATE_NAMES.includes(stage)) throw new Error(`--stage must be one of: ${GATE_NAMES.join(', ')}; received ${JSON.stringify(stage)}.`);
  // A reconciliation approval is bound to the exact plan content it covers; a bare gate
  // flip would record an approval of nothing in particular.
  if (stage === 'reconciliation') {
    throw new Error('The reconciliation gate is managed by `yallaflow context reconcile approve|feedback`, which binds the review to the exact plan content. No files were changed.');
  }
}
