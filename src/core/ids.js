// The one definition of YallaFlow's global, path-backed identifiers (v0.3.10).
//
// Two forms coexist forever:
//   legacy / single-user   PF-0042          SRC-0007
//   branch-safe (shared)   PF-K7M2Q-0001    SRC-K7M2Q-0001
//
// A branch-safe ID carries the allocating clone's tag (src/shared/identity.js) and a
// per-tag sequence, so two developers starting from the same Git base never allocate
// the same work or source directory. Existing IDs are never rewritten. CTX-#### is not
// here: project-context facts get their identity only at canonical integration, on
// the integration branch, where there is exactly one writer.
//
// Every work-scoped identifier (K-, Q-, DL-, V-, CV-, IM-, UR-, REQ-/AC-, BF-, RC-) is
// unique within its work item and therefore already branch-safe by scope.

export const CLONE_TAG_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
export const CLONE_TAG_LENGTH = 10; // 50 bits from crypto.randomBytes
const TAG = `[${CLONE_TAG_ALPHABET}]{${CLONE_TAG_LENGTH}}`;

// Regex source fragments, for patterns that embed an ID (ownership paths, qualified
// references). Uncaptured alternation; wrap in a group to capture.
export const WORK_ID_SOURCE = `PF-(?:\\d+|${TAG}-\\d{4,})`;
export const SOURCE_ID_SOURCE = `SRC-(?:\\d+|${TAG}-\\d{4,})`;

export const WORK_ID_PATTERN = new RegExp(`^${WORK_ID_SOURCE}$`);
export const SOURCE_ID_PATTERN = new RegExp(`^${SOURCE_ID_SOURCE}$`);
// Stored source records written since v0.3.1 always use at least four digits.
export const STORED_SOURCE_ID_PATTERN = new RegExp(`^SRC-(?:\\d{4,}|${TAG}-\\d{4,})$`);
export const STORED_WORK_ID_PATTERN = new RegExp(`^PF-(?:\\d{4,}|${TAG}-\\d{4,})$`);
export const CLONE_TAG_PATTERN = new RegExp(`^${TAG}$`);
// Work-scoped record IDs that can be written on two branches of one work item (v1.1.0
// QC/demo ledgers): QC-001 single-user, QC-<tag>-0001 in a Shared Project.
export function recordIdSource(prefix) {
  return `${prefix}-(?:\\d{3,}|${TAG}-\\d{4,})`;
}

export function isWorkId(value) {
  return typeof value === 'string' && WORK_ID_PATTERN.test(value);
}

export function isSourceId(value) {
  return typeof value === 'string' && SOURCE_ID_PATTERN.test(value);
}

// { form: 'legacy', number } | { form: 'shared', tag, number } | null
export function parseScopedId(prefix, value) {
  if (typeof value !== 'string') return null;
  const legacy = new RegExp(`^${prefix}-(\\d+)$`).exec(value);
  if (legacy) return { form: 'legacy', number: Number(legacy[1]) };
  const shared = new RegExp(`^${prefix}-(${TAG})-(\\d{4,})$`).exec(value);
  if (shared) return { form: 'shared', tag: shared[1], number: Number(shared[2]) };
  return null;
}

// Next ID in `existing` (directory names) for the given allocation form. Pure and
// deterministic: the legacy form continues the highest legacy number; the shared form
// continues the highest sequence carrying this clone's tag. Other tags are ignored —
// they belong to other clones and can never be allocated here.
export function nextScopedId(prefix, existing, tag = null) {
  const parsed = existing.map((name) => parseScopedId(prefix, name)).filter(Boolean);
  if (!tag) {
    const highest = parsed.filter((id) => id.form === 'legacy').reduce((max, id) => Math.max(max, id.number), 0);
    return `${prefix}-${String(highest + 1).padStart(4, '0')}`;
  }
  if (!CLONE_TAG_PATTERN.test(tag)) throw new Error(`Invalid clone tag ${JSON.stringify(tag)}.`);
  const highest = parsed.filter((id) => id.form === 'shared' && id.tag === tag).reduce((max, id) => Math.max(max, id.number), 0);
  return `${prefix}-${tag}-${String(highest + 1).padStart(4, '0')}`;
}
