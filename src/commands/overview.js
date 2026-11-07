import { findProjectRoot } from '../core/workspace.js';
import { collectOverview } from '../overview/collect.js';

// Read-only. `--json` prints one document (schema yallaflow.overview/1) or
// `{ "error": { code, message } }` with exit code 1.
export async function overviewCommand({ json = false } = {}) {
  const root = await findProjectRoot();
  if (!root) {
    if (!json) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
    process.stdout.write(`${JSON.stringify({ error: { code: 'NO_WORKSPACE', message: 'No .yallaflow workspace found. Run `yallaflow init` first.' } })}\n`);
    process.exitCode = 1;
    return;
  }
  let overview;
  try {
    overview = await collectOverview(root);
  } catch (error) {
    if (!json) throw error;
    process.stdout.write(`${JSON.stringify({ error: { code: error.code ?? 'ERROR', message: error.message } })}\n`);
    process.exitCode = 1;
    return;
  }
  if (json) return process.stdout.write(`${JSON.stringify(overview)}\n`);
  const { project, understanding, memory, stack, modules, coverage } = overview;
  console.log(`${project.name} — ${project.kind ?? 'kind not recorded'}`);
  console.log(`Project understanding: ${understanding.state} — ${understanding.label}`);
  if (understanding.ask) console.log(`Ask your agent: ${understanding.ask}`);
  if (memory.available) console.log(`Project memory: ${memory.current} current · ${memory.fresh} fresh · ${memory.mayBeStale + memory.staleEvidence} to revalidate · ${memory.disputed} disputed · ${memory.unresolved} unresolved`);
  else console.log(`Project memory: unavailable (${memory.error})`);
  const declared = stack.entries.filter((entry) => entry.basis === 'declared' && ['framework', 'runtime', 'database', 'cache', 'queue', 'search'].includes(entry.kind));
  if (declared.length) console.log(`Declared stack: ${[...new Set(declared.map((entry) => entry.declared ? `${entry.component} ${entry.declared}` : entry.component))].join(', ')}`);
  const languages = stack.entries.filter((entry) => entry.kind === 'language');
  if (languages.length) console.log(`Languages (inferred from file counts): ${languages.map((entry) => `${entry.component} (${entry.count})`).join(', ')}`);
  if (modules.length) console.log(`Modules: ${modules.map((module) => `${module.path} [${module.ecosystems.join(', ') || '?'}]`).join(' · ')}`);
  for (const module of modules) for (const conflict of module.conflicts) console.log(`Conflict in ${module.path}: ${conflict}`);
  if (stack.unread.length) console.log(`Not read: ${stack.unread.map((entry) => `${entry.path} (${entry.reason})`).join(', ')}`);
  if (coverage.available) console.log(`Coverage: ${coverage.scannedEntries} entries${coverage.truncated ? ' (truncated)' : ''}, ${coverage.sourceFiles} source files, ${coverage.manifests} manifests`);
  console.log('\nMachine-readable: yallaflow overview --json');
}
