import path from 'node:path';
import { rm } from 'node:fs/promises';
import { exists, readText, writeText } from '../utils/fs.js';
import { readYaml, writeYaml } from '../core/yaml.js';
import { findProjectRoot, getConfig, getCurrentState, listWork, workspacePath } from '../core/workspace.js';
import { loadContextLedger, probeContextSchema } from '../context/ledger.js';
import { collectDoctorReport } from './doctor.js';
import { inspectAllBootstraps, BOOTSTRAP_PROVIDERS } from '../agent/bootstrap.js';
import { assessProjectUnderstanding, UNDERSTANDING } from '../baseline/understanding.js';
import {
  CONFIG_SCHEMA_SHARED,
  DEFAULT_LARGE_FILE_BYTES,
  SHARED_MINIMUM_VERSION,
  checkProjectCompatibility,
  describeCompatibility,
  isBranchName,
  loadSharedPolicy,
  sharedPolicy
} from '../shared/config.js';
import { currentBranch, defaultIntegrationBranch, insideGitWorkTree, isGitIgnored, trackedPaths } from '../shared/git.js';
import { describeActor, ensureLocalIdentity, gitActor, localDirPath, LOCAL_DIR, readLocalIdentity } from '../shared/identity.js';
import { ledgerFingerprint, shortFingerprint } from '../shared/fingerprint.js';
import { integrateSharedMemory, planSharedIntegration } from '../shared/memory.js';
import { collectSharedIntegrity, formatBytes, sourcesFootprint } from '../shared/integrity.js';
import { PACKAGE_VERSION } from '../version.js';

const LOCAL_IGNORE = `${LOCAL_DIR}/`;

async function requireRoot() {
  const root = await findProjectRoot();
  if (!root) throw new Error('No .yallaflow workspace found. Run `yallaflow init` first.');
  return root;
}

// ---------------------------------------------------------------------------
// yallaflow shared enable — the one-time, explicit maintainer step.

export async function sharedEnableCommand({ integrationBranch, dryRun = false } = {}) {
  const root = await requireRoot();
  const config = await getConfig(root);
  const existing = sharedPolicy(config);
  if (existing.enabled) {
    console.log(`Already a Shared Project (integration branch ${existing.integrationBranch}, requires YallaFlow >= ${existing.minimumVersion}). Nothing changed.`);
    console.log('Status: yallaflow shared status');
    return;
  }
  const refuse = (reason) => new Error(`Shared Project Mode was not enabled: ${reason}\n\nNothing was changed.`);
  if (!insideGitWorkTree(root)) throw refuse('this workspace is not inside a Git work tree. Git is how a Shared Project is shared.');
  if (isGitIgnored(root, '.yallaflow/config.yaml')) throw refuse('.yallaflow is gitignored. Project memory is shared through Git; stop ignoring .yallaflow first.');

  const schema = await probeContextSchema(root);
  if (!schema.supported) throw refuse(`the project context ledger uses a schema this CLI does not support (${schema.unreadable ? 'unreadable' : `v${schema.version}`}).`);
  const doctor = await collectDoctorReport(root);
  const failures = doctor.checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (failures.length) throw refuse(`the workspace is structurally unhealthy (${failures.length} doctor check(s) fail, e.g. ${failures[0]}). Run \`yallaflow doctor\` and fix it first.`);

  const detected = integrationBranch ? { branch: integrationBranch, source: '--integration-branch' } : defaultIntegrationBranch(root);
  if (!detected) {
    throw refuse('the integration branch could not be determined from local Git configuration (no origin/HEAD, no init.defaultBranch). Name it explicitly: yallaflow shared enable --integration-branch <branch>');
  }
  if (!isBranchName(detected.branch)) throw refuse(`${JSON.stringify(detected.branch)} is not a valid branch name.`);

  const understanding = await assessProjectUnderstanding(root, { kind: config.project?.kind });
  const { ledger } = await loadContextLedger(root);
  const tracked = trackedPaths(root, '.yallaflow');
  const bootstraps = await inspectAllBootstraps(root);
  const adapters = bootstraps.filter((item) => !['not-installed'].includes(item.state));
  const footprint = await sourcesFootprint(root);

  console.log(`YallaFlow Shared Project — ${dryRun ? 'preview (nothing written)' : 'enable'}\n`);
  console.log(`Integration branch: ${detected.branch} (from ${detected.source}) — the one branch where canonical project memory is written`);
  console.log(`Project understanding: ${understanding.label}`);
  if (understanding.state !== UNDERSTANDING.ESTABLISHED && understanding.state !== UNDERSTANDING.GREENFIELD) {
    console.log('  Recommended: approve the Brownfield baseline before sharing, so teammates start from one reviewed project understanding instead of each rediscovering it.');
  }
  console.log(`Project memory: ${ledger.facts.length} fact(s), schema ${schema.exists ? `v${schema.version}` : 'none yet'} · fingerprint ${shortFingerprint(ledgerFingerprint(ledger))}`);
  console.log(`.yallaflow in Git: ${tracked.length ? `${tracked.length} tracked path(s)` : 'not committed yet — commit it after enabling'}`);
  console.log(`Agent adapters: ${adapters.length ? adapters.map((item) => `${item.file} ${item.state}`).join(', ') : `none — for zero-command teammate sessions run yallaflow agent setup ${Object.keys(BOOTSTRAP_PROVIDERS).join('|')} and commit the file`}`);
  console.log(`Sources: ${footprint.count} (${formatBytes(footprint.total)})${footprint.largest && footprint.largest.size > DEFAULT_LARGE_FILE_BYTES ? ` — ${footprint.largest.id} is ${formatBytes(footprint.largest.size)}; consider Git LFS for .yallaflow/sources (docs/shared-projects.md)` : ' — stored in Git'}`);
  console.log(`Version: every teammate's YallaFlow must be >= ${SHARED_MINIMUM_VERSION} (installed ${PACKAGE_VERSION})`);

  console.log(`\n${dryRun ? 'Would write' : 'Writing'}:`);
  console.log('  .yallaflow/config.yaml    schema v2: shared policy, integration branch, minimum YallaFlow version');
  console.log(`  .yallaflow/.gitignore     ignore ${LOCAL_IGNORE} (personal runtime state)`);
  console.log('  .yallaflow/local/         this checkout\'s identity and active-work focus (moved from state/current.yaml)');
  if (dryRun) {
    console.log('\nNo files were changed. Re-run without --dry-run to enable.');
    return;
  }

  const now = new Date().toISOString();
  const base = workspacePath(root);
  // Order matters: ignore rules and local state first, the mode switch (config) last,
  // so an interruption never leaves a "shared" config without its local layout.
  const ignoreFile = path.join(base, '.gitignore');
  const ignore = await exists(ignoreFile) ? await readText(ignoreFile) : '';
  if (!ignore.split('\n').some((line) => [LOCAL_IGNORE, LOCAL_DIR, `/${LOCAL_IGNORE}`].includes(line.trim()))) {
    await writeText(ignoreFile, `${ignore}${ignore && !ignore.endsWith('\n') ? '\n' : ''}# YallaFlow Shared Project: personal runtime state (identity, active work) is never shared.\n${LOCAL_IGNORE}\n`);
  }
  await ensureLocalIdentity(root, now);
  const legacyState = path.join(base, 'state', 'current.yaml');
  const localState = path.join(localDirPath(root), 'state', 'current.yaml');
  if (await exists(legacyState)) {
    if (!await exists(localState)) await writeYaml(localState, await readYaml(legacyState));
    await rm(legacyState);
  }
  const next = {
    ...config,
    schemaVersion: CONFIG_SCHEMA_SHARED,
    yallaflow: { ...(config.yallaflow ?? {}), minimumVersion: SHARED_MINIMUM_VERSION },
    shared: { enabled: true, enabledAt: now, integrationBranch: detected.branch, sources: { storage: 'git', largeFileBytes: DEFAULT_LARGE_FILE_BYTES } }
  };
  await writeYaml(path.join(base, 'config.yaml'), next);

  console.log('\nShared Project Mode enabled. Nothing was committed or pushed.');
  console.log('Next (you): review and commit .yallaflow/ (and any agent adapter files), then push. YallaFlow never commits.');
  console.log('Teammates: git pull, open their coding agent, describe the task. No join command, no re-baseline — only a compatible YallaFlow.');
}

// ---------------------------------------------------------------------------
// yallaflow shared status — concise, read-only; only what this checkout knows.

export async function sharedStatusCommand({ verbose = false } = {}) {
  const root = await requireRoot();
  const policy = await loadSharedPolicy(root);
  const compat = await checkProjectCompatibility(root);
  const config = await getConfig(root);
  console.log(`Shared Project — ${config.project?.name ?? 'project'}`);
  if (!policy.enabled) {
    console.log('Mode: single-user (not shared). A maintainer enables sharing once with `yallaflow shared enable`.');
    console.log(describeCompatibility(compat));
    return;
  }
  const branch = currentBranch(root);
  const identity = await readLocalIdentity(root);
  const { ledger } = await loadContextLedger(root);
  const work = await listWork(root);
  const open = work.filter((item) => item.status !== 'DONE');
  const state = await getCurrentState(root);
  const { plan } = await planSharedIntegration(root);
  const integrity = await collectSharedIntegrity(root);
  const live = ledger.facts.filter((fact) => fact.state !== 'superseded').length;

  console.log(`Integration branch: ${policy.integrationBranch} · current branch: ${branch ?? 'detached HEAD'}${branch === policy.integrationBranch ? ' (integration branch)' : ''}`);
  console.log(describeCompatibility(compat));
  console.log(`You: ${describeActor(gitActor(root))}${identity && !identity.invalid ? ` · clone tag ${identity.cloneTag}` : ''}`);
  console.log(`Project memory: ${live} current fact(s) · fingerprint ${shortFingerprint(ledgerFingerprint(ledger))}`);
  console.log(`Work in this checkout: ${work.length} (${open.length} open)${state.activeWork ? ` · your active work: ${state.activeWork}` : ''}`);
  if (verbose) for (const item of open) console.log(`  - ${item.id} ${item.status ?? 'PENDING'} — ${item.title ?? item.rawRequest ?? item.type}`);
  const pendingWorks = new Set(plan.items.map((item) => item.workId));
  console.log(`Pending memory integrations: ${plan.items.length ? `${plan.items.length} update(s) from ${pendingWorks.size} work item(s) — ${plan.applicable.length} safe, ${plan.blocked.length} need reconciliation` : 'none'}`);
  if (verbose) {
    for (const item of plan.items) console.log(`  - ${item.workId} ${item.candidateId} [${item.action}${item.duplicateOf ? ` of ${item.duplicateOf}` : ''}] ${item.summary}${item.blockers.length ? ` — ${item.blockers.map((entry) => entry.message).join('; ')}` : ''}`);
  }
  console.log(`Integrity: ${integrity.errors.length ? `${integrity.errors.length} blocker(s) — yallaflow shared check` : 'ok'}`);
  if (plan.applicable.length && branch === policy.integrationBranch) console.log('Next: yallaflow shared integrate (then commit .yallaflow/)');
  console.log('Visibility: only work present in this checkout. YallaFlow does not see branches that are not fetched or merged here — Git is the transport, not a live server.');
}

// ---------------------------------------------------------------------------
// yallaflow shared check — provider-neutral CI gate. Read-only; exit code 1 on FAIL.

export async function sharedCheckCommand() {
  const root = await requireRoot();
  const config = await getConfig(root);
  const doctor = await collectDoctorReport(root);
  const integrity = await collectSharedIntegrity(root);
  const failures = doctor.checks.filter(([, ok]) => !ok).map(([name]) => name);
  const { plan } = integrity.enabled ? await planSharedIntegration(root) : { plan: { items: [], applicable: [], blocked: [] } };

  console.log(`YallaFlow shared check — ${config.project?.name ?? 'project'}`);
  console.log(`${describeCompatibility(integrity.compat ?? await checkProjectCompatibility(root))}`);
  if (!integrity.enabled) console.log('Mode: single-user (not a Shared Project) — workspace integrity only.');
  else console.log(`Integration branch: ${integrity.policy.integrationBranch} · checked commit: ${currentBranch(root) ?? 'detached HEAD'}`);

  const checks = [
    ['workspace integrity (doctor)', failures.length === 0, failures],
    ...(integrity.enabled ? [
      ['pending memory deltas integrate safely', integrity.blockers.length === 0, integrity.blockers.map((entry) => `${entry.workId} ${entry.candidateId}: ${entry.blockers.map((item) => item.message).join('; ')}`)]
    ] : [])
  ];
  for (const [name, ok, details] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
    for (const detail of ok ? [] : details) console.log(`  - ${detail}`);
  }
  if (integrity.enabled) console.log(`INFO pending memory integrations: ${plan.items.length} (${plan.applicable.length} safe) — integrated on ${integrity.policy.integrationBranch} with \`yallaflow shared integrate\``);
  for (const warning of doctor.warnings) console.log(`WARN ${warning}`);

  const failed = checks.some(([, ok]) => !ok);
  if (failed) {
    process.exitCode = 1;
    console.log('\nResult: FAIL');
    if (integrity.blockers.length) {
      console.log(`Shared project knowledge changed while this work was in progress. Update the branch with ${integrity.policy.integrationBranch}, then ask the coding agent to continue — it revalidates the affected knowledge (it never overwrites shared memory silently).`);
    }
    if (failures.length) console.log('Fix the failing integrity checks (run `yallaflow doctor` locally); YallaFlow does not auto-repair.');
  } else {
    console.log('\nResult: PASS');
  }
}

// ---------------------------------------------------------------------------
// yallaflow shared integrate — the one canonical memory integration boundary.

export async function sharedIntegrateCommand({ dryRun = false, verbose = false } = {}) {
  const root = await requireRoot();
  const result = await integrateSharedMemory(root, { dryRun });
  const { applicable, blocked } = result;
  if (!applicable.length && !blocked.length) {
    console.log('Shared project memory is up to date — no pending knowledge from merged work.');
    return;
  }
  if (dryRun) {
    console.log(`Preview — nothing written. On ${result.integrationBranch}, integration would apply ${applicable.length} update(s)${blocked.length ? ` and hold ${blocked.length} for reconciliation` : ''}:`);
    for (const item of applicable) console.log(`  - ${item.workId} ${item.candidateId} [${item.action}${item.duplicateOf ? ` of ${item.duplicateOf}` : ''}${item.relation ? ` ${item.relation.factId}` : ''}] ${item.summary}`);
  } else if (result.applied.length) {
    console.log(`Integrated ${result.applied.length} project-knowledge update(s) from merged work into shared project memory.`);
    if (verbose) for (const item of result.applied) console.log(`  - ${item.workId} ${item.candidateId} → ${item.factId} (${item.action})`);
    console.log('Nothing was committed. Commit .yallaflow/ to share the updated project memory.');
  }
  if (blocked.length) {
    console.log(`\n${blocked.length} update(s) need reconciliation and were not applied (shared memory is unchanged for them):`);
    for (const item of blocked) console.log(`  - ${item.workId} ${item.candidateId}: ${item.blockers.map((entry) => entry.message).join('; ')}`);
    console.log('The agent revalidates each against current project memory: reject the stale candidate (yallaflow knowledge reject <work> --candidate K-### --reason "...") and propose it again against the current fact, or record a question for a human decision.');
    process.exitCode = 1;
  }
}
