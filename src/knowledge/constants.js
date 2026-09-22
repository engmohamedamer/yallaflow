export const KNOWLEDGE_POLICY_VERSION = 1;
export const KNOWLEDGE_SCHEMA_VERSION = 1;

export const KNOWLEDGE_KINDS = Object.freeze([
  'architecture',
  'database',
  'integration',
  'environment',
  'convention',
  'business-rule',
  'decision',
  'project',
  'tech-stack'
]);

export const CANDIDATE_STATUSES = Object.freeze(['proposed', 'promoted', 'rejected']);
export const REVIEW_STATUSES = Object.freeze(['pending', 'reviewed']);
export const KNOWLEDGE_SOURCES = Object.freeze(['design-spec', 'implementation-runtime']);

// 'project' and 'tech-stack' were added for Brownfield Baseline promotion (v0.3.5):
// PROJECT.md and context/tech-stack.md were previously only reachable from a
// deterministic bootstrap template, never from reviewed, evidence-backed facts.
export const CONTEXT_TARGETS = Object.freeze({
  architecture: 'context/architecture.md',
  database: 'context/database.md',
  integration: 'context/integrations.md',
  environment: 'context/environments.md',
  convention: 'context/conventions.md',
  'business-rule': 'context/business-rules.md',
  project: 'PROJECT.md',
  'tech-stack': 'context/tech-stack.md'
});
