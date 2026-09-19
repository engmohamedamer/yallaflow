export const WORKFLOWS = {
  feature: ['INTAKE', 'DISCOVERY', 'CLARIFICATION', 'SPEC', 'PLAN', 'IMPLEMENTATION', 'VERIFICATION', 'DONE'],
  bug: ['INTAKE', 'REPRODUCE', 'EVIDENCE', 'TRACE', 'HYPOTHESIS', 'ROOT_CAUSE', 'FIX_PLAN', 'IMPLEMENTATION', 'VERIFICATION', 'DONE'],
  investigation: ['INTAKE', 'QUESTION', 'DISCOVERY', 'EVIDENCE', 'HYPOTHESIS', 'FINDINGS', 'CONCLUSION', 'DONE'],
  change: ['INTAKE', 'CURRENT_BEHAVIOR', 'REQUESTED_DELTA', 'IMPACT_ANALYSIS', 'ACCEPTANCE_CRITERIA', 'PLAN', 'IMPLEMENTATION', 'VERIFICATION', 'DONE'],
  refactor: ['INTAKE', 'DISCOVERY', 'BEHAVIOR_BASELINE', 'PLAN', 'IMPLEMENTATION', 'VERIFICATION', 'DONE'],
  release: ['INTAKE', 'PRECHECK', 'PLAN', 'EXECUTION', 'VERIFICATION', 'DONE']
};

const ARCHITECTURAL_FEATURE_V2 = Object.freeze([
  'INTAKE',
  'DISCOVERY',
  'CLARIFICATION',
  'DESIGN',
  'SPECIFICATION',
  'PLAN',
  'IMPLEMENTATION',
  'VERIFICATION',
  'DONE'
]);

const ARCHITECTURAL_STAGE_SKILLS = Object.freeze({
  DISCOVERY: 'context-discovery',
  CLARIFICATION: 'requirement-clarification',
  DESIGN: 'design-exploration',
  SPECIFICATION: 'specification',
  PLAN: 'implementation-planning'
});

export function usesArchitecturalReadiness(meta) {
  return (meta.workflow ?? meta.type) === 'feature' &&
    meta.scope === 'architectural' &&
    meta.behaviorContract?.registryVersion >= 2 &&
    meta.behaviorContract.skills?.includes('specification');
}

export function workflowStagesFor(meta) {
  if (usesArchitecturalReadiness(meta)) return [...ARCHITECTURAL_FEATURE_V2];
  const workflow = meta.workflow ?? meta.type;
  const stages = WORKFLOWS[workflow];
  if (!stages) throw new Error(`Unknown workflow type: ${workflow}`);
  return [...stages];
}

export function nextStageForWork(meta, current) {
  const stages = workflowStagesFor(meta);
  const index = stages.indexOf(current);
  if (index < 0) throw new Error(`Stage ${current} is not valid for ${meta.workflow ?? meta.type}`);
  return stages[index + 1] ?? null;
}

export function requiredSkillForStage(meta, stage) {
  if (!usesArchitecturalReadiness(meta)) return null;
  return ARCHITECTURAL_STAGE_SKILLS[stage] ?? null;
}

export function stageForSkill(meta, skillId) {
  if (!usesArchitecturalReadiness(meta)) return null;
  return Object.entries(ARCHITECTURAL_STAGE_SKILLS).find(([, value]) => value === skillId)?.[0] ?? null;
}

export function nextStage(type, current) {
  const stages = WORKFLOWS[type];
  if (!stages) throw new Error(`Unknown workflow type: ${type}`);
  const index = stages.indexOf(current);
  if (index < 0) throw new Error(`Stage ${current} is not valid for ${type}`);
  return stages[index + 1] ?? null;
}
