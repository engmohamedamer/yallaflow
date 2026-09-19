import { findProjectRoot } from '../core/workspace.js';
import { listSources, loadSource } from '../core/sources.js';

export async function sourceCommand(action, args = {}) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');

  if (action === 'list') {
    const sources = await listSources(root);
    console.log(`Sources: ${sources.length}`);
    if (!sources.length) console.log('(no sources captured)');
    for (const record of sources) {
      const linked = record.linkedWork.length ? record.linkedWork.join(', ') : 'none';
      console.log(`${record.id} [${record.sourceType}] ${record.sourceName} — captured ${record.capturedAt} — linked: ${linked}`);
    }
    return;
  }

  if (action === 'show') {
    if (!args.sourceId) throw new Error('Usage: yallaflow source show <source-id> [--content]');
    const record = await loadSource(root, args.sourceId);
    console.log(record.id);
    console.log(`Type: ${record.sourceType}`);
    console.log(`Name: ${record.sourceName}`);
    console.log(`Content type: ${record.contentType}`);
    console.log(`Captured: ${record.capturedAt}`);
    console.log(`Checksum: sha256:${record.metadata.sha256}`);
    console.log(`Size: ${record.metadata.sizeBytes} bytes`);
    console.log(`Location: .yallaflow/${record.sourceRef}`);
    console.log(`Linked work: ${record.linkedWork.length ? record.linkedWork.join(', ') : 'none'}`);
    if (args.content) {
      console.log('\nContent:\n');
      console.log(record.rawText);
    }
    return;
  }

  throw new Error(`Unknown source action: ${action}. Use list or show.`);
}
