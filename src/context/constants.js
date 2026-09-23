import { CONTEXT_TARGETS } from '../knowledge/constants.js';

export const CONTEXT_SCHEMA_VERSION = 1;

// Canonical project-memory areas are exactly the durable context targets knowledge
// promotion and Brownfield Baseline already write into (knowledge/constants.js) — the
// ledger introduces no second area vocabulary.
export const CONTEXT_AREAS = Object.freeze(Object.keys(CONTEXT_TARGETS));

export const AREA_LABELS = Object.freeze({
  project: 'Project',
  'tech-stack': 'Tech Stack',
  architecture: 'Architecture',
  database: 'Database',
  integration: 'Integrations',
  environment: 'Environments',
  convention: 'Conventions',
  'business-rule': 'Business Rules'
});

// Semantic truth state (is this what the project currently believes?) is deliberately
// separate from confidence (how strongly was it established when recorded?).
export const FACT_STATES = Object.freeze(['current', 'superseded', 'disputed']);
export const CONFIDENCE_LEVELS = Object.freeze(['confirmed', 'inferred', 'unresolved']);

// 'unspecified' exists only for facts whose evidence is entirely free-text references
// (legacy candidates, adopted v0.3.5 knowledge) — never chosen explicitly.
export const PROVENANCE_VALUES = Object.freeze(['repository', 'runtime', 'user-confirmed']);
export const FACT_PROVENANCE_VALUES = Object.freeze([...PROVENANCE_VALUES, 'unspecified']);

export const EVIDENCE_TYPES = Object.freeze(['repository', 'runtime', 'user-confirmed', 'reference']);

export const RELATION_TYPES = Object.freeze(['supersedes', 'reconfirms', 'disputes']);

export const HISTORY_ACTIONS = Object.freeze([
  'introduced', 'adopted', 'reconfirmed', 'superseded', 'disputed', 'dispute-resolved'
]);

// Mechanical freshness only — computed from evidence vs. the current working tree,
// never stored and never a semantic judgment. MAY_BE_STALE does not mean false.
export const FRESHNESS = Object.freeze({
  FRESH: 'fresh',
  MAY_BE_STALE: 'may-be-stale',
  STALE_EVIDENCE: 'stale-evidence',
  UNKNOWN: 'unknown',
  HISTORICAL: 'historical'
});

export const FRESHNESS_LABELS = Object.freeze({
  fresh: 'FRESH',
  'may-be-stale': 'MAY_BE_STALE',
  'stale-evidence': 'STALE_EVIDENCE',
  unknown: 'UNKNOWN',
  historical: 'HISTORICAL'
});

export const FACT_ID_PATTERN = /^CTX-\d{4,}$/;

// Discovery limitations describe what an investigation could not inspect — they are
// work-scoped records, never project facts (see limitations/store.js).
export const LIMITATION_SCHEMA_VERSION = 1;
export const LIMITATION_TYPES = Object.freeze([
  'not-inspected',
  'unavailable',
  'out-of-scope',
  'runtime-unavailable',
  'insufficient-evidence',
  // A material user-provided artifact (e.g. a screenshot shared in conversation) whose
  // bytes/path the Agent could not access, so it could not be registered as a source.
  'uncaptured-artifact'
]);
export const LIMITATION_AREAS = Object.freeze([...CONTEXT_AREAS, 'requirement', 'testing', 'security', 'other']);
