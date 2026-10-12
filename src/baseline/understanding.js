import path from 'node:path';
import { readYaml } from '../core/yaml.js';
import { workspacePath } from '../core/workspace.js';
import { loadContextLedger } from '../context/ledger.js';
import { classifyProject, inventoryRepository } from '../inventory/inventory.js';
import { baselineNextStep, findBaselineWork } from './store.js';

// Project understanding (v0.3.10): every YallaFlow project establishes durable,
// evidence-backed understanding before substantial work — but the evidence differs:
//
//   Brownfield  the existing repository → one deep, reviewed Brownfield baseline
//   Greenfield  product intent, supplied requirements/sources, and decisions as they
//               are approved — never a repository scan of an empty project
//
// The state is derived mechanically from durable state; YallaFlow never decides what
// the project is about. Read-only.
export const UNDERSTANDING = Object.freeze({
  REQUIRED: 'PROJECT_UNDERSTANDING_REQUIRED',
  IN_PROGRESS: 'PROJECT_UNDERSTANDING_IN_PROGRESS',
  AWAITING_REVIEW: 'PROJECT_UNDERSTANDING_AWAITING_REVIEW',
  ESTABLISHED: 'PROJECT_UNDERSTANDING_ESTABLISHED',
  GREENFIELD: 'GREENFIELD_UNDERSTANDING_FROM_INTENT'
});

export async function assessProjectUnderstanding(root, { kind = null, inventoryKind = undefined } = {}) {
  let facts = 0;
  try {
    const { ledger } = await loadContextLedger(root);
    facts = ledger.facts.filter((fact) => fact.state !== 'superseded').length;
  } catch {
    facts = 0; // an unreadable ledger is reported elsewhere (doctor / upgrade status)
  }
  const baseline = await findBaselineWork(root);
  const step = baseline ? await baselineNextStep(root, baseline) : null;
  if (facts > 0 || step?.state === 'approved') {
    return {
      state: UNDERSTANDING.ESTABLISHED,
      label: `established — ${facts} current project fact(s)${step?.state === 'approved' ? `, Brownfield baseline approved` : ''}`,
      facts,
      baselineId: baseline?.id ?? null
    };
  }
  if (step) {
    const awaiting = step.state === 'awaiting-review';
    return {
      state: awaiting ? UNDERSTANDING.AWAITING_REVIEW : UNDERSTANDING.IN_PROGRESS,
      label: awaiting ? 'baseline drafted — awaiting human review' : 'Brownfield baseline in progress',
      detail: step.text,
      command: step.command,
      facts,
      baselineId: baseline.id
    };
  }
  let classified = inventoryKind;
  if (classified === undefined && kind !== 'brownfield') {
    try {
      classified = classifyProject(await inventoryRepository(root)).kind;
    } catch {
      classified = null;
    }
  }
  if (kind === 'brownfield' || classified === 'brownfield') {
    return {
      state: UNDERSTANDING.REQUIRED,
      label: 'an existing project with no approved project understanding yet — establish it once before substantial work',
      detail: 'establish an evidence-backed Brownfield baseline once, before substantial work (a human approves it); then continue with the request',
      command: 'yallaflow baseline start',
      facts
    };
  }
  return {
    state: UNDERSTANDING.GREENFIELD,
    label: 'Greenfield — understanding comes from product intent, supplied requirements, and approved decisions (no repository scan)',
    facts
  };
}

export function understandingRequired(assessment) {
  return [UNDERSTANDING.REQUIRED, UNDERSTANDING.IN_PROGRESS, UNDERSTANDING.AWAITING_REVIEW].includes(assessment?.state);
}

// The notice start/route/guide print for substantial work while project understanding
// is missing or unapproved. (The hard boundary is projectUnderstandingGate below.) The Agent establishes understanding
// first and then continues with the developer's request — the developer never has to
// ask for "understand this project".
export async function understandingNotice(root, { kind = null, workMeta = null } = {}) {
  if (workMeta?.baseline || workMeta?.reconciliation) return [];
  const assessment = await assessProjectUnderstanding(root, { kind });
  if (assessment.state === UNDERSTANDING.REQUIRED) {
    return [
      `${UNDERSTANDING.REQUIRED}: this existing project has no approved project understanding yet.`,
      'Agent: establish it once before substantial work — yallaflow baseline start, Brownfield discovery, baseline draft, then human approval — and continue with this request after approval. The developer does not need to ask for it.'
    ];
  }
  if (assessment.state === UNDERSTANDING.IN_PROGRESS || assessment.state === UNDERSTANDING.AWAITING_REVIEW) {
    return [`${assessment.state}: ${assessment.detail}. Continue with this request after the baseline is approved (next: ${assessment.command}).`];
  }
  return [];
}

// The first-use Brownfield gate (v0.3.10): while a Brownfield project has no approved
// project understanding, no work item may enter (or work in) an application-writing
// stage. It reuses the existing baseline lifecycle — the only way through is an
// approved baseline (or durable project facts) — so there is no second lifecycle.
// Greenfield projects are never gated. The recorded project kind decides (init
// classifies it from the repository inventory); a Greenfield project that has grown
// source files is not retroactively treated as an un-understood Brownfield repository.
// Returns null when writes may be authorized.
export async function projectUnderstandingGate(root) {
  let kind = null;
  try {
    kind = (await readYaml(path.join(workspacePath(root), 'config.yaml')))?.project?.kind ?? null;
  } catch {
    return null; // an unreadable config is reported by doctor
  }
  if (kind !== 'brownfield') return null;
  const assessment = await assessProjectUnderstanding(root, { kind });
  if (assessment.state === UNDERSTANDING.ESTABLISHED) return null;
  const step = assessment.state === UNDERSTANDING.REQUIRED
    ? 'yallaflow baseline start   (then Brownfield discovery, baseline draft, and human approval)'
    : assessment.command;
  return {
    state: assessment.state,
    reason: `${assessment.state}: this existing project has no approved project understanding yet; application changes are authorized only after the Brownfield baseline is approved`,
    blocker: `${assessment.state} — establish and approve project understanding before application changes`,
    action: step
  };
}
