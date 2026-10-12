// 4 — v0.3.7: context-reconciliation (capability 'reconcile').
// 5 — v0.3.8: delivery-convergence (capability 'converge'), pinned for feature
//     (bounded, architectural) and change/architectural. Work pinned to an earlier
//     registry version keeps its recorded skills unchanged.
// 6 — v0.3.10: immutable, hash-pinned instruction versions (src/skills/instructions.js).
//     Same skills and capability pins as v5; context-discovery and repository-baseline
//     move to instruction v2 (discovery modes, canonical core coverage, discovery
//     lens). Work pinned to v1–v5 keeps resolving instruction v1.
// 7 — v0.3.10-internal.3: repository-baseline instruction v3 (conversational baseline
//     approval: the Agent records the developer's explicit approval). Same skills and
//     capability pins; work pinned to v6 keeps instruction v2.
// 8 — v0.3.10-internal.4: repository-baseline instruction v4 (the developer's original
//     request as the baseline objective and its automatic continuation after approval,
//     declared discovery coverage, never copying secret values). Same skills and
//     capability pins; work pinned to v7 keeps instruction v3.
export const REGISTRY_VERSION = 8;

export const SKILL_PHASES = Object.freeze([
  'discovery',
  'analysis',
  'design',
  'planning',
  'execution',
  'verification',
  'review'
]);

export const SKILL_MODES = Object.freeze([
  'read-only',
  'read-only-until-gate',
  'write-allowed',
  'verification-only',
  'review-only'
]);
