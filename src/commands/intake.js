import { findProjectRoot } from '../core/workspace.js';
import { prepareFileIntake } from '../intake/file.js';
import { defaultTitleFromFilename } from '../intake/normalize.js';
import { findSourceByChecksum, linkSourceToWork, persistSource, removeSourceDir } from '../core/sources.js';
import { createPendingIntake } from '../behavior/routing.js';

export async function intakeCommand(filePath, options = {}) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!filePath) throw new Error('Usage: yallaflow intake <file> [--title TITLE]');

  const normalized = await prepareFileIntake(filePath);
  const duplicate = await findSourceByChecksum(root, normalized.metadata.sha256);
  if (duplicate) console.log(`This file matches existing source ${duplicate.id}.`);

  const source = await persistSource(root, normalized);
  const titleHint = options.title?.trim() || defaultTitleFromFilename(source.sourceName);

  let work;
  try {
    work = await createPendingIntake(root, `File intake: ${source.sourceName}`, {
      source: { id: source.id, type: source.sourceType, name: source.sourceName },
      titleHint
    });
  } catch (error) {
    await removeSourceDir(root, source.id);
    throw error;
  }
  await linkSourceToWork(root, source.id, work.id);

  console.log(`Source captured: ${source.id}`);
  console.log(`Work created: ${work.id}`);
  console.log(`\nSource:\n${source.sourceName}`);
  console.log('\nRouting:\npending');
  console.log(
    `\nNext:\nClassify this work using YallaFlow routing ` +
    `(\`yallaflow guide ${work.id}\`, then \`yallaflow route ${work.id} --type TYPE --scope SCOPE --confidence LEVEL --reason "REASON"\`).`
  );
}
