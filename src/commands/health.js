import { findProjectRoot } from '../core/workspace.js';
import { assessHealth, HEALTH_LABELS } from '../core/health.js';

// Read-only (PF-0183). Exit code 1 when a person has to act before updating (manual review or
// unsafe), so a script can stop there.
export async function healthCommand({ json = false } = {}) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found here. Run `yallaflow init` to start one, or run this inside a YallaFlow project.');
  const report = await assessHealth(root);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Project health: ${report.label}`);
    if (!report.findings.length) console.log('Everything YallaFlow checks is in order. Nothing to update.');
    for (const item of report.findings) {
      console.log(`\n[${HEALTH_LABELS[item.class]}] ${item.message}`);
      if (item.next) console.log(`  Next: ${item.next}`);
    }
    if (report.notes.length) {
      console.log('\nNotes:');
      for (const note of report.notes) console.log(`  - ${note}`);
    }
    console.log('\nThis check is read-only; nothing was changed.');
  }
  if (['manual-review', 'unsafe'].includes(report.overall)) process.exitCode = 1;
}
