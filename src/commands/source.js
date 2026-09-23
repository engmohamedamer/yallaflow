import path from 'node:path';
import { exists } from '../utils/fs.js';
import { readYaml } from '../core/yaml.js';
import { findProjectRoot, workspacePath } from '../core/workspace.js';
import { listSources, loadSource, loadSourceText, sourceChecksum } from '../core/sources.js';
import { describeContentAvailability } from '../intake/normalize.js';

export async function sourceCommand(action, args = {}) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');

  if (action === 'list') {
    const sources = await listSources(root);
    console.log(`Sources: ${sources.length}`);
    if (!sources.length) console.log('(no sources captured)');
    for (const record of sources) {
      const linked = record.linkedWork.length ? record.linkedWork.join(', ') : 'none';
      const format = (record.detectedFormat ?? record.metadata.extension.replace('.', '')).toUpperCase();
      console.log(`${record.id} [${format}] ${record.sourceName} — ${describeContentAvailability(record.contentAvailability ?? 'native-text')} — captured ${record.capturedAt} — linked: ${linked}`);
    }
    return;
  }

  if (action === 'show') {
    if (!args.sourceId) throw new Error('Usage: yallaflow source show <source-id> [--content]');
    const record = await loadSource(root, args.sourceId);
    const legacy = record.schemaVersion === 1;
    console.log(record.id);
    console.log(`Type: ${record.sourceType}`);
    console.log(`Name: ${record.sourceName}`);
    console.log(`Format: ${(record.detectedFormat ?? record.metadata.extension.replace('.', '')).toUpperCase()}`);
    console.log(`Content type: ${record.contentType}`);
    console.log(`Content: ${describeContentAvailability(legacy ? 'native-text' : record.contentAvailability)}`);
    console.log(`Captured: ${record.capturedAt}`);
    console.log(`Checksum: sha256:${sourceChecksum(record)}`);
    console.log(`Size: ${legacy ? record.metadata.sizeBytes : record.original.sizeBytes} bytes`);
    console.log(`Location: .yallaflow/${legacy ? record.sourceRef : record.original.path}`);
    console.log(`Linked work: ${record.linkedWork.length ? record.linkedWork.join(', ') : 'none'}`);
    for (const workId of record.linkedWork) {
      const metaFile = path.join(workspacePath(root), 'work', workId, 'meta.yaml');
      if (!await exists(metaFile)) continue;
      const ref = ((await readYaml(metaFile)).sources ?? []).find((entry) => entry.id === record.id);
      if (!ref) continue;
      const timing = ref.linkedAt ? `linked ${ref.linkedAt} while ${ref.workStatusAtLink}` : 'linked before link auditing existed';
      console.log(ref.relationship === 'recovered-source'
        ? `  ${workId}: RECOVERED SOURCE — ${timing}; not available during the original execution. Reason: ${ref.reason}`
        : `  ${workId}: work input — ${timing}`);
    }
    if (args.content) {
      const text = await loadSourceText(root, record);
      if (text === null) {
        console.log('\nContent:\n\nNo text representation is available for this source. Only the original file was preserved; inspect it directly at the location above.');
      } else {
        console.log('\nContent:\n');
        console.log(text);
      }
    }
    return;
  }

  throw new Error(`Unknown source action: ${action}. Use list or show.`);
}
