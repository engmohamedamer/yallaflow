import path from 'node:path';
import { exists } from '../utils/fs.js';
import { workspacePath } from '../core/workspace.js';
import { artifactState } from './artifacts.js';
import { insideGitWorkTree, trackedPaths } from '../shared/git.js';

// Doctor checks for the optional quality ledgers (v1.1.0).
//   errors    a ledger that does not validate
//   warnings  stored media whose bytes no longer match the recorded hash (evidence
//             overwritten or edited; only with verifyMedia — `doctor`, `qc status`,
//             `demo status`), and record IDs duplicated by a merge of two
//             branches' ledgers. Missing media is not reported: media is local-only by
//             default, so a fresh clone legitimately has none.
export async function checkQualityIntegrity(root, meta, { verifyMedia = false } = {}) {
  const dir = path.join(workspacePath(root), 'work', meta.id, 'quality');
  if (!await exists(dir)) return { errors: [], warnings: [] };
  const errors = [];
  const warnings = [];
  const ledgers = await loadLedgers(root, meta.id, errors);
  if (ledgers.qc) {
    const { qcDuplicateIds } = await import('./qc.js');
    const duplicates = qcDuplicateIds(ledgers.qc);
    if (duplicates.length) warnings.push(`${meta.id}: QC ledger has duplicate record IDs ${duplicates.join(', ')} (merged from different branches); citations of them are refused — record again to cite`);
  }
  if (ledgers.demo) {
    const { demoDuplicateIds } = await import('./demo.js');
    const duplicates = demoDuplicateIds(ledgers.demo);
    if (duplicates.length) warnings.push(`${meta.id}: demo ledger has duplicate record IDs ${duplicates.join(', ')} (merged from different branches)`);
  }
  if (verifyMedia) {
    warnings.push(...await mediaWarnings(root, meta.id, ledgers));
    // Generated artifacts committed before quality/.gitignore existed (pre-release builds)
    // stay tracked — YallaFlow never untracks or deletes them; it names them once.
    if (insideGitWorkTree(root)) {
      const quality = `.yallaflow/work/${meta.id}/quality`;
      const commitMedia = await mediaCommitted(root);
      const generated = trackedPaths(root, quality).filter((file) => /\/quality\/(report\.(md|html)|media\/(?!\.gitignore$).+)$/.test(file));
      const unexpected = generated.filter((file) => !(commitMedia && /\/quality\/media\//.test(file)));
      if (unexpected.length) {
        // Only paths Git actually tracks: reports by name, media by record folder.
        const pathspecs = [...new Set(unexpected.map((file) => file.replace(/(\/quality\/media\/[^/]+)\/.+$/, '$1')))];
        warnings.push(`${meta.id}: generated QC/demo files are still tracked by Git (${unexpected.length} file(s), e.g. ${unexpected[0]}); they stay tracked until you untrack them (Git ignore rules do not apply to tracked files, so regenerated copies show as modified). To stop tracking them, run once: git rm -r --cached -- ${pathspecs.join(' ')} (local files are kept)`);
      }
      if (commitMedia) {
        const { exists: present } = await import('../utils/fs.js');
        const { readFile } = await import('node:fs/promises');
        const { LEGACY_MEDIA_GITIGNORE_HEADER } = await import('./constants.js');
        const legacy = path.join(workspacePath(root), 'work', meta.id, 'quality', 'media', '.gitignore');
        if (await present(legacy) && (await readFile(legacy, 'utf8')).startsWith(LEGACY_MEDIA_GITIGNORE_HEADER)) {
          warnings.push(`${meta.id}: quality.media.commit is true, but ${quality}/media/.gitignore (written by a pre-release build) still ignores all media; delete that file to commit media`);
        }
      }
    }
  }
  return { errors, warnings };
}

async function mediaCommitted(root) {
  const { loadQualitySettings } = await import('./qc.js');
  return (await loadQualitySettings(root)).commitMedia;
}

// How much of the recorded media is on this machine (size/existence only; no hashing).
// Media is local by default, so a fresh clone has the records but not the files.
export async function mediaAvailability(root, workId, kind = null) {
  const { stat } = await import('node:fs/promises');
  const { mediaDirPath, qualityDirPath } = await import('./artifacts.js');
  const ledgers = await loadLedgers(root, workId, []);
  const artifacts = new Map();
  for (const run of kind === 'demo' ? [] : ledgers.qc?.runs ?? []) for (const result of run.scenarios ?? []) for (const artifact of result.artifacts ?? []) artifacts.set(artifact.path, artifact);
  for (const run of kind === 'qc' ? [] : ledgers.demo?.runs ?? []) for (const artifact of [...(run.video ? [run.video] : []), ...(run.scenarios ?? []).flatMap((result) => result.artifacts ?? [])]) artifacts.set(artifact.path, artifact);
  let present = 0;
  const media = mediaDirPath(root, workId);
  for (const artifact of artifacts.values()) {
    const file = path.resolve(qualityDirPath(root, workId), artifact.path);
    if (file.startsWith(media + path.sep) && (await stat(file).catch(() => null))?.isFile()) present += 1;
  }
  return { recorded: artifacts.size, present };
}

export async function qualityMediaWarnings(root, workId) {
  return mediaWarnings(root, workId, await loadLedgers(root, workId, []));
}

async function loadLedgers(root, workId, errors) {
  const dir = path.join(workspacePath(root), 'work', workId, 'quality');
  const ledgers = { qc: null, demo: null };
  if (await exists(path.join(dir, 'qc.json'))) {
    const { loadQcLedger } = await import('./qc.js');
    try { ledgers.qc = (await loadQcLedger(root, workId)).ledger; } catch (error) { errors.push(error.message); }
  }
  if (await exists(path.join(dir, 'demo.json'))) {
    const { loadDemoLedger } = await import('./demo.js');
    try { ledgers.demo = (await loadDemoLedger(root, workId)).ledger; } catch (error) { errors.push(error.message); }
  }
  return ledgers;
}

async function mediaWarnings(root, workId, ledgers) {
  const warnings = [];
  const seen = new Set();
  const check = async (label, artifact) => {
    if (seen.has(artifact.path)) return;
    seen.add(artifact.path);
    const state = await artifactState(root, workId, artifact);
    if (state === 'changed') warnings.push(`${workId}: ${label} ${artifact.path} no longer matches its recorded SHA-256 — the evidence was overwritten or edited after it was recorded`);
    if (state === 'unsafe') warnings.push(`${workId}: ${label} ${artifact.path} is a link to a location outside the media folder; it was not read`);
    if (state === 'unreadable') warnings.push(`${workId}: ${label} ${artifact.path} exists but could not be read to check its SHA-256`);
  };
  for (const run of ledgers.qc?.runs ?? []) {
    for (const result of run.scenarios ?? []) for (const artifact of result.artifacts ?? []) await check(`${run.id} ${result.id}`, artifact);
  }
  for (const run of ledgers.demo?.runs ?? []) {
    if (run.video) await check(`${run.id} video`, run.video);
    for (const result of run.scenarios ?? []) for (const artifact of result.artifacts ?? []) await check(`${run.id} ${result.id}`, artifact);
  }
  return warnings;
}
