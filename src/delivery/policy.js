import { resolveBehaviorContract } from '../skills/resolver.js';
import { CONVERGENCE_SKILL } from './constants.js';

// Deterministic delivery policy (v0.3.8). Convergence — and with it requirement
// identity and change-impact assessment — applies exactly when the work item's pinned
// Behavior Contract includes the delivery-convergence skill (Skill Registry v5+).
// Legacy work (registry ≤ v4, derived or missing contracts) is never affected.
export function convergenceRequired(metaOrContract) {
  const contract = metaOrContract?.skills ? metaOrContract : resolveBehaviorContract(metaOrContract);
  return Boolean(contract.pinned) && contract.registryVersion >= 5 && contract.skills.includes(CONVERGENCE_SKILL);
}

// The checkpoint that fixes the approved intent: the specification where the work has
// one, otherwise requirement clarification. Completing it requires acceptance
// criteria; once it is completed, a change of intent needs an impact assessment.
export function intentSkill(contract) {
  if (contract.skills.includes('specification')) return 'specification';
  if (contract.skills.includes('requirement-clarification')) return 'requirement-clarification';
  return null;
}

// True once the approved intent is fixed for in-flight work: the intent checkpoint is
// completed, or the work has already moved past it (any later checkpoint started or
// completed) — revising the intent checkpoint back does not reopen intent for free
// changes while downstream work built on it still stands. DONE work is history;
// change it by reopening.
export function intentFixed(meta, contract, progressLedger) {
  if (!convergenceRequired(contract) || meta.status === 'DONE') return false;
  const skill = intentSkill(contract);
  if (!skill) return false;
  const index = contract.skills.indexOf(skill);
  return contract.skills.slice(index).some((candidate) => (progressLedger.skills[candidate]?.status ?? 'pending') !== 'pending' &&
    (candidate !== skill || progressLedger.skills[candidate].status === 'completed'));
}
