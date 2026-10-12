export const KNOWLEDGE_POLICY_VERSION = 1;
// Knowledge ledger (work/<id>/knowledge.yaml) schema:
//   1 — v0.2–v0.3.9.
//   2 — v0.3.10 Shared Projects: a candidate may be `staged` (with stagedAt) and a
//       relation may carry factFingerprint. The frozen v0.3.9 reader rejects all three
//       (strict status and field validation), so a ledger holding any of them is
//       written as v2 — which v0.3.9 refuses outright ("must use version 1") instead
//       of misreading. Every other ledger stays v1, byte-for-byte readable by v0.3.9.
export const KNOWLEDGE_SCHEMA_V1 = 1;
export const KNOWLEDGE_SCHEMA_V2 = 2;
export const KNOWLEDGE_SCHEMA_VERSION = KNOWLEDGE_SCHEMA_V2;
export const SUPPORTED_KNOWLEDGE_SCHEMAS = Object.freeze([KNOWLEDGE_SCHEMA_V1, KNOWLEDGE_SCHEMA_V2]);

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

// 'staged' (v0.3.10, Shared Projects only): reviewed and approved for project memory,
// held in the work item as its memory delta until canonical integration on the
// integration branch turns it into 'promoted'. It is a completed disposition: DONE
// does not wait for integration.
export const CANDIDATE_STATUSES = Object.freeze(['proposed', 'staged', 'promoted', 'rejected']);
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

// The heading a durable target document is created with when it does not yet exist.
// PROJECT.md always exists already (written at init) and is never re-headered.
export const CONTEXT_HEADINGS = Object.freeze({
  architecture: '# Architecture',
  database: '# Database',
  integration: '# Integrations',
  environment: '# Environments',
  convention: '# Engineering Conventions',
  'business-rule': '# Business Rules',
  project: null,
  'tech-stack': '# Tech Stack'
});
