// 4 — v0.3.7: context-reconciliation (capability 'reconcile').
// 5 — v0.3.8: delivery-convergence (capability 'converge'), pinned for feature
//     (bounded, architectural) and change/architectural. Work pinned to an earlier
//     registry version keeps its recorded skills unchanged.
export const REGISTRY_VERSION = 5;

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
