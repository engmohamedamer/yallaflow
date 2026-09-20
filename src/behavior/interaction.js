// Interaction/review-gate policy. A "gate" name corresponds 1:1 with the skill whose
// checkpoint completion exits the matching stage (see core/workflows.js's
// requiredSkillForStage) plus one structural boundary, 'decomposition', that has no
// skill/stage of its own (see decomposition/store.js). Modes only select a DEFAULT
// gate preset; a project can override any individual gate in config.yaml without
// adopting a whole different mode, which is how gated mode's "not every project uses
// every boundary" requirement is satisfied without special-casing per mode elsewhere.
export const INTERACTION_MODES = Object.freeze(['autonomous', 'adaptive', 'gated']);

export const GATE_NAMES = Object.freeze([
  'discovery', 'clarification', 'design', 'specification', 'plan', 'decomposition', 'implementation', 'verification'
]);

const ALL_FALSE = Object.freeze(Object.fromEntries(GATE_NAMES.map((name) => [name, false])));
const ALL_TRUE = Object.freeze(Object.fromEntries(GATE_NAMES.map((name) => [name, true])));

// The developer-oriented default (PART 8): routine technical decisions (discovery,
// clarification, design, implementation, verification) proceed autonomously; the
// meaningful human review boundaries (specification, plan, decomposition) stop.
const ADAPTIVE_DEFAULT = Object.freeze({
  ...ALL_FALSE, specification: true, plan: true, decomposition: true
});

const MODE_PRESETS = Object.freeze({
  autonomous: ALL_FALSE,
  adaptive: ADAPTIVE_DEFAULT,
  gated: ALL_TRUE
});

export const DEFAULT_INTERACTION_POLICY = Object.freeze({
  profile: 'developer',
  mode: 'adaptive',
  gates: {}
});

export function validateInteractionPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error('Interaction policy must be an object.');
  }
  const unknown = Object.keys(policy).filter((key) => !['profile', 'mode', 'gates'].includes(key));
  if (unknown.length) throw new Error(`Unknown interaction policy field(s): ${unknown.join(', ')}.`);
  if (!INTERACTION_MODES.includes(policy.mode)) {
    throw new Error(`mode must be one of: ${INTERACTION_MODES.join(', ')}; received ${JSON.stringify(policy.mode)}.`);
  }
  if (policy.gates !== undefined) {
    if (typeof policy.gates !== 'object' || Array.isArray(policy.gates)) throw new Error('Interaction policy gates must be an object.');
    for (const [name, value] of Object.entries(policy.gates)) {
      if (!GATE_NAMES.includes(name)) throw new Error(`Unknown gate ${JSON.stringify(name)}; must be one of: ${GATE_NAMES.join(', ')}.`);
      if (typeof value !== 'boolean') throw new Error(`Gate ${name} must be a boolean.`);
    }
  }
  return true;
}

// Resolves the effective gate map for a workspace: mode preset, then explicit
// per-gate overrides from config.yaml's interaction.gates.
export function resolveInteractionPolicy(config) {
  const policy = config?.interaction ?? DEFAULT_INTERACTION_POLICY;
  const mode = INTERACTION_MODES.includes(policy.mode) ? policy.mode : 'adaptive';
  const preset = MODE_PRESETS[mode];
  const overrides = policy.gates ?? {};
  const gates = Object.fromEntries(GATE_NAMES.map((name) => [name, overrides[name] ?? preset[name]]));
  return { profile: policy.profile ?? 'developer', mode, gates };
}

export const SKILL_TO_GATE = Object.freeze({
  'context-discovery': 'discovery',
  'requirement-clarification': 'clarification',
  'design-exploration': 'design',
  specification: 'specification',
  'implementation-planning': 'plan',
  implementation: 'implementation',
  verification: 'verification'
});
