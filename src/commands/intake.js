import { findProjectRoot, getCurrentState } from '../core/workspace.js';
import { prepareFileIntake } from '../intake/file.js';
import { defaultTitleFromFilename, describeContentAvailability } from '../intake/normalize.js';
import { findSourceByChecksum, linkSourceToWork, persistSource, removeSourceDir } from '../core/sources.js';
import { addSourceToWork, assertSourceLinkAllowed, createPendingIntake } from '../behavior/routing.js';
import { loadWorkMetaOrThrow } from '../core/workspace.js';
import { describeTrigger, loadWorkImpacts, pendingImpact } from '../delivery/impact.js';

// Creates a new pending work item from one or more source files:
//   yallaflow intake SRS.docx
//   yallaflow intake requirements.docx payment-rules.xlsx --title "Contract Hub"
export async function intakeCommand(filePaths, options = {}) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  if (!filePaths?.length) throw new Error('Usage: yallaflow intake <file> [<file> ...] [--title TITLE]');

  const sources = await captureSources(root, filePaths);
  const titleHint = options.title?.trim() || defaultTitleFromFilename(sources[0].sourceName);

  let work;
  try {
    work = await createPendingIntake(root, describeRawRequest(sources), {
      sources: sources.map(sourceRef),
      titleHint
    });
  } catch (error) {
    for (const source of sources) await removeSourceDir(root, source.id);
    throw error;
  }
  for (const source of sources) await linkSourceToWork(root, source.id, work.id);

  console.log(sources.length === 1 ? `Source captured: ${sources[0].id}` : `Sources captured: ${sources.map((s) => s.id).join(', ')}`);
  console.log(`Work created: ${work.id}`);
  console.log(`\nSource${sources.length > 1 ? 's' : ''}:\n${sources.map(describeSource).join('\n')}`);
  console.log('\nRouting:\npending');
  console.log(
    `\nNext:\nClassify this work using YallaFlow routing ` +
    `(\`yallaflow guide ${work.id}\`, then \`yallaflow route ${work.id} --type TYPE --scope SCOPE --confidence LEVEL --reason "REASON"\`).`
  );
}

// Attaches one or more additional sources to an existing work item:
//   yallaflow intake add PF-0001 client-notes.docx
export async function intakeAddCommand(requestedWorkId, filePaths, options = {}) {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  const state = await getCurrentState(root);
  const workId = requestedWorkId ?? state.activeWork;
  if (!workId) throw new Error('No active work item. Provide a work ID: `yallaflow intake add PF-0001 <file>`.');
  if (!filePaths?.length) throw new Error('Usage: yallaflow intake add <work-id> <file> [<file> ...] [--reason TEXT]');
  // Checked before any source is persisted, so a refused link leaves no orphan source.
  assertSourceLinkAllowed(await loadWorkMetaOrThrow(root, workId), options.reason);

  const sources = await captureSources(root, filePaths);
  let work;
  try {
    for (const source of sources) work = await addSourceToWork(root, workId, sourceRef(source), undefined, { reason: options.reason });
  } catch (error) {
    for (const source of sources) await removeSourceDir(root, source.id);
    throw error;
  }
  for (const source of sources) await linkSourceToWork(root, source.id, workId);

  console.log(sources.length === 1 ? `Source captured: ${sources[0].id}` : `Sources captured: ${sources.map((s) => s.id).join(', ')}`);
  console.log(`Attached to: ${work.id}`);
  console.log(`\nSource${sources.length > 1 ? 's' : ''}:\n${sources.map(describeSource).join('\n')}`);
  console.log(`\nTotal sources on ${work.id}: ${work.sources.length}`);
  if (work.status === 'DONE') console.log(`${work.id} remains DONE; recorded as recovered source(s) attached after completion (reason: ${options.reason.trim()}).`);
  const impact = pendingImpact((await loadWorkImpacts(root, work)).ledger);
  if (impact && impact.triggers.some((trigger) => trigger.type === 'source' && sources.some((source) => source.id === trigger.source))) {
    console.log(`\nImpact ${impact.id} pending: ${impact.triggers.map(describeTrigger).join('; ')} after ${work.id}'s approved intent was fixed.`);
    console.log(`YallaFlow does not judge what the source changes. Assess which completed stages it affects before continuing:\n  yallaflow impact status ${work.id}\n  yallaflow impact assess ${work.id} --file impact.json`);
  }
}

async function captureSources(root, filePaths) {
  const sources = [];
  for (const filePath of filePaths) {
    const normalized = await prepareFileIntake(filePath);
    const duplicate = await findSourceByChecksum(root, normalized.metadata.sha256);
    if (duplicate) console.log(`This file matches existing source ${duplicate.id}.`);
    sources.push(await persistSource(root, normalized));
  }
  return sources;
}

function sourceRef(source) {
  return { id: source.id, type: source.sourceType, name: source.sourceName, detectedFormat: source.detectedFormat, contentAvailability: source.contentAvailability };
}

function describeSource(source) {
  return `${source.sourceName} — ${describeContentAvailability(source.contentAvailability)}`;
}

function describeRawRequest(sources) {
  return sources.length === 1
    ? `File intake: ${sources[0].sourceName}`
    : `File intake: ${sources.map((s) => s.sourceName).join(', ')}`;
}
