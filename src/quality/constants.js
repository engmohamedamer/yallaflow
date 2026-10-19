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

// Binary media stays on this machine unless the project opts in (quality.media.commit).
export const MEDIA_GITIGNORE = '# Written by YallaFlow: QC/demo media stays local. Hashes and sizes are in qc.json / demo.json.\n# Set quality.media.commit: true in .yallaflow/config.yaml to track media in Git instead.\n*\n!.gitignore\n';

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
