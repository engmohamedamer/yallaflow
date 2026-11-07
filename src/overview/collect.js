// `yallaflow overview --json` (1.4.0): one read-only document about the project itself:
// what it is (approved project memory), what it is built with (repository evidence),
// how current that understanding is, and where onboarding stands. Nothing is written,
// nothing is executed, and no baseline is started or approved here.
import path from 'node:path';
import { readYaml } from '../core/yaml.js';
import { workspacePath } from '../core/workspace.js';
import { PACKAGE_VERSION } from '../version.js';
import { loadContextLedger } from '../context/ledger.js';
import { factFreshness } from '../context/freshness.js';
import { FRESHNESS } from '../context/constants.js';
import { assessProjectUnderstanding, UNDERSTANDING } from '../baseline/understanding.js';
import { classifyProject, inventoryRepository } from '../inventory/inventory.js';
import { detectStack } from '../inventory/stack.js';

export const OVERVIEW_SCHEMA = 'yallaflow.overview/1';
const SUMMARY_AREAS = Object.freeze(['project', 'architecture', 'tech-stack', 'database', 'integration', 'environment']);
const PER_AREA_LIMIT = 12;

// What the developer asks the agent, per understanding state. The console shows the words;
// the CLI command stays behind "For developers". Nothing here runs a command.
const GUIDANCE = Object.freeze({
  [UNDERSTANDING.REQUIRED]: { ask: 'Establish project understanding for this repository.', command: 'yallaflow baseline start --objective "<your first request>"' },
  [UNDERSTANDING.IN_PROGRESS]: { ask: 'Continue the project-understanding discovery.', command: null },
  [UNDERSTANDING.AWAITING_REVIEW]: { ask: 'Show me the project-understanding draft so I can review it.', command: null },
  [UNDERSTANDING.ESTABLISHED]: { ask: null, command: 'yallaflow context status' },
  [UNDERSTANDING.GREENFIELD]: { ask: 'Here is what we are building: <product goal and first requirements>.', command: null },
  PROJECT_UNDERSTANDING_UNAVAILABLE: { ask: 'Check the project records with yallaflow doctor.', command: 'yallaflow doctor' }
});

export async function collectOverview(root, { now = new Date().toISOString() } = {}) {
  const config = await readYaml(path.join(workspacePath(root), 'config.yaml')).catch(() => ({}));
  const kind = config.project?.kind ?? null;

  let inventory = null;
  let classification = null;
  let inventoryError = null;
  try {
    inventory = await inventoryRepository(root);
    classification = classifyProject(inventory);
  } catch (error) {
    inventoryError = String(error.message);
  }

  let understanding;
  try {
    understanding = await assessProjectUnderstanding(root, { kind, inventoryKind: classification?.kind ?? null });
  } catch (error) {
    understanding = { state: 'PROJECT_UNDERSTANDING_UNAVAILABLE', label: 'Project understanding could not be read.', detail: String(error.message), facts: null };
  }
  const guidance = GUIDANCE[understanding.state] ?? GUIDANCE.PROJECT_UNDERSTANDING_UNAVAILABLE;
  understanding = {
    state: understanding.state,
    label: understanding.label,
    facts: understanding.facts ?? null,
    baselineId: understanding.baselineId ?? null,
    detail: understanding.detail ?? null,
    ask: guidance.ask,
    command: understanding.command ?? guidance.command
  };

  const memory = { available: true, current: 0, fresh: 0, mayBeStale: 0, staleEvidence: 0, unknown: 0, disputed: 0, unresolved: 0, error: null };
  const areas = Object.fromEntries(SUMMARY_AREAS.map((area) => [area, { total: 0, facts: [] }]));
  try {
    const { ledger } = await loadContextLedger(root);
    for (const fact of ledger.facts) {
      if (fact.state === 'superseded') continue;
      const freshness = (await factFreshness(root, fact)).status;
      memory.current += 1;
      if (fact.state === 'disputed') memory.disputed += 1;
      if (fact.confidence === 'unresolved') memory.unresolved += 1;
      if (freshness === FRESHNESS.FRESH) memory.fresh += 1;
      else if (freshness === FRESHNESS.MAY_BE_STALE) memory.mayBeStale += 1;
      else if (freshness === FRESHNESS.STALE_EVIDENCE) memory.staleEvidence += 1;
      else memory.unknown += 1;
      const bucket = areas[fact.area];
      if (!bucket) continue;
      bucket.total += 1;
      if (bucket.facts.length < PER_AREA_LIMIT) {
        bucket.facts.push({ id: fact.id, summary: String(fact.summary ?? ''), state: fact.state, confidence: fact.confidence ?? null, freshness });
      }
    }
  } catch (error) {
    Object.assign(memory, { available: false, error: String(error.message) });
  }

  const stack = inventory ? await detectStack(root, inventory) : { entries: [], modules: [], unread: [] };

  return {
    schema: OVERVIEW_SCHEMA,
    generatedAt: now,
    yallaflowVersion: PACKAGE_VERSION,
    project: {
      name: config.project?.name ?? path.basename(root),
      kind,
      shared: Boolean(config.shared?.enabled),
      // 1.4.0: provenance of a project created by the New Project Wizard (generated code not reviewed).
      origin: config.project?.origin ?? null,
      classification: classification ? { kind: classification.kind, reasons: classification.reasons } : null
    },
    understanding,
    memory,
    areas,
    stack: { entries: stack.entries, unread: stack.unread },
    modules: stack.modules,
    coverage: inventory
      ? {
          available: true,
          scannedEntries: inventory.scanned.entries,
          scannedDirectories: inventory.scanned.directories,
          truncated: inventory.truncated.entries || inventory.truncated.depthLimitedDirectories > 0,
          depthLimitedDirectories: inventory.truncated.depthLimitedDirectories,
          skipped: { ...inventory.skipped },
          sourceFiles: inventory.sourceFiles.total,
          documents: inventory.documents.total,
          manifests: inventory.manifests.length,
          git: inventory.git,
          error: null
        }
      : { available: false, error: inventoryError }
  };
}
