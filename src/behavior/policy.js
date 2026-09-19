import { SCOPES, WORK_TYPES } from './constants.js';

const POLICIES = {
  feature: {
    bounded: ['discover', 'clarify', 'implement', 'verify'],
    architectural: ['discover', 'clarify', 'brainstorm', 'specify', 'plan', 'implement', 'verify', 'review']
  },
  bug: {
    spike: ['discover', 'systematic-debugging', 'verify'],
    bounded: ['discover', 'systematic-debugging', 'implement', 'verify'],
    architectural: ['discover', 'systematic-debugging', 'plan', 'implement', 'verify', 'review']
  },
  investigation: {
    spike: ['discover', 'systematic-debugging', 'verify'],
    bounded: ['discover', 'systematic-debugging', 'verify'],
    architectural: ['discover', 'systematic-debugging', 'verify']
  },
  change: {
    bounded: ['discover', 'clarify', 'plan', 'implement', 'verify'],
    architectural: ['discover', 'clarify', 'brainstorm', 'plan', 'implement', 'verify', 'review']
  },
  refactor: {
    bounded: ['discover', 'plan', 'implement', 'verify'],
    architectural: ['discover', 'brainstorm', 'plan', 'implement', 'verify', 'review']
  },
  release: {
    bounded: ['discover', 'plan', 'implement', 'verify', 'review'],
    architectural: ['discover', 'plan', 'implement', 'verify', 'review']
  }
};

export function resolveWorkflowPolicy(workType, scope) {
  if (!WORK_TYPES.includes(workType)) {
    throw new Error(`work_type must be one of: ${WORK_TYPES.join(', ')}; received ${JSON.stringify(workType)}.`);
  }
  if (!SCOPES.includes(scope)) {
    throw new Error(`scope must be one of: ${SCOPES.join(', ')}; received ${JSON.stringify(scope)}.`);
  }

  const requiredCapabilities = POLICIES[workType][scope];
  if (!requiredCapabilities) {
    throw new Error(
      `Unsupported routing combination: ${workType} + ${scope}. ` +
      'Exploratory work that does not authorize production changes should be routed as investigation + spike.'
    );
  }

  const readOnly = workType === 'investigation' || (workType === 'bug' && scope === 'spike');
  const workflow = readOnly ? 'investigation' : workType;
  return {
    workflow,
    initialStage: 'INTAKE',
    requiredCapabilities: [...requiredCapabilities],
    readOnly
  };
}
