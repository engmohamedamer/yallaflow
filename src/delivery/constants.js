// Work-delivery state (v0.3.8): approved intent (requirements.yaml), convergence
// findings (convergence.yaml), and change-impact assessments (impact.yaml). These are
// work-scoped delivery records under work/<id>/ — never project-memory facts, and
// never promoted directly into the CTX ledger.
export const REQUIREMENTS_SCHEMA_VERSION = 1;
export const CONVERGENCE_SCHEMA_VERSION = 1;
export const IMPACT_SCHEMA_VERSION = 1;

// The skill whose presence in a pinned Behavior Contract makes delivery convergence
// required (Skill Registry v5+). The contract, derived deterministically from work
// type + scope at routing, is the only authority — there is no separate policy knob.
export const CONVERGENCE_SKILL = 'delivery-convergence';

export const REQUIREMENT_ID = /^REQ-\d{3,}$/;
export const CRITERION_ID = /^AC-\d{3,}$/;
export const ASSESSMENT_ID = /^CV-\d{3,}$/;
export const UNREQUESTED_ID = /^UR-\d{3,}$/;
export const IMPACT_ID = /^IM-\d{3,}$/;
// PF-0001/AC-004 — a criterion owned by another work item.
export const QUALIFIED_REF = /^(PF-\d+)\/((?:REQ|AC)-\d{3,})$/;

export const REQUIREMENT_STATUSES = Object.freeze(['active', 'withdrawn', 'deferred']);
export const PROVENANCE_TYPES = Object.freeze(['request', 'specification', 'source', 'question']);

// Agent-declared semantic judgments, stored exactly as recorded and never converted:
//   satisfied    implemented, and the cited evidence demonstrates it
//   partial      some, but not all, of the criterion is implemented
//   missing      not implemented
//   contradicts  the implementation behaves contrary to the criterion
export const FINDING_STATUSES = Object.freeze(['satisfied', 'partial', 'missing', 'contradicts']);

// Implemented behavior no active criterion requested. `open` blocks DONE until it is
// deliberately `accepted` (with a reason) or `removed`.
export const UNREQUESTED_DISPOSITIONS = Object.freeze(['open', 'accepted', 'removed']);

export const IMPACT_VERDICTS = Object.freeze(['affected', 'unaffected']);
