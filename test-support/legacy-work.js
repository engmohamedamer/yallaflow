// Test-only fixture: reproduces, byte-for-byte in shape, the contract-less work item
// that the pre-v0.3.6 `createWorkItem` (the direct `feature`/`bug`/`investigate`/...
// shortcuts) wrote: no routingStatus, no workflow, no Behavior Contract, eager
// optional directories. v0.3.6 product code can no longer create this shape; it
// exists here only so legacy-compatibility tests can prove such work stays readable.
// Lives outside test/ so Node's default test discovery (**/test/**/*.js) does not
// load it as a zero-test module; it is not part of the published package.
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { nextWorkId, workSections, workspacePath } from '../src/core/workspace.js';
import { writeYaml } from '../src/core/yaml.js';
import { writeText } from '../src/utils/fs.js';

export async function createLegacyWorkItem(root, type, title, scope = null) {
  const id = await nextWorkId(root);
  const now = new Date().toISOString();
  const meta = {
    id,
    type,
    title,
    status: 'INTAKE',
    scope,
    readOnly: type === 'investigation',
    knowledgePolicy: { version: 1, reviewRequired: true },
    createdAt: now,
    updatedAt: now
  };
  const dir = path.join(workspacePath(root), 'work', id);
  for (const optional of ['attachments', 'evidence', 'execution']) await mkdir(path.join(dir, optional), { recursive: true });
  await writeYaml(path.join(dir, 'meta.yaml'), meta);
  await writeText(path.join(dir, 'work.md'), `# ${id} — ${title}\n\n**Type:** ${type}\n**Status:** INTAKE\n**Scope:** ${scope ?? 'unspecified'}\n**Read-only:** ${meta.readOnly ? 'yes' : 'no'}\n\n${workSections(type, scope)}`);
  await writeText(path.join(dir, 'progress.md'), `# Work Ledger — ${id}\n\nCreated: ${now}\n\n`);
  await writeYaml(path.join(workspacePath(root), 'state', 'current.yaml'), { schemaVersion: 1, activeWork: id, stage: 'INTAKE', updatedAt: now });
  return meta;
}
