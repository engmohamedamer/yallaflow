export const REGISTRY_VERSION = 3;

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
