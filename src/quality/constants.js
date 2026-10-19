import { recordIdSource } from '../core/ids.js';

// Optional quality delivery (v1.1.0): AI QC and Smart Demo. Both are on-demand: no
// command runs a browser, a server, or a test because YallaFlow was initialized or a
// task advanced. YallaFlow never executes them itself; the Agent drives Playwright
// (CLI or MCP) and records what actually happened. YallaFlow validates, hashes, stores
// locally, and reports — and refuses a claimed pass that carries no execution evidence.
export const QC_SCHEMA_VERSION = 1;
export const DEMO_SCHEMA_VERSION = 1;

export const QC_POLICIES = Object.freeze(['advisory', 'strict']);
export const DEFAULT_QC_POLICY = 'advisory';
export const QC_SCENARIO_KINDS = Object.freeze(['functional', 'exploratory']);
export const QC_STATUSES = Object.freeze(['passed', 'failed', 'blocked', 'not-run']);
export const QC_TOOLS = Object.freeze(['playwright-cli', 'playwright-mcp', 'playwright-test', 'other']);
// agent-driven       the Agent operated the browser and observed the result
// yallaflow-verified the scenario's outcome is a YallaFlow-executed verification run (V-###)
export const QC_ORIGINS = Object.freeze(['agent-driven', 'yallaflow-verified']);

export const DEMO_AUDIENCES = Object.freeze(['business', 'developer']);
export const DEMO_RESULT_STATUSES = Object.freeze(['shown', 'skipped', 'failed']);
export const DEMO_DISCLAIMER = 'A demonstration, not test evidence: it shows selected scenarios working once, as recorded. It does not prove correctness or coverage.';

export const PLAN_ID = new RegExp(`^${recordIdSource('QP')}$`);
export const RUN_ID = new RegExp(`^${recordIdSource('QC')}$`);
export const SCENARIO_ID = /^S-\d{2,}$/;
export const DEMO_PROPOSAL_ID = new RegExp(`^${recordIdSource('DP')}$`);
export const DEMO_RUN_ID = new RegExp(`^${recordIdSource('DM')}$`);
export const DEMO_SCENARIO_ID = /^D-\d{2,}$/;

export const MAX_ARTIFACT_BYTES = 500 * 1024 * 1024;
export const MAX_ARTIFACTS_PER_RECORD = 200;

// Generated QC/demo artifacts stay out of Git (v1.1.0): media (videos, screenshots,
// traces) and the regenerated reports. Only qc.json / demo.json — the durable records
// with approvals, results, and media hashes — are committed. quality.media.commit: true
// opts media back in; reports are always local. Older builds wrote media/.gitignore,
// which stays valid.
export const QUALITY_GITIGNORE_HEADER = '# Written by YallaFlow: generated QC/demo artifacts stay on this machine.';
// The pre-release media/.gitignore header (ignores all media).
export const LEGACY_MEDIA_GITIGNORE_HEADER = '# Written by YallaFlow: QC/demo media stays local.';

export function qualityGitignore({ commitMedia = false } = {}) {
  return [
    QUALITY_GITIGNORE_HEADER,
    '# qc.json and demo.json (approvals, results, media hashes) are committed.',
    commitMedia ? '# Media is committed because quality.media.commit is true.' : '# Set quality.media.commit: true in .yallaflow/config.yaml to commit media too.',
    ...(commitMedia ? [] : ['media/']),
    'report.md',
    'report.html',
    ''
  ].join('\n');
}

export const ARTIFACT_KINDS = Object.freeze({
  '.webm': 'video', '.mp4': 'video', '.mov': 'video',
  '.png': 'screenshot', '.jpg': 'screenshot', '.jpeg': 'screenshot', '.gif': 'screenshot', '.webp': 'screenshot',
  '.zip': 'trace',
  '.log': 'log', '.txt': 'log', '.json': 'data', '.md': 'notes', '.html': 'report', '.pdf': 'document'
});

// Targets a recording or a QC run may use without --allow-remote.
export function isLocalTarget(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' ||
      /\.(localhost|local|test)$/.test(host) || /^127\./.test(host);
  } catch {
    return false;
  }
}
