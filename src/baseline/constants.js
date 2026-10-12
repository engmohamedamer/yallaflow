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

// The canonical core of a first Brownfield baseline (v0.3.10): broad, durable
// understanding useful to future engineering work — not trivia. Topics map onto the
// eight BASELINE_AREAS (e.g. authentication and roles → architecture or business-rule;
// routes/APIs → architecture; CI/CD → environment; testing → convention). Coverage is
// Agent guidance shown by `baseline start` and the repository-baseline skill; a topic
// that does not apply, or could not be inspected, is recorded as such (a limitation),
// never silently skipped. YallaFlow does not grade coverage semantically.
export const CORE_COVERAGE = Object.freeze([
  'purpose', 'architecture', 'applications/modules', 'backend stack', 'frontend stack', 'database/storage',
  'authentication', 'authorization/roles', 'business workflows', 'business rules', 'external integrations',
  'routes/APIs', 'environments/configuration', 'testing', 'CI/CD/deployment', 'conventions',
  'shared components', 'operational/security risks', 'unresolved knowledge', 'discovery limitations'
]);
