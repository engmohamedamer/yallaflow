// 4 — v0.3.7: context-reconciliation (capability 'reconcile'). Work pinned to an
// earlier registry version keeps its recorded skills unchanged.
export const REGISTRY_VERSION = 4;

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
