import path from 'node:path';
import { stat } from 'node:fs/promises';
import { exists } from '../utils/fs.js';
import { LAZY_WORKSPACE_DIRS, findProjectRoot, listWork, workspacePath } from '../core/workspace.js';
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
import { checkWorkRecordOwnership } from '../core/ownership.js';

export async function doctorCommand() {
  const root = await findProjectRoot();
  if (!root) throw new Error('FAIL No .yallaflow workspace found.');
  const { checks, warnings } = await collectDoctorReport(root);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  for (const warning of warnings) console.log(`WARN ${warning}`);
  if (failed.length) {
    process.exitCode = 1;
    console.log(`\n${failed.length} check(s) failed.`);
  } else {
    console.log('\nWorkspace healthy.');
    if (warnings.length) console.log(`${warnings.length} warning(s) — informational only, does not affect workspace health.`);
  }
}

// The complete read-only integrity report — shared by `doctor` (which prints it) and
// the `upgrade status|plan` / `brief` assessments (which aggregate it), so there is
// exactly one interpretation of workspace health.
export async function collectDoctorReport(root) {
  const base = workspacePath(root);
  const checks = [];
  for (const relative of [
    'config.yaml', 'PROJECT.md', 'AGENT.md', 'state/current.yaml',
    'context/architecture.md', 'context/tech-stack.md', 'context/database.md',
    'context/integrations.md', 'context/environments.md', 'context/conventions.md', 'context/business-rules.md'
  ]) checks.push([relative, await exists(path.join(base, relative))]);
  // Lazy directories (v0.3.9): absent is valid — nothing recorded yet, or a fresh Git
  // clone of a workspace whose directories were empty. Present, it must be a directory;
  // absent work/ is a failure only when durable state names active work.
  let activeWork = null;
  try {
    activeWork = (await readYaml(path.join(base, 'state/current.yaml'))).activeWork ?? null;
  } catch {
    activeWork = null; // reported by schema parsing below
  }
  for (const dir of LAZY_WORKSPACE_DIRS) {
    const info = await stat(path.join(base, dir)).catch(() => null);
    if (info) checks.push([dir, info.isDirectory()]);
    else if (dir === 'work' && activeWork) checks.push([`work (missing, but state/current.yaml names active work ${activeWork})`, false]);
    else checks.push([`${dir} (absent — created when first needed)`, true]);
  }

  let parseOk = true;
  try {
    const config = await readYaml(path.join(base, 'config.yaml'));
    const state = await readYaml(path.join(base, 'state/current.yaml'));
    parseOk = config.schemaVersion === 1 && state.schemaVersion === 1;
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

  // State ownership (v0.3.7): CLI-appended work.md lifecycle records must still match
  // the structured state they were written from. Informational — work.md is shared.
  const warnings = [];
  warnings.push(...deliveryWarnings);
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
