import path from 'node:path';
import { stat } from 'node:fs/promises';
import { exists } from '../utils/fs.js';
import { LAZY_WORKSPACE_DIRS, currentStatePath, findProjectRoot, getCurrentState, isSharedWorkspace, listWork, workspacePath } from '../core/workspace.js';
import { SUPPORTED_CONFIG_SCHEMAS } from '../shared/config.js';
import { collectSharedIntegrity } from '../shared/integrity.js';
import { readYaml } from '../core/yaml.js';
import { validateSkillRegistry } from '../skills/validation.js';
import { loadWorkProgress } from '../core/progress.js';
import { loadWorkKnowledge } from '../knowledge/store.js';
import { loadWorkQuestions } from '../questions/store.js';
import { listSources } from '../core/sources.js';
import { checkWorkIntegrity, checkWorkspaceIntegrity } from '../core/integrity.js';
import { checkContextIntegrity } from '../context/integrity.js';
import { describeAgentContractState, inspectAgentContract } from '../agent/contract.js';
import { describeBootstrapState, inspectAllBootstraps } from '../agent/bootstrap.js';
import { checkDeliveryIntegrity } from '../delivery/integrity.js';
import { checkQualityIntegrity } from '../quality/integrity.js';
import { checkWorkRecordOwnership } from '../core/ownership.js';
import { loadRuntimeProfiles } from '../runtime/profile.js';
import { listLineages, verifyLineage } from '../history/lineage.js';

import { clearStaleLock, readLock } from '../utils/lock.js';
import { diagnoseCollisions, duplicateFactIds } from '../core/collisions.js';

export async function doctorCommand({ clearLock = false } = {}) {
  const root = await findProjectRoot();
  if (!root) throw new Error('FAIL No .yallaflow workspace found.');
  if (clearLock) {
    const result = await clearStaleLock(root);
    console.log(`${result.cleared ? 'Cleared' : 'Not cleared'}: ${result.reason}.`);
    if (!result.cleared && result.reason !== 'no lock is held') process.exitCode = 1;
    return;
  }
  const { checks, warnings } = await collectDoctorReport(root, { verifyMedia: true });
  const lock = await readLock(root);
  if (lock) warnings.push(lock.unreadable
    ? 'workspace lock: .yallaflow/local/lock is unreadable; if no YallaFlow command is running, remove it with `yallaflow doctor --clear-lock`'
    : lock.stale
      ? `workspace lock: stale lock left by \`${lock.command}\` (pid ${lock.pid}, since ${lock.startedAt}); the next writer removes it, or run \`yallaflow doctor --clear-lock\``
      : `workspace lock: held by \`${lock.command}\` (pid ${lock.pid} on ${lock.host}, since ${lock.startedAt})`);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  for (const warning of warnings) console.log(`WARN ${warning}`);
  await printCollisionDiagnosis(root); // PF-0113: independent of the checks above
  if (failed.length) {
    process.exitCode = 1;
    console.log(`\n${failed.length} check(s) failed.`);
  } else {
    console.log('\nWorkspace healthy.');
    if (warnings.length) console.log(`${warnings.length} warning(s) — informational only, does not affect workspace health.`);
  }
}

// Names probable merge-related work-ID collisions behind the failures above (read-only).
async function printCollisionDiagnosis(root) {
  let found = [];
  let facts = [];
  try {
    found = await diagnoseCollisions(root, await listWork(root));
  } catch {
    found = []; // the checks above already describe what could not be read
  }
  try {
    facts = await duplicateFactIds(root);
  } catch {
    facts = [];
  }
  if (facts.length) {
    console.log(`\nDuplicate project-memory fact IDs (${facts.length}) — read-only diagnosis; nothing was changed:`);
    for (const entry of facts) console.log(`  ${entry.id} appears ${entry.count} times in .yallaflow/context/index.yaml`);
    console.log('  Likely cause: two branches each promoted knowledge with the same next fact number, and a Git merge kept both.');
    console.log('  Do not renumber or edit them by hand; a repair is a separate, reviewed step. Shared Project mode writes facts only on the integration branch.');
  }
  if (!found.length) return;
  console.log(`\nProbable work-ID collisions (${found.length}) — read-only diagnosis; nothing was changed:`);
  for (const entry of found) {
    console.log(`  ${entry.id}${entry.title ? ` — ${entry.title}` : ''}`);
    for (const signal of entry.signals) console.log(`    - ${signal}`);
    if (entry.added?.meta.length) console.log(`    meta.yaml added in: ${entry.added.meta.join(' | ')}`);
    if (entry.added?.progress.length) console.log(`    progress.yaml added in: ${entry.added.progress.join(' | ')}`);
    if (entry.added?.requirements.length) console.log(`    requirements.yaml added in: ${entry.added.requirements.join(' | ')}`);
  }
  console.log('  Likely cause: two branches created the same plain work or source ID, and a Git merge combined two different items in one folder.');
  console.log('  Keep these records exactly as they are and do not edit them by hand; a repair is a separate, reviewed step.');
  console.log('  New collisions are prevented by branch-safe IDs (Shared Project mode, docs/shared-projects.md).');
}

// The complete read-only integrity report — shared by `doctor` (which prints it) and
// the `upgrade status|plan` / `brief` assessments (which aggregate it), so there is
// exactly one interpretation of workspace health.
// verifyMedia (v1.1.0): hash stored QC/demo media against the ledgers. Only `doctor`
// itself asks for it; brief, upgrade, shared and finish run this report on every
// session or completion and stay lightweight (no reading of videos).
export async function collectDoctorReport(root, { verifyMedia = false } = {}) {
  const base = workspacePath(root);
  const checks = [];
  // A Shared Project keeps active-work focus in the gitignored local/ directory; a
  // fresh clone legitimately has none yet.
  const shared = await isSharedWorkspace(root);
  for (const relative of [
    'config.yaml', 'PROJECT.md', 'AGENT.md', ...(shared ? [] : ['state/current.yaml']),
    'context/architecture.md', 'context/tech-stack.md', 'context/database.md',
    'context/integrations.md', 'context/environments.md', 'context/conventions.md', 'context/business-rules.md'
  ]) checks.push([relative, await exists(path.join(base, relative))]);
  // Lazy directories (v0.3.9): absent is valid — nothing recorded yet, or a fresh Git
  // clone of a workspace whose directories were empty. Present, it must be a directory;
  // absent work/ is a failure only when durable state names active work.
  let activeWork = null;
  try {
    activeWork = (await getCurrentState(root)).activeWork ?? null;
  } catch {
    activeWork = null; // reported by schema parsing below
  }
  for (const dir of LAZY_WORKSPACE_DIRS) {
    const info = await stat(path.join(base, dir)).catch(() => null);
    if (info) checks.push([dir, info.isDirectory()]);
    else if (dir === 'work' && activeWork) checks.push([`work (missing, but ${path.relative(base, await currentStatePath(root))} names active work ${activeWork})`, false]);
    else checks.push([`${dir} (absent — created when first needed)`, true]);
  }

  let parseOk = true;
  try {
    const config = await readYaml(path.join(base, 'config.yaml'));
    const state = await getCurrentState(root);
    parseOk = SUPPORTED_CONFIG_SCHEMAS.includes(config.schemaVersion) && state.schemaVersion === 1;
  } catch {
    parseOk = false;
  }

  try {
    const work = await listWork(root);
    let ledgerCount = 0;
    for (const item of work) {
      const questions = await loadWorkQuestions(root, item);
      if (questions.exists) ledgerCount += 1;
    }
    checks.push([`work question ledgers (${ledgerCount} present)`, true]);
  } catch (error) {
    checks.push([`work question ledgers: ${error instanceof Error ? error.message : String(error)}`, false]);
  }
  checks.push(['schema parsing', parseOk]);

  try {
    const sources = await listSources(root);
    checks.push([`sources (${sources.length} present)`, true]);
  } catch (error) {
    checks.push([`sources: ${error instanceof Error ? error.message : String(error)}`, false]);
  }

  // 1.4.0: preserved lineages (PF-0052): every file matches its recorded hash, nothing
  // extra was added, and recorded mappings point to existing canonical records.
  try {
    for (const lineage of await listLineages(root)) {
      if (lineage.invalid) { checks.push([`lineage ${lineage.label}: manifest unreadable`, false]); continue; }
      const result = await verifyLineage(root, lineage.label);
      checks.push([`lineage ${lineage.label} (${result.files} preserved file(s), ${result.mappings} mapping(s))`, true]);
    }
  } catch (error) {
    checks.push([`lineage: ${error instanceof Error ? error.message : String(error)}`, false]);
  }

  // 1.4.0: the runtime profile, only when one exists (validation never runs anything).
  try {
    const profiles = await loadRuntimeProfiles(root);
    if (profiles.exists) checks.push([`runtime profile (${profiles.services.length} service(s))`, true]);
  } catch (error) {
    checks.push([`runtime profile: ${error instanceof Error ? error.message : String(error)}`, false]);
  }

  try {
    const registry = await validateSkillRegistry();
    checks.push([`built-in skill registry v${registry.registryVersion} (${registry.skillCount} skills)`, true]);
  } catch (error) {
    checks.push([`built-in skill registry: ${error instanceof Error ? error.message : String(error)}`, false]);
  }

  try {
    const work = await listWork(root);
    let ledgerCount = 0;
    for (const item of work) {
      const progress = await loadWorkProgress(root, item);
      if (progress.exists) ledgerCount += 1;
    }
    checks.push([`work progress ledgers (${ledgerCount} present)`, true]);
  } catch (error) {
    checks.push([`work progress ledgers: ${error instanceof Error ? error.message : String(error)}`, false]);
  }

  try {
    const work = await listWork(root);
    let ledgerCount = 0;
    for (const item of work) {
      const knowledge = await loadWorkKnowledge(root, item);
      if (knowledge.exists) ledgerCount += 1;
    }
    checks.push([`work knowledge ledgers (${ledgerCount} present)`, true]);
  } catch (error) {
    checks.push([`work knowledge ledgers: ${error instanceof Error ? error.message : String(error)}`, false]);
  }

  try {
    const work = await listWork(root);
    const issues = [];
    for (const item of work) issues.push(...(await checkWorkIntegrity(root, item)));
    if (issues.length) issues.forEach((issue) => checks.push([issue, false]));
    else checks.push([`lifecycle integrity (${work.length} work item(s) checked)`, true]);
  } catch (error) {
    checks.push([`lifecycle integrity: ${error instanceof Error ? error.message : String(error)}`, false]);
  }

  // Work-delivery state (v0.3.8): requirement identity, convergence, and impact.
  // Contradictions fail; evidence drift after convergence is a warning.
  const deliveryWarnings = [];
  try {
    const work = await listWork(root);
    let failed = false;
    for (const item of work) {
      const result = await checkDeliveryIntegrity(root, item);
      for (const error of result.errors) checks.push([error, false]);
      failed ||= result.errors.length > 0;
      deliveryWarnings.push(...result.warnings);
    }
    if (!failed) checks.push([`delivery integrity (${work.length} work item(s) checked)`, true]);
  } catch (error) {
    checks.push([`delivery integrity: ${error instanceof Error ? error.message : String(error)}`, false]);
  }

  // Optional quality ledgers (v1.1.0): reported only for work that used QC or a demo.
  // An invalid ledger fails; overwritten media and merge-duplicated IDs are warnings.
  const qualityWarnings = [];
  try {
    for (const item of await listWork(root)) {
      const quality = await checkQualityIntegrity(root, item, { verifyMedia });
      for (const error of quality.errors) checks.push([error, false]);
      qualityWarnings.push(...quality.warnings);
    }
  } catch (error) {
    checks.push([`quality ledgers: ${error instanceof Error ? error.message : String(error)}`, false]);
  }

  // State ownership (v0.3.7): CLI-appended work.md lifecycle records must still match
  // the structured state they were written from. Informational — work.md is shared.
  const warnings = [];
  warnings.push(...deliveryWarnings);
  warnings.push(...qualityWarnings);
  // 1.4.0: hold and close clear the active focus; an active held or closed item means the
  // state was changed by hand or by an older tool.
  try {
    const activeId = (await getCurrentState(root)).activeWork;
    const active = activeId ? (await listWork(root)).find((item) => item.id === activeId) : null;
    if (active?.lifecycle) warnings.push(`${active.id} is the active work item but is ${active.lifecycle.state === 'closed' ? 'closed' : 'on hold'}; activate other work or ${active.lifecycle.state === 'closed' ? 'reopen' : 'resume'} it.`);
  } catch {
    // reported by the state checks above
  }
  try {
    for (const item of await listWork(root)) warnings.push(...(await checkWorkRecordOwnership(root, item)));
  } catch (error) {
    warnings.push(`work record ownership: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Project memory: structural ledger/lineage/projection problems fail; freshness and
  // unreconciled legacy context are warnings only.
  try {
    const context = await checkContextIntegrity(root);
    if (context.errors.length) context.errors.forEach((issue) => checks.push([issue, false]));
    else checks.push([context.hasLedger ? `project context ledger (${context.factCount} fact(s))` : 'project context ledger (not yet created)', true]);
    warnings.push(...context.warnings);
  } catch (error) {
    checks.push([`project context ledger: ${error instanceof Error ? error.message : String(error)}`, false]);
  }

  // Shared Project integrity (v0.3.10): version compatibility, branch-safe identity,
  // local-vs-shared state placement, memory bases, staged deltas, and integration
  // provenance fail; pending deltas that need reconciliation are warnings here (they
  // fail `yallaflow shared check`, the CI gate).
  try {
    const sharedReport = await collectSharedIntegrity(root);
    for (const error of sharedReport.errors) checks.push([error, false]);
    if (sharedReport.enabled && !sharedReport.errors.length) checks.push([`shared project integrity (integration branch ${sharedReport.policy.integrationBranch})`, true]);
    warnings.push(...sharedReport.warnings);
    for (const blocked of sharedReport.blockers) warnings.push(`pending memory delta ${blocked.workId} ${blocked.candidateId} needs reconciliation: ${blocked.blockers.map((entry) => entry.message).join('; ')}`);
  } catch (error) {
    checks.push([`shared project integrity: ${error instanceof Error ? error.message : String(error)}`, false]);
  }

  // Agent guidance that predates the installed package contract is a warning — doctor
  // never rewrites AGENT.md (see `yallaflow agent refresh`).
  try {
    const agent = await inspectAgentContract(root);
    if (!['current', 'missing'].includes(agent.state)) warnings.push(`AGENT.md agent contract: ${describeAgentContractState(agent)}`);
  } catch (error) {
    warnings.push(`AGENT.md agent contract: ${error instanceof Error ? error.message : String(error)}`);
  }
  // Provider bootstrap blocks are project files; a stale or edited block is a
  // warning, and a provider that was never set up is not reported at all.
  try {
    for (const bootstrap of await inspectAllBootstraps(root)) {
      if (!['current', 'not-installed', 'shared'].includes(bootstrap.state)) warnings.push(`${bootstrap.file} agent bootstrap: ${describeBootstrapState(bootstrap)}`);
    }
  } catch (error) {
    warnings.push(`agent bootstrap: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Informational only: YallaFlow does not mandate a Git/team workflow, so an
  // untracked-and-ungitignored workspace is a warning, never a structural-integrity
  // failure — it must never make an otherwise healthy workspace report unhealthy.
  try {
    warnings.push(...checkWorkspaceIntegrity(root));
  } catch (error) {
    warnings.push(`workspace/Git tracking: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { checks, warnings };
}
