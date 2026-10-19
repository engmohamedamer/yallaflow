import path from 'node:path';
import { exists } from '../utils/fs.js';
import { workspacePath } from '../core/workspace.js';

// Doctor check for the optional quality ledgers (v1.1.0). Only structure is checked:
// media is local-only by default, so a missing media file in a fresh clone is expected
// and is reported by the quality report, never failed here.
export async function checkQualityIntegrity(root, meta) {
  const dir = path.join(workspacePath(root), 'work', meta.id, 'quality');
  if (!await exists(dir)) return [];
  const errors = [];
  if (await exists(path.join(dir, 'qc.json'))) {
    const { loadQcLedger } = await import('./qc.js');
    try {
      await loadQcLedger(root, meta.id);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (await exists(path.join(dir, 'demo.json'))) {
    const { loadDemoLedger } = await import('./demo.js');
    try {
      await loadDemoLedger(root, meta.id);
    } catch (error) {
      errors.push(error.message);
    }
  }
  return errors;
}
