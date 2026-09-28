export const RECONCILIATION_SCHEMA_VERSION = 1;
export const RECONCILIATION_SOURCE = 'v0.3.5-legacy-context';
export const RECONCILIATION_GATE = 'reconciliation';
export const RECONCILIATION_SKILL = 'context-reconciliation';
export const RECONCILIATION_FILE = 'reconciliation.yaml';
// Verbatim copies of the legacy Markdown sections a reconciliation retired from the
// durable documents, kept with the reconciliation work item as history.
export const RECONCILIATION_ARCHIVE_FILE = 'legacy-context.md';

export const RC_ID_PATTERN = /^RC-\d{4,}$/;

// The explicit relationship the Agent declares for each legacy candidate. YallaFlow
// validates and applies it; it never infers one.
//   new         becomes one new canonical fact
//   merge-with  collapse candidates that are the same statement into one fact (target: RC only)
//   reconfirms  one more historical observation of a truth already represented
//               (target: CTX fact or candidate; same area)
//   supersedes  newer truth replacing another candidate / CTX fact (lineage kept)
//   disputes    conflicting evidence against another candidate / CTX fact; not settled
//   skip        deliberately not migrated into project memory (reason required)
//   limitation  was a discovery limitation, not project truth (kept as a work-scoped limitation)
export const RECONCILIATION_ACTIONS = Object.freeze(['new', 'merge-with', 'reconfirms', 'supersedes', 'disputes', 'skip', 'limitation']);
export const FACT_PRODUCING_ACTIONS = Object.freeze(['new', 'supersedes']);
export const JOINING_ACTIONS = Object.freeze(['merge-with', 'reconfirms']);
export const TARGETED_ACTIONS = Object.freeze(['merge-with', 'reconfirms', 'supersedes', 'disputes']);
export const REASON_REQUIRED_ACTIONS = Object.freeze(['merge-with', 'reconfirms', 'supersedes', 'disputes', 'skip', 'limitation']);
export const PLAN_STATUSES = Object.freeze(['open', 'applied']);
export const MARKDOWN_OUTCOMES = Object.freeze(['removed', 'left-in-place', 'absent']);
