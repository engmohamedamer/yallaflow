export const WORK_TYPES = Object.freeze([
  'feature',
  'bug',
  'investigation',
  'change',
  'refactor',
  'release'
]);

export const SCOPES = Object.freeze(['spike', 'bounded', 'architectural']);

export const CONFIDENCE_LEVELS = Object.freeze(['low', 'medium', 'high']);

export const CAPABILITIES = Object.freeze([
  'discover',
  'clarify',
  'brainstorm',
  'specify',
  'systematic-debugging',
  'plan',
  'implement',
  'verify',
  'review'
]);

export const WRITE_STAGES = Object.freeze({
  feature: Object.freeze(['IMPLEMENTATION']),
  bug: Object.freeze(['IMPLEMENTATION']),
  change: Object.freeze(['IMPLEMENTATION']),
  refactor: Object.freeze(['IMPLEMENTATION']),
  release: Object.freeze(['EXECUTION'])
});
