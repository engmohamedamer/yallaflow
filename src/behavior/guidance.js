import { findSkill } from '../skills/registry.js';
import { resolveBehaviorContract } from '../skills/resolver.js';
import { incompleteImplementationSkills, summarizeProgress } from '../core/progress.js';
import { WRITE_STAGES } from './constants.js';

// `delivery.pendingImpact` (v0.3.8, from src/delivery/summary.js): a change of approved
// intent awaiting assessment closes the write gate and becomes the objective.
export function buildBehaviorGuidance(meta, stage, ledger, delivery = {}) {
  const workflow = meta.workflow ?? meta.type;
  const contract = resolveBehaviorContract(meta);
  const progress = summarizeProgress(contract, ledger);
  const pending = delivery.pendingImpact ?? null;
  const gate = pending
    ? { authorized: false, reason: `impact ${pending.id} is pending: the approved intent changed and must be assessed before implementation continues` }
    : resolveModificationGate(meta, workflow, stage, contract, ledger);
  const guidance = [];

  if (progress.current) guidance.push(skillGuidance(progress.current.skillId, progress.current.status));
  guidance.push(gate.authorized
    ? 'Implementation is authorized by the current workflow stage and work policy.'
    : 'Implementation is not authorized by the current workflow stage and work policy.');
  if (stage === 'VERIFICATION') guidance.push('Run fresh proof, read the result, and record it through the existing verification gate.');

  return {
    contract,
    progress,
    workflow,
    stage,
    guidance,
    modification: gate,
    nextObjective: pending
      ? `Assess impact ${pending.id}: decide which completed stages the changed intent affects (yallaflow impact status ${meta.id}).`
      : progressObjective(progress) ?? nextObjective(workflow, stage)
  };
}

function resolveModificationGate(meta, workflow, stage, contract, ledger) {
  if (meta.readOnly || workflow === 'investigation') {
    return { authorized: false, reason: 'work policy is read-only' };
  }

  const registeredSkills = contract.skills.map((skillId) => findSkill(skillId)).filter(Boolean);
  if (contract.skills.length && !registeredSkills.some((skill) => skill.mode === 'write-allowed')) {
    return { authorized: false, reason: 'behavior contract contains no write-allowed skill' };
  }

  const authorizedStages = WRITE_STAGES[workflow] ?? [];
  if (authorizedStages.includes(stage)) {
    const incomplete = incompleteImplementationSkills(contract, ledger ?? { skills: {} });
    if (incomplete.length) {
      return { authorized: false, reason: `required pre-implementation checkpoints are incomplete: ${incomplete.join(', ')}` };
    }
    return { authorized: true, reason: 'workflow and checkpoint implementation gates are open' };
  }
  if (workflow === 'bug' && contract.skills.includes('systematic-debugging') && ['INTAKE', 'REPRODUCE', 'EVIDENCE', 'TRACE', 'HYPOTHESIS', 'ROOT_CAUSE'].includes(stage)) {
    return { authorized: false, reason: 'systematic debugging/root-cause gate' };
  }
  if (workflow === 'feature' && meta.scope === 'architectural') {
    return { authorized: false, reason: 'architectural design/planning gate' };
  }
  return { authorized: false, reason: `workflow stage ${stage ?? 'none'} does not authorize application code modification` };
}

function skillGuidance(skillId, status) {
  if (status === 'blocked') return `Resolve the recorded blocker for ${skillId} before continuing.`;
  const guidance = {
    'context-discovery': 'Discover relevant technical context before asking for discoverable facts.',
    'requirement-clarification': 'Resolve only material business or behavioral ambiguity that the project cannot answer.',
    'design-exploration': 'Resolve architectural boundaries and trade-offs before implementation.',
    specification: 'Define exact, testable system behavior without inventing unresolved business decisions.',
    'systematic-debugging': 'Establish and confirm root cause with evidence before accepting a fix.',
    'implementation-planning': 'Produce a scope-appropriate implementation contract before editing code.',
    implementation: 'Perform the smallest implementation that satisfies the approved work contract.',
    verification: 'Run fresh proof and record it through the existing verification gate.',
    'code-review': 'Review completed work for compliance, regressions, maintainability, security, and unintended scope.',
    'context-reconciliation': 'Declare an explicit, evidence-based relationship for every legacy candidate; record genuine ambiguity as a question instead of guessing.'
  };
  return guidance[skillId] ?? `Continue ${skillId} according to its package-owned instructions.`;
}

function progressObjective(progress) {
  if (!progress.current) return null;
  if (progress.current.status === 'blocked') return `Resolve the blocker recorded for ${progress.current.skillId}: ${progress.current.summary}`;
  if (progress.current.status === 'in_progress') return `Complete the ${progress.current.skillId} checkpoint with durable summary and evidence.`;
  return `Start the ${progress.current.skillId} checkpoint.`;
}

function nextObjective(workflow, stage) {
  const objectives = {
    bug: {
      INTAKE: 'Reproduce the reported behavior.',
      REPRODUCE: 'Capture a reliable reproduction.',
      EVIDENCE: 'Gather evidence from the failing path.',
      TRACE: 'Trace where actual behavior diverges from expected behavior.',
      HYPOTHESIS: 'Test an evidence-backed root-cause hypothesis.',
      ROOT_CAUSE: 'Confirm root cause with evidence.',
      FIX_PLAN: 'Define the smallest justified fix.',
      IMPLEMENTATION: 'Implement the confirmed fix without unrelated changes.',
      VERIFICATION: 'Run and record fresh verification evidence.',
      DONE: 'Review durable knowledge updates.'
    },
    feature: {
      INTAKE: 'Discover the relevant project context.',
      DISCOVERY: 'Complete repository discovery for the requested outcome.',
      CLARIFICATION: 'Resolve material behavioral ambiguity.',
      DESIGN: 'Resolve relevant architecture and technical decisions.',
      SPECIFICATION: 'Produce a reviewable specification with explicit unresolved items.',
      SPEC: 'Establish the expected behavior and boundaries.',
      PLAN: 'Produce an executable implementation contract.',
      IMPLEMENTATION: 'Implement the approved feature contract.',
      VERIFICATION: 'Run and record fresh verification evidence.',
      DONE: 'Review durable knowledge updates.'
    },
    investigation: {
      INTAKE: 'Define the investigation question.',
      QUESTION: 'Make the investigation question precise and answerable.',
      DISCOVERY: 'Discover relevant technical context.',
      EVIDENCE: 'Gather evidence relevant to the question.',
      HYPOTHESIS: 'Test the leading explanation.',
      FINDINGS: 'Organize findings by evidence and confidence.',
      CONCLUSION: 'State the supported conclusion and its limits.',
      DONE: 'Review durable knowledge updates.'
    }
  };
  return objectives[workflow]?.[stage] ?? `Continue the ${workflow ?? 'current'} workflow at ${stage ?? 'its current stage'}.`;
}
