export const BASELINE_SCHEMA_VERSION = 1;

// One area per durable target the baseline can populate — see knowledge/constants.js's
// CONTEXT_TARGETS, which these area names map onto 1:1.
export const BASELINE_AREAS = Object.freeze([
  'project',
  'tech-stack',
  'architecture',
  'database',
  'integration',
  'environment',
  'convention',
  'business-rule'
]);

export const BASELINE_FACT_STATUSES = Object.freeze(['confirmed', 'inferred', 'unresolved']);
export const BASELINE_FACT_SOURCES = Object.freeze(['repository', 'runtime', 'user-confirmed']);
export const BASELINE_STATUSES = Object.freeze(['draft', 'approved']);
