#!/usr/bin/env node
import { parseArgs } from 'node:util';
// Commands load on first use (PF-0062): a call pays only for the command it runs, not for
// all ~40 command modules (about 200 ms on every invocation before this change).
const lazy = (specifier, name) => async (...args) => (await import(specifier))[name](...args);
const initCommand = lazy('./commands/init.js', 'initCommand');
const activateCommand = lazy('./commands/start.js', 'activateCommand');
const startCommand = lazy('./commands/start.js', 'startCommand');
const agentsCommand = lazy('./commands/agents.js', 'agentsCommand');
const statusCommand = lazy('./commands/status.js', 'statusCommand');
const resumeCommand = lazy('./commands/resume.js', 'resumeCommand');
const doctorCommand = lazy('./commands/doctor.js', 'doctorCommand');
const newWorkCommand = lazy('./commands/work.js', 'newWorkCommand');
const snapshotCommand = lazy('./commands/snapshot.js', 'snapshotCommand');
const workShowCommand = lazy('./commands/snapshot.js', 'workShowCommand');
const overviewCommand = lazy('./commands/overview.js', 'overviewCommand');
import { RUNTIME_USAGE } from './commands/runtime-usage.js';
const runtimeCommand = lazy('./commands/runtime.js', 'runtimeCommand');
import { NEW_USAGE } from './commands/new-usage.js';
const newCommand = lazy('./commands/new.js', 'newCommand');
import { HISTORY_USAGE } from './commands/history-usage.js';
const historyCommand = lazy('./commands/history.js', 'historyCommand');
import { withWorkspaceLock } from './utils/lock.js';
const consoleCommand = lazy('./commands/console.js', 'consoleCommand');
const consoleProjectsCommand = lazy('./commands/console.js', 'consoleProjectsCommand');
const advanceCommand = lazy('./commands/advance.js', 'advanceCommand');
const verifyCommand = lazy('./commands/verify.js', 'verifyCommand');
const verifyListCommand = lazy('./commands/verify.js', 'verifyListCommand');
const verifyScriptCommand = lazy('./commands/verify.js', 'verifyScriptCommand');
const verifyShellCommand = lazy('./commands/verify.js', 'verifyShellCommand');
const routeCommand = lazy('./commands/route.js', 'routeCommand');
const guideCommand = lazy('./commands/guide.js', 'guideCommand');
const skillCommand = lazy('./commands/skill.js', 'skillCommand');
const checkpointCommand = lazy('./commands/checkpoint.js', 'checkpointCommand');
const reviseCheckpointCommand = lazy('./commands/checkpoint.js', 'reviseCheckpointCommand');
const knowledgeCommand = lazy('./commands/knowledge.js', 'knowledgeCommand');
const questionCommand = lazy('./commands/question.js', 'questionCommand');
const readyCommand = lazy('./commands/ready.js', 'readyCommand');
const intakeAddCommand = lazy('./commands/intake.js', 'intakeAddCommand');
const intakeCommand = lazy('./commands/intake.js', 'intakeCommand');
const intakeTicketCommand = lazy('./commands/intake.js', 'intakeTicketCommand');
const sourceCommand = lazy('./commands/source.js', 'sourceCommand');
const reopenCommand = lazy('./commands/reopen.js', 'reopenCommand');
const decomposeExecuteCommand = lazy('./commands/decompose.js', 'decomposeExecuteCommand');
const decomposeProposeCommand = lazy('./commands/decompose.js', 'decomposeProposeCommand');
const decomposeStatusCommand = lazy('./commands/decompose.js', 'decomposeStatusCommand');
const decomposeValidateCommand = lazy('./commands/decompose.js', 'decomposeValidateCommand');
const projectProgressCommand = lazy('./commands/progress.js', 'projectProgressCommand');
const nextCommand = lazy('./commands/next.js', 'nextCommand');
const approveCommand = lazy('./commands/review.js', 'approveCommand');
const feedbackCommand = lazy('./commands/review.js', 'feedbackCommand');
const handoffCommand = lazy('./commands/handoff.js', 'handoffCommand');
const requestReviseCommand = lazy('./commands/request.js', 'requestReviseCommand');
const contextAdoptCommand = lazy('./commands/context.js', 'contextAdoptCommand');
const contextAffectedCommand = lazy('./commands/context.js', 'contextAffectedCommand');
const contextHistoryCommand = lazy('./commands/context.js', 'contextHistoryCommand');
const contextListCommand = lazy('./commands/context.js', 'contextListCommand');
const contextRenderCommand = lazy('./commands/context.js', 'contextRenderCommand');
const contextShowCommand = lazy('./commands/context.js', 'contextShowCommand');
const contextStatusCommand = lazy('./commands/context.js', 'contextStatusCommand');
const limitationCommand = lazy('./commands/limitation.js', 'limitationCommand');
const reconcileApplyCommand = lazy('./commands/reconcile.js', 'reconcileApplyCommand');
const reconcileApproveCommand = lazy('./commands/reconcile.js', 'reconcileApproveCommand');
const reconcileFeedbackCommand = lazy('./commands/reconcile.js', 'reconcileFeedbackCommand');
const reconcilePlanCommand = lazy('./commands/reconcile.js', 'reconcilePlanCommand');
const reconcilePreviewCommand = lazy('./commands/reconcile.js', 'reconcilePreviewCommand');
const reconcileShowCommand = lazy('./commands/reconcile.js', 'reconcileShowCommand');
const reconcileStartCommand = lazy('./commands/reconcile.js', 'reconcileStartCommand');
const reconcileStatusCommand = lazy('./commands/reconcile.js', 'reconcileStatusCommand');
const upgradePlanCommand = lazy('./commands/upgrade.js', 'upgradePlanCommand');
const upgradeStatusCommand = lazy('./commands/upgrade.js', 'upgradeStatusCommand');
const briefCommand = lazy('./commands/brief.js', 'briefCommand');
const inspectCommand = lazy('./commands/inspect.js', 'inspectCommand');
import { PACKAGE_VERSION } from './version.js';
const agentRefreshCommand = lazy('./commands/agent.js', 'agentRefreshCommand');
const agentSetupCommand = lazy('./commands/agent.js', 'agentSetupCommand');
const agentStatusCommand = lazy('./commands/agent.js', 'agentStatusCommand');
const convergenceRecordCommand = lazy('./commands/delivery.js', 'convergenceRecordCommand');
const convergenceShowCommand = lazy('./commands/delivery.js', 'convergenceShowCommand');
const convergenceStatusCommand = lazy('./commands/delivery.js', 'convergenceStatusCommand');
const impactAssessCommand = lazy('./commands/delivery.js', 'impactAssessCommand');
const impactStatusCommand = lazy('./commands/delivery.js', 'impactStatusCommand');
const requirementListCommand = lazy('./commands/delivery.js', 'requirementListCommand');
const requirementRecordCommand = lazy('./commands/delivery.js', 'requirementRecordCommand');
const requirementShowCommand = lazy('./commands/delivery.js', 'requirementShowCommand');
const baselineApproveCommand = lazy('./commands/baseline.js', 'baselineApproveCommand');
const baselineDraftCommand = lazy('./commands/baseline.js', 'baselineDraftCommand');
const baselineFeedbackCommand = lazy('./commands/baseline.js', 'baselineFeedbackCommand');
const baselineShowCommand = lazy('./commands/baseline.js', 'baselineShowCommand');
const baselineStartCommand = lazy('./commands/baseline.js', 'baselineStartCommand');
const baselineStatusCommand = lazy('./commands/baseline.js', 'baselineStatusCommand');
const sharedCheckCommand = lazy('./commands/shared.js', 'sharedCheckCommand');
const sharedEnableCommand = lazy('./commands/shared.js', 'sharedEnableCommand');
const sharedIntegrateCommand = lazy('./commands/shared.js', 'sharedIntegrateCommand');
const sharedStatusCommand = lazy('./commands/shared.js', 'sharedStatusCommand');
const finishCommand = lazy('./commands/finish.js', 'finishCommand');
const demoApproveCommand = lazy('./commands/quality.js', 'demoApproveCommand');
const demoProposeCommand = lazy('./commands/quality.js', 'demoProposeCommand');
const demoRecordCommand = lazy('./commands/quality.js', 'demoRecordCommand');
const demoStatusCommand = lazy('./commands/quality.js', 'demoStatusCommand');
const qcPlanCommand = lazy('./commands/quality.js', 'qcPlanCommand');
const qcRecordCommand = lazy('./commands/quality.js', 'qcRecordCommand');
const qcStatusCommand = lazy('./commands/quality.js', 'qcStatusCommand');
const purposeCommand = lazy('./commands/purpose.js', 'purposeCommand');
const integrationCommand = lazy('./commands/integration.js', 'integrationCommand');
const executionChecksCommand = lazy('./commands/integration.js', 'executionChecksCommand');
import { findProjectRoot, getCurrentState, loadWorkMetaOrThrow } from './core/workspace.js';
import { assertWorkProgressAllowed, lifecycleOf } from './core/lifecycle.js';
const reopenClosedCommand = lazy('./commands/lifecycle.js', 'reopenClosedCommand');
const workLifecycleCommand = lazy('./commands/lifecycle.js', 'workLifecycleCommand');
import { checkProjectCompatibility, incompatibleMessage } from './shared/config.js';
import { SCOPES } from './behavior/constants.js';
import { INTERACTION_MODES, GATE_NAMES } from './behavior/interaction.js';

const WORK_LIFECYCLE_USAGE = 'yallaflow work show <work-id> [--json]\n  yallaflow work hold <work-id> --reason TEXT [--accept-minimum-version 1.4.0]\n  yallaflow work resume <work-id> [--note TEXT]\n  yallaflow work close <work-id> --outcome cancelled|superseded|duplicate --reason TEXT [--by <work-id>] [--accept-minimum-version 1.4.0]';

const VALID_PROJECT_TYPES = new Set(['greenfield', 'brownfield']);

function help() {
  console.log(`YallaFlow foundation CLI\n\nGive AI your project, not just your prompt.\n\nUsage:\n  yallaflow init [--name NAME] [--type greenfield|brownfield] [--mode autonomous|adaptive|gated]\n  yallaflow start [request]\n  yallaflow start --keep-active -- <request>\n  yallaflow activate <work-id>\n  yallaflow request --help\n  yallaflow intake <file> [<file> ...] [--title TITLE]\n  yallaflow intake add <work-id> <file> [<file> ...] [--reason TEXT] [--before-start]\n  yallaflow intake ticket <payload-file|ticket-ref> [--provider github|jira|azure-devops] [--work <work-id>] [--reason TEXT] [--fetch [--attachments]] [--attachment <file>]... [--title TITLE] [--max-comments N]\n  yallaflow source --help\n  yallaflow route <work-id> --type TYPE --scope SCOPE --confidence LEVEL --reason REASON [--title TITLE]\n  yallaflow baseline --help\n  yallaflow guide [work-id]\n  yallaflow ready [work-id]\n  yallaflow skill <skill-id> [--work <work-id>]\n  yallaflow checkpoint --help\n  yallaflow question --help\n  yallaflow knowledge --help\n  yallaflow requirement --help\n  yallaflow convergence --help\n  yallaflow impact --help\n  yallaflow context --help\n  yallaflow upgrade status|plan\n  yallaflow brief\n  yallaflow inspect\n  yallaflow limitation --help\n  yallaflow agent --help\n  yallaflow decompose --help\n  yallaflow progress <parent-id>\n  yallaflow next <parent-id>\n  yallaflow approve <work-id> --stage GATE [--note TEXT]\n  yallaflow feedback <work-id> --stage GATE --changes-requested [--note TEXT]\n  yallaflow handoff [work-id]\n  yallaflow feature <title> --scope SCOPE\n  yallaflow bug <title> --scope SCOPE\n  yallaflow investigate <title> --scope SCOPE\n  yallaflow change <title> --scope SCOPE\n  yallaflow refactor <title> --scope SCOPE\n  yallaflow release <title> --scope SCOPE\n  yallaflow purpose --help\n  yallaflow finish [work-id] [--verbose]\n  yallaflow qc --help\n  yallaflow demo --help\n  yallaflow shared --help\n  yallaflow status\n  yallaflow snapshot [--json]\n  yallaflow overview [--json]\n  yallaflow runtime --help\n  yallaflow new --help\n  yallaflow history --help\n  yallaflow console [--port N] [--no-open] [--project DIR]... [--read-only] [--agents]\n  yallaflow agents detect\n  yallaflow work show <work-id> [--json]\n  yallaflow work hold|resume|close <work-id> ...  (lifecycle: on hold, closed without delivery)\n  yallaflow resume [work-id]\n  yallaflow doctor [--clear-lock]\n  yallaflow advance [work-id]\n  yallaflow verify [work-id] -- <executable> [args...]\n  yallaflow verify [work-id] --shell "<command>"\n  yallaflow verify [work-id] --script <path>\n  yallaflow verify list [work-id]\n  yallaflow reopen <work-id> --to implementation|verification|review --reason REASON\n  yallaflow reopen <work-id> --reason REASON   (closed work)\n  yallaflow --version\n`);
}

function decomposeHelp() {
  console.log(`Usage:\n  yallaflow decompose propose <parent-id> --file <decomposition.json>\n  yallaflow decompose validate <parent-id>\n  yallaflow decompose execute <parent-id>\n  yallaflow decompose status <parent-id>\n\nGate names (for approve/feedback): ${GATE_NAMES.join(', ')}\n`);
}

function baselineHelp() {
  console.log(`Usage:\n  yallaflow baseline start [--objective TEXT] [--preserve TEXT]... [--focus TEXT]...\n  yallaflow baseline draft <work-id> --file <baseline.json>\n  yallaflow baseline status [work-id]\n  yallaflow baseline show [work-id]\n  yallaflow baseline approve <work-id> [--note TEXT]\n  yallaflow baseline feedback <work-id> --changes-requested [--note TEXT]\n`);
}

const RECONCILE_USAGE = 'yallaflow context reconcile start\n  yallaflow context reconcile status [work-id]\n  yallaflow context reconcile show [work-id] [--candidate RC-####]\n  yallaflow context reconcile plan [work-id] --file <decisions.json>\n  yallaflow context reconcile preview [work-id]\n  yallaflow context reconcile approve [work-id] [--note TEXT]\n  yallaflow context reconcile feedback [work-id] --changes-requested [--note TEXT]\n  yallaflow context reconcile apply [work-id]';
const CONTEXT_USAGE = `yallaflow context status\n  yallaflow context list [--area AREA] [--all]\n  yallaflow context show <CTX-id>\n  yallaflow context history <CTX-id>\n  yallaflow context affected [--since REF] [path ...]\n  yallaflow context adopt [--dry-run]\n  yallaflow context render\n  ${RECONCILE_USAGE}`;
const SHARED_USAGE = 'yallaflow shared enable [--integration-branch BRANCH] [--dry-run]\n  yallaflow shared status [--verbose]\n  yallaflow shared check\n  yallaflow shared integrate [--dry-run] [--verbose]';
const PURPOSE_USAGE = 'yallaflow purpose set [work-id] --objective TEXT [--mode bootstrap|intent|freshness] [--preserve TEXT]... [--focus TEXT]...\n  yallaflow purpose show [work-id]';
const UPGRADE_USAGE = 'yallaflow upgrade status\n  yallaflow upgrade plan';
const AGENT_USAGE = 'yallaflow agent status\n  yallaflow agent refresh [--preserve-existing] [--dry-run]\n  yallaflow agent setup <codex|claude> [--preserve-existing] [--dry-run]';
const REQUIREMENT_USAGE = 'yallaflow requirement record <work-id> --file <requirements.json>\n  yallaflow requirement list <work-id>\n  yallaflow requirement show <work-id> <REQ-###|AC-###>';
const CONVERGENCE_USAGE = 'yallaflow convergence record <work-id> --file <convergence.json>\n  yallaflow convergence status <work-id>\n  yallaflow convergence show <work-id> [CV-###|AC-###|UR-###]';
const IMPACT_USAGE = 'yallaflow impact status <work-id>\n  yallaflow impact assess <work-id> --file <impact.json>';
const QC_USAGE = 'yallaflow qc plan <work-id> --file <plan.json>\n  yallaflow qc record <work-id> --file <result.json> [--allow-remote]\n  yallaflow qc status <work-id>';
const DEMO_USAGE = 'yallaflow demo propose <work-id> --file <scope.json>\n  yallaflow demo approve <work-id> --note TEXT [--only D-01,D-02]\n  yallaflow demo record <work-id> --file <result.json> [--allow-remote]\n  yallaflow demo status <work-id>';
const LIMITATION_USAGE = 'yallaflow limitation add [work-id] --type TYPE --area AREA --summary TEXT --reason TEXT\n  yallaflow limitation list [work-id]';

function contextHelp() {
  console.log(`Usage:\n  ${CONTEXT_USAGE}\n\nProject memory lives in .yallaflow/context/index.yaml; context/*.md is its projection.\nEvolve facts through work: yallaflow knowledge propose ... --supersedes|--reconfirms|--disputes CTX-####\nLegacy v0.3.5 context becomes current truth only through a reviewed reconciliation: yallaflow context reconcile start\n`);
}

function sharedHelp() {
  console.log(`Usage:\n  ${SHARED_USAGE}\n\nShared Project Mode: Git-native shared project intelligence. Developers work with Git; agents work with YallaFlow.\nA maintainer enables it once (explicit; never commits). Teammates need no join command — only a compatible YallaFlow.\nCanonical project memory is written only on the integration branch; feature work stages its reviewed knowledge with the work item.\n\`shared check\` is the provider-neutral, read-only CI gate (exit code 1 on failure; no network, no LLM).\n`);
}

function purposeHelp() {
  console.log(`Usage:\n  ${PURPOSE_USAGE}\n\nWhat the understanding is FOR (a discovery lens) and what must be preserved. Work intent only — stored in work/<id>/purpose.yaml, never promoted into project memory.\n`);
}

function upgradeHelp() {
  console.log(`Usage:\n  ${UPGRADE_USAGE}\n\nRead-only upgrade assessment: aggregates doctor, agent-contract, project-memory, and reconciliation state. Never migrates or repairs anything.\n`);
}

function agentHelp() {
  console.log(`Usage:\n  ${AGENT_USAGE}\n\nAGENT.md is project-owned; YallaFlow manages only its marked agent-contract block and never rewrites it automatically.\n\`agent setup\` adds a thin, versioned bootstrap block to the provider's repository-root session file (codex → AGENTS.md, claude → CLAUDE.md) that points to .yallaflow/AGENT.md; content outside the block is never changed. \`agent refresh\` also updates installed, unmodified bootstrap blocks.\n`);
}

function requirementHelp() {
  console.log(`Usage:\n  ${REQUIREMENT_USAGE}\n\nStable requirement (REQ-###) and acceptance-criterion (AC-###) identity for work whose Behavior Contract includes delivery-convergence.\nThe Agent extracts them from the approved intent; YallaFlow validates and records them in work/<id>/requirements.yaml. The approved specification stays authoritative.\nChanging them after the intent checkpoint is completed raises a pending impact assessment.\n`);
}

function convergenceHelp() {
  console.log(`Usage:\n  ${CONVERGENCE_USAGE}\n\nConvergence answers: does the delivered implementation match the approved intent? (verification: do the checks pass? review: is it technically acceptable?)\nThe Agent records one finding per acceptance criterion — satisfied, partial, missing, or contradicts — with a reason and evidence, plus unrequested behavior (UR-###: open, accepted, removed).\nAssessments are append-only; stale findings are reported, never rewritten. DONE requires every active criterion to be currently satisfied.\n`);
}

function impactHelp() {
  console.log(`Usage:\n  ${IMPACT_USAGE}\n\nA source attached, or requirements changed, after the approved intent was fixed raises a pending impact.\nThe Agent assesses each completed stage as affected or unaffected (with reasons); YallaFlow revises the affected checkpoints through the audited revision path. No evidence is deleted.\n`);
}

function qcHelp() {
  console.log(`Usage:\n  ${QC_USAGE}\n\nOptional AI QC (on request only): the Agent plans scenarios from acceptance criteria, runs them with Playwright (CLI or MCP), and records what actually happened.\nNothing here starts a browser, a server, or a test. Results live in work/<id>/quality/ — separate from verification evidence — with local, hashed artifacts and a Markdown + HTML report.\nPolicies: advisory (default; failures are reported, never block) or strict (opt-in; required scenarios must pass for quality approval, which is separate from task completion).\nInstructions: yallaflow skill ai-qc --work <work-id>\n`);
}

function demoHelp() {
  console.log(`Usage:\n  ${DEMO_USAGE}\n\nOptional Smart Demo (on request only; independent of QC): the Agent proposes the few user-facing scenarios worth showing, prioritized, per audience (business or developer).\nThe developer approves the scope first — recording against an unapproved proposal is refused. Video is optional (Playwright: video-start / video-chapter / video-stop).\nMedia stays local with hashes; report.md and report.html link the recordings. A demo is not test evidence and cannot be cited as acceptance evidence.\nInstructions: yallaflow skill smart-demo --work <work-id>\n`);
}

function limitationHelp() {
  console.log(`Usage:\n  ${LIMITATION_USAGE}\n\nTypes: not-inspected, unavailable, out-of-scope, runtime-unavailable, insufficient-evidence, uncaptured-artifact\nLimitations are work-scoped and never promoted into project context.\n`);
}

function sourceHelp() {
  console.log(`Usage:\n  yallaflow source list\n  yallaflow source show <source-id> [--content]\n`);
}

function checkpointHelp() {
  console.log(`Usage:\n  yallaflow checkpoint [work-id] --skill SKILL --status STATUS [--summary TEXT] [--evidence REF]\n  yallaflow checkpoint [work-id] --skill SKILL --start\n  yallaflow checkpoint [work-id] --skill SKILL --complete --summary TEXT [--evidence REF]\n  yallaflow checkpoint revise [work-id] --skill SKILL --status STATUS --reason TEXT [--summary TEXT]\n  yallaflow checkpoint [work-id] --ruling DECISION --ruling-reason WHY --cost-if-wrong IMPACT\n`);
}

function knowledgeHelp() {
  console.log(`Usage:\n  yallaflow knowledge propose [work-id] --kind KIND --source design-spec|implementation-runtime --summary TEXT --evidence REF\n      [--supersedes CTX-#### | --reconfirms CTX-#### | --disputes CTX-####]\n      [--confidence confirmed|inferred|unresolved] [--provenance repository|runtime|user-confirmed]\n  yallaflow knowledge list [work-id]\n  yallaflow knowledge promote [work-id] --candidate ID\n  yallaflow knowledge reject [work-id] --candidate ID --reason TEXT\n  yallaflow knowledge review [work-id] --none\n`);
}

function questionHelp() {
  console.log(`Usage:\n  yallaflow question add [work-id] --category business|architecture --text TEXT [--proposal TEXT] [--non-material]\n  yallaflow question list [work-id]\n  yallaflow question answer [work-id] --id Q-001 --answer TEXT\n  yallaflow question resolve [work-id] --id Q-001 [--resolution TEXT]\n`);
}

function parseOptions(args, allowed) {
  return parseArgs({ args, options: allowed, allowPositionals: true, strict: true });
}

// Every command's usage line, used both for `<command> --help`/`-h` and for the
// "Unknown command" fallback below — one source of truth, and a guarantee that
// asking for help can never reach a mutating command handler (GAP-CLI-001).
const USAGE = {
  init: 'yallaflow init [--name NAME] [--type greenfield|brownfield] [--mode autonomous|adaptive|gated]',
  start: 'yallaflow start [request]\n  yallaflow start --keep-active -- <request>',
  activate: 'yallaflow activate <work-id>',
  intake: 'yallaflow intake <file> [<file> ...] [--title TITLE]\n  yallaflow intake add <work-id> <file> [<file> ...] [--reason TEXT] [--before-start]\n  yallaflow intake ticket <payload-file|ticket-ref> [--provider github|jira|azure-devops] [--work <work-id>] [--reason TEXT] [--fetch [--attachments]] [--attachment <file>]... [--title TITLE] [--max-comments N]',
  guide: 'yallaflow guide [work-id]',
  skill: 'yallaflow skill <skill-id> [--work <work-id>]',
  route: 'yallaflow route <work-id> --type TYPE --scope SCOPE --confidence LEVEL --reason REASON [--title TITLE]',
  status: 'yallaflow status',
  snapshot: 'yallaflow snapshot [--json]',
  overview: 'yallaflow overview [--json]',
  runtime: RUNTIME_USAGE,
  new: NEW_USAGE,
  history: HISTORY_USAGE,
  console: 'yallaflow console [--port N] [--no-open] [--project DIR]... [--read-only]\n  yallaflow console add [DIR] | remove DIR | list',
  work: WORK_LIFECYCLE_USAGE,
  resume: 'yallaflow resume [work-id]',
  ready: 'yallaflow ready [work-id]',
  doctor: 'yallaflow doctor [--clear-lock]',
  advance: 'yallaflow advance [work-id]',
  verify: 'yallaflow verify [work-id] -- <executable> [args...]\n  yallaflow verify [work-id] --shell "<command>"\n  yallaflow verify [work-id] --script <path>\n  yallaflow verify list [work-id]',
  reopen: 'yallaflow reopen <work-id> --to implementation|verification|review --reason REASON',
  progress: 'yallaflow progress <parent-id>',
  next: 'yallaflow next <parent-id>',
  approve: 'yallaflow approve <work-id> --stage GATE [--note TEXT]',
  feedback: 'yallaflow feedback <work-id> --stage GATE --changes-requested [--note TEXT]',
  handoff: 'yallaflow handoff [work-id]',
  request: 'yallaflow request revise <work-id> --text TEXT --reason TEXT',
  context: CONTEXT_USAGE,
  upgrade: UPGRADE_USAGE,
  brief: 'yallaflow brief',
  inspect: 'yallaflow inspect',
  limitation: LIMITATION_USAGE,
  qc: QC_USAGE,
  demo: DEMO_USAGE,
  agent: AGENT_USAGE,
  shared: SHARED_USAGE,
  purpose: PURPOSE_USAGE,
  finish: 'yallaflow finish [work-id] [--verbose]',
  baseline: 'yallaflow baseline start [--objective TEXT] [--preserve TEXT]... [--focus TEXT]...\n  yallaflow baseline draft <work-id> --file <baseline.json>\n  yallaflow baseline status [work-id]\n  yallaflow baseline show [work-id]\n  yallaflow baseline approve <work-id> [--note TEXT]\n  yallaflow baseline feedback <work-id> --changes-requested [--note TEXT]',
  feature: 'yallaflow feature <title> --scope SCOPE',
  bug: 'yallaflow bug <title> --scope SCOPE',
  investigate: 'yallaflow investigate <title> --scope SCOPE',
  change: 'yallaflow change <title> --scope SCOPE',
  refactor: 'yallaflow refactor <title> --scope SCOPE',
  release: 'yallaflow release <title> --scope SCOPE'
};

// Per-namespace sub-action usage, so `<namespace> <action> --help` gets a precise
// answer instead of falling back to the whole namespace's dump. Every namespace with
// sub-actions (propose/validate/execute/status, start/draft/status/show/approve/
// feedback, add/list/promote/reject/review, add/list/answer/resolve, revise, list)
// is listed here — this table, plus the single scan below, is the entire help
// strategy: no per-branch `--help` checks are scattered through the command handlers.
const NAMESPACE_ACTIONS = {
  shared: {
    enable: 'yallaflow shared enable [--integration-branch BRANCH] [--dry-run]',
    status: 'yallaflow shared status [--verbose]',
    check: 'yallaflow shared check',
    integrate: 'yallaflow shared integrate [--dry-run] [--verbose]'
  },
  purpose: {
    set: 'yallaflow purpose set [work-id] --objective TEXT [--mode bootstrap|intent|freshness] [--preserve TEXT]... [--focus TEXT]...',
    show: 'yallaflow purpose show [work-id]'
  },
  integration: {
    record: 'yallaflow integration record <work-id> --file <record.json> [--accept-minimum-version 1.5.0]',
    show: 'yallaflow integration show <work-id>'
  },
  execution: {
    'checks set': 'yallaflow execution checks set --file <checks.json> [--accept-minimum-version 1.5.0]',
    'checks show': 'yallaflow execution checks show'
  },
  baseline: {
    start: 'yallaflow baseline start [--objective TEXT] [--preserve TEXT]... [--focus TEXT]...',
    draft: 'yallaflow baseline draft <work-id> --file <baseline.json>',
    status: 'yallaflow baseline status [work-id]',
    show: 'yallaflow baseline show [work-id]',
    approve: 'yallaflow baseline approve [work-id] [--note TEXT]',
    feedback: 'yallaflow baseline feedback [work-id] --changes-requested [--note TEXT]'
  },
  decompose: {
    propose: 'yallaflow decompose propose <parent-id> --file <decomposition.json>',
    validate: 'yallaflow decompose validate <parent-id>',
    execute: 'yallaflow decompose execute <parent-id>',
    status: 'yallaflow decompose status <parent-id>'
  },
  request: {
    revise: 'yallaflow request revise <work-id> --text TEXT --reason TEXT'
  },
  context: {
    status: 'yallaflow context status',
    list: 'yallaflow context list [--area AREA] [--all]',
    show: 'yallaflow context show <CTX-id>',
    history: 'yallaflow context history <CTX-id>',
    affected: 'yallaflow context affected [--since REF] [path ...]',
    adopt: 'yallaflow context adopt [--dry-run]',
    render: 'yallaflow context render',
    reconcile: RECONCILE_USAGE
  },
  upgrade: {
    status: 'yallaflow upgrade status',
    plan: 'yallaflow upgrade plan'
  },
  agent: {
    status: 'yallaflow agent status',
    refresh: 'yallaflow agent refresh [--preserve-existing] [--dry-run]',
    setup: 'yallaflow agent setup <codex|claude> [--preserve-existing] [--dry-run]'
  },
  requirement: {
    record: 'yallaflow requirement record <work-id> --file <requirements.json>',
    list: 'yallaflow requirement list <work-id>',
    show: 'yallaflow requirement show <work-id> <REQ-###|AC-###>'
  },
  convergence: {
    record: 'yallaflow convergence record <work-id> --file <convergence.json>',
    status: 'yallaflow convergence status <work-id>',
    show: 'yallaflow convergence show <work-id> [CV-###|AC-###|UR-###]'
  },
  impact: {
    status: 'yallaflow impact status <work-id>',
    assess: 'yallaflow impact assess <work-id> --file <impact.json>'
  },
  qc: {
    plan: 'yallaflow qc plan <work-id> --file <plan.json>',
    record: 'yallaflow qc record <work-id> --file <result.json> [--allow-remote]',
    status: 'yallaflow qc status <work-id>'
  },
  demo: {
    propose: 'yallaflow demo propose <work-id> --file <scope.json>',
    approve: 'yallaflow demo approve <work-id> --note TEXT [--only D-01,D-02]',
    record: 'yallaflow demo record <work-id> --file <result.json> [--allow-remote]',
    status: 'yallaflow demo status <work-id>'
  },
  limitation: {
    add: 'yallaflow limitation add [work-id] --type TYPE --area AREA --summary TEXT --reason TEXT',
    list: 'yallaflow limitation list [work-id]'
  },
  verify: {
    list: 'yallaflow verify list [work-id]'
  },
  source: {
    list: 'yallaflow source list',
    show: 'yallaflow source show <source-id> [--content]'
  },
  intake: {
    add: 'yallaflow intake add <work-id> <file> [<file> ...] [--reason TEXT] [--before-start]',
    ticket: 'yallaflow intake ticket <payload-file|ticket-ref> [--provider github|jira|azure-devops] [--work <work-id>] [--reason TEXT] [--fetch [--attachments]] [--attachment <file>]... [--title TITLE] [--max-comments N]'
  },
  checkpoint: {
    revise: 'yallaflow checkpoint revise [work-id] --skill SKILL --status STATUS --reason TEXT [--summary TEXT]'
  },
  knowledge: {
    propose: 'yallaflow knowledge propose [work-id] --kind KIND --source design-spec|implementation-runtime --summary TEXT --evidence REF [--supersedes|--reconfirms|--disputes CTX-####] [--confidence LEVEL] [--provenance SOURCE]',
    list: 'yallaflow knowledge list [work-id]',
    promote: 'yallaflow knowledge promote [work-id] --candidate ID',
    reject: 'yallaflow knowledge reject [work-id] --candidate ID --reason TEXT',
    review: 'yallaflow knowledge review [work-id] --none'
  },
  question: {
    add: 'yallaflow question add [work-id] --category business|architecture --text TEXT [--proposal TEXT] [--non-material]',
    list: 'yallaflow question list [work-id]',
    answer: 'yallaflow question answer [work-id] --id Q-001 --answer TEXT',
    resolve: 'yallaflow question resolve [work-id] --id Q-001 [--resolution TEXT]'
  }
};

function isHelpToken(token) {
  return token === '--help' || token === '-h';
}

// Commands whose own documented syntax defines a `--` separator marking the start of
// literal payload/child-process argv (`yallaflow verify [work-id] -- <executable>
// [args...]`). YallaFlow's help scan must never cross that boundary — everything
// after it belongs to the thing being verified, not to YallaFlow, so a `--help`
// intended for the child (`verify PF-0001 -- node --help`) must run as verification,
// never be swallowed as a request for YallaFlow's own help. This is what makes the
// scan command-aware rather than a blind scan across all argv: only commands that
// actually define this boundary get it applied.
const PAYLOAD_BOUNDARY_COMMANDS = new Set(['verify']);

// The scope of tokens YallaFlow's own help scan is allowed to inspect: the full
// argument list for an ordinary command/subcommand, or only the prefix before `--`
// for a payload-boundary command. Note this is about *scope*, not substring matching:
// isHelpToken already only ever matches a token that IS exactly `--help`/`-h`, so an
// option's own value (`--text "Document --help behavior"`, `start "...--help..."`) is
// never mistaken for the flag — those arrive as one argv entry, not as `--help` itself.
function helpScanScope(command, rest) {
  // `start <options> -- <request>` (v1.2.0): the request after `--` is the user's text.
  if (command === 'start' && startOptionsEnd(rest) !== -1) return rest.slice(0, startOptionsEnd(rest));
  if (!PAYLOAD_BOUNDARY_COMMANDS.has(command)) return rest;
  const sepIndex = rest.indexOf('--');
  return sepIndex === -1 ? rest : rest.slice(0, sepIndex);
}

function printCommandHelp(command, rest) {
  const actionKey = rest.find((token) => !isHelpToken(token) && !token.startsWith('-'));
  const nested = NAMESPACE_ACTIONS[command]?.[actionKey];
  if (nested) return console.log(`Usage:\n  ${nested}\n`);
  const dedicated = { requirement: requirementHelp, convergence: convergenceHelp, impact: impactHelp, agent: agentHelp, context: contextHelp, upgrade: upgradeHelp, limitation: limitationHelp, qc: qcHelp, demo: demoHelp, source: sourceHelp, checkpoint: checkpointHelp, knowledge: knowledgeHelp, question: questionHelp, decompose: decomposeHelp, baseline: baselineHelp, shared: sharedHelp, purpose: purposeHelp };
  if (dedicated[command]) return dedicated[command]();
  if (USAGE[command]) return console.log(`Usage:\n  ${USAGE[command]}\n`);
  return help();
}

async function deliveryCommand(command, rest) {
  const [action, ...actionArgs] = rest;
  const helpFor = { requirement: requirementHelp, convergence: convergenceHelp, impact: impactHelp }[command];
  if (!action) return helpFor();
  const usage = NAMESPACE_ACTIONS[command][action];
  if (!usage) throw new Error(`Unknown ${command} action: ${action}. Use ${Object.keys(NAMESPACE_ACTIONS[command]).join(', ')}.`);
  const writes = ['record', 'assess'].includes(action);
  const { values, positionals } = parseOptions(actionArgs, writes ? { file: { type: 'string' } } : {});
  const wanted = command === 'requirement' && action === 'show' ? 2 : command === 'convergence' && action === 'show' ? [1, 2] : 1;
  const ok = Array.isArray(wanted) ? wanted.includes(positionals.length) : positionals.length === wanted;
  if (!ok || (writes && !values.file)) throw new Error(`Usage: ${usage}`);
  const [workId, id] = positionals;
  const handlers = {
    requirement: { record: () => requirementRecordCommand(workId, values), list: () => requirementListCommand(workId), show: () => requirementShowCommand(workId, id) },
    convergence: { record: () => convergenceRecordCommand(workId, values), status: () => convergenceStatusCommand(workId), show: () => convergenceShowCommand(workId, id) },
    impact: { status: () => impactStatusCommand(workId), assess: () => impactAssessCommand(workId, values) }
  };
  return handlers[command][action]();
}

// Shared Projects record the YallaFlow version they require (config.yaml
// yallaflow.minimumVersion). An older CLI stops before any project-state mutation;
// read-only orientation, inspection, and integrity commands still run so the developer
// sees why. YallaFlow never self-updates or downloads anything.
const READ_ONLY_COMMANDS = new Set(['agents', 'snapshot', 'overview', 'console', 'brief', 'doctor', 'status', 'inspect', 'upgrade', 'handoff', 'resume', 'ready', 'guide', 'progress', 'next', 'finish', 'skill', 'source']);
const READ_ONLY_ACTIONS = {
  shared: ['status', 'check'], context: ['status', 'list', 'show', 'history', 'affected'], knowledge: ['list'], question: ['list'],
  verify: ['list'], baseline: ['status', 'show'], decompose: ['status'], requirement: ['list', 'show'], convergence: ['status', 'show'],
  work: ['show'], impact: ['status'], limitation: ['list'], qc: ['status'], demo: ['status'], purpose: ['show'], agent: ['status']
};

// v1.4.0 central lifecycle guard (PF-0041): a held or closed work item refuses every
// progress mutation. Every write path, the console's included, runs through this
// dispatcher. Lifecycle operations themselves and reopen of closed work are exempt;
// core functions repeat the check (defense in depth).
const LIFECYCLE_EXEMPT = new Set(['history', 'new', 'runtime', 'init', 'start', 'work', 'reopen', 'context', 'shared', 'agent', 'agents', 'upgrade', 'console', 'skill', 'source', 'inspect', 'baseline']);
// Conservative: every work id named before a `--` payload, in any argument shape
// (positional, after a flag, or as --opt=PF-…). A referenced held or closed item refuses
// the command; the refusal names the command that lifts it.
const WORK_TOKEN = /^PF-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
function targetWorkIds(rest) {
  const tokens = rest.includes('--') ? rest.slice(0, rest.indexOf('--')) : rest;
  const ids = [];
  for (const token of tokens) {
    const value = token.startsWith('--') && token.includes('=') ? token.slice(token.indexOf('=') + 1) : token;
    if (WORK_TOKEN.test(value)) ids.push(value);
  }
  return ids;
}

async function assertLifecycleForCommand(command, rest) {
  if (LIFECYCLE_EXEMPT.has(command) || !isMutatingCommand(command, rest)) return;
  const root = await findProjectRoot();
  if (!root) return;
  let ids = targetWorkIds(rest);
  if (!ids.length) {
    try {
      const active = (await getCurrentState(root))?.activeWork;
      if (active) ids = [active];
    } catch {
      return;
    }
  }
  for (const id of ids) await assertWorkProgressAllowed(root, id, `\`yallaflow ${command}${rest[0] && !rest[0].startsWith('-') && !/^PF-/.test(rest[0]) ? ` ${rest[0]}` : ''}\``);
}

// A mutation for the lifecycle guard: what takes the workspace lock, plus `verify`
// (which locks itself) and a fetching ticket import (which locks after the network part).
function isMutatingCommand(command, rest) {
  if (command === 'verify') return rest[0] !== 'list';
  if (command === 'intake' && rest[0] === 'ticket' && rest.includes('--fetch')) return true;
  return needsWorkspaceLock(command, rest);
}


async function isClosedWork(workId) {
  const root = await findProjectRoot();
  if (!root || !/^PF-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(String(workId))) return false;
  try {
    return lifecycleOf(await loadWorkMetaOrThrow(root, workId)) === 'closed';
  } catch {
    return false;
  }
}

async function assertCompatibleForCommand(command, rest) {
  if (command === 'init' || READ_ONLY_COMMANDS.has(command)) return;
  const action = rest[0];
  if (READ_ONLY_ACTIONS[command]?.includes(action)) return;
  if (command === 'context' && action === 'reconcile' && ['status', 'show', 'preview'].includes(rest[1])) return;
  const root = await findProjectRoot();
  if (!root) return;
  const compat = await checkProjectCompatibility(root);
  if (!compat.compatible) throw new Error(incompatibleMessage(compat));
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') return help();
  if (command === '--version' || command === '-v') return console.log(PACKAGE_VERSION);
  // Asking for help never mutates YallaFlow state, for any command/sub-action, at any
  // position within YallaFlow's own arguments — but never crosses a documented `--`
  // payload boundary into a child command's own argv (see helpScanScope above). This,
  // plus the per-namespace usage table above, is the entire help strategy; no
  // scattered per-branch exceptions are needed or present.
  if (helpScanScope(command, rest).some(isHelpToken)) return printCommandHelp(command, rest);

  await assertCompatibleForCommand(command, rest);
  if (!needsWorkspaceLock(command, rest)) {
    await assertLifecycleForCommand(command, rest);
    return dispatch(command, rest);
  }
  const root = await findProjectRoot();
  if (!root) return dispatch(command, rest);
  const label = ['yallaflow', command, ...rest.filter((token) => !token.startsWith('-')).slice(0, 2)].join(' ');
  // The lifecycle guard runs under the lock, so a concurrent hold/close can't slip in
  // between the check and the write.
  return withWorkspaceLock(root, label, async () => {
    await assertLifecycleForCommand(command, rest);
    return dispatch(command, rest);
  });
}

// v1.2.0: every command that can write .yallaflow holds the workspace lock
// (src/utils/lock.js) for its whole run, so concurrent agents never interleave writes or
// allocate the same ID. Read-only commands never take it. `verify` takes it itself, only
// around recording, never while the verified command runs. `init` creates the workspace.
function needsWorkspaceLock(command, rest) {
  if (command === 'init' || command === 'verify' || READ_ONLY_COMMANDS.has(command)) return false;
  const action = rest[0];
  // 1.4.0 runtime: only profile edits (add/remove) write shared state. Start/stop/trust/logs
  // touch personal .yallaflow/local state under a per-service lock, and a start may wait a
  // minute for readiness, so they never hold the workspace lock.
  if (command === 'runtime') return ['add', 'remove'].includes(action);
  // 1.4.0 New Project Wizard: writes a brand-new folder (and the user's plan folder), never
  // the workspace the command happens to run from.
  if (command === 'new') return false;
  // 1.4.0 history: plan/list/show are read-only; import/map/remove write the lineage folder.
  if (command === 'history') return ['import', 'map', 'remove'].includes(action);
  if (READ_ONLY_ACTIONS[command]?.includes(action)) return false;
  if (command === 'context' && action === 'reconcile' && ['status', 'show', 'preview'].includes(rest[1])) return false;
  if (command === 'context' && !action) return false;
  // Dry runs report without writing — only where the command defines --dry-run.
  if (rest.includes('--dry-run') && ((command === 'shared' && ['integrate', 'enable'].includes(action)) || (command === 'context' && action === 'adopt') || (command === 'agent' && ['refresh', 'setup'].includes(action)))) return false;
  // A fetching ticket import locks itself only after the network part (commands/intake.js).
  if (command === 'intake' && action === 'ticket' && rest.includes('--fetch')) return false;
  return true;
}

// `start [--keep-active] [--via console --request-id ID] -- <request>` (v1.2.0). The new
// options apply only as leading tokens closed by `--`; any other invocation (the whole
// argv joined as the request) behaves exactly as before.
const START_OPTIONS = { '--keep-active': 0, '--via': 1, '--request-id': 1 };
function startOptionsEnd(rest) {
  let index = 0;
  while (index < rest.length && rest[index] in START_OPTIONS) index += 1 + START_OPTIONS[rest[index]];
  return index > 0 && rest[index] === '--' ? index : -1;
}
export function parseStartArgs(rest) {
  const end = startOptionsEnd(rest);
  if (end === -1) return [rest.join(' ')];
  const options = {};
  for (let index = 0; index < end; index++) {
    const token = rest[index];
    if (token === '--keep-active') options.keepActive = true;
    else if (token === '--via') options.via = rest[++index];
    else if (token === '--request-id') options.requestId = rest[++index];
  }
  if (options.via !== undefined && options.via !== 'console') throw new Error('--via must be console');
  if (options.requestId !== undefined && !/^[A-Za-z0-9-]{8,64}$/.test(options.requestId)) throw new Error('--request-id must be 8-64 letters, digits or hyphens');
  if (options.requestId && !options.via) throw new Error('--request-id requires --via console');
  return [rest.slice(end + 1).join(' '), options];
}

async function dispatch(command, rest) {

  if (command === 'init') {
    const { values } = parseOptions(rest, { name: { type: 'string' }, type: { type: 'string' }, mode: { type: 'string' } });
    if (values.type && !VALID_PROJECT_TYPES.has(values.type)) throw new Error('--type must be greenfield or brownfield');
    if (values.mode && !INTERACTION_MODES.includes(values.mode)) throw new Error(`--mode must be one of: ${INTERACTION_MODES.join(', ')}`);
    return initCommand({ name: values.name, type: values.type, mode: values.mode });
  }

  if (command === 'start') return startCommand(...parseStartArgs(rest));
  if (command === 'agents') {
    const [action, ...actionArgs] = rest;
    if (actionArgs.length || !['detect', 'claude-files'].includes(action)) throw new Error('Usage: yallaflow agents detect');
    return agentsCommand(action);
  }
  if (command === 'activate') {
    if (rest.length !== 1) throw new Error('Usage: yallaflow activate <work-id>');
    return activateCommand(rest[0]);
  }
  if (command === 'request') {
    const [action, ...actionArgs] = rest;
    if (action !== 'revise') throw new Error('Usage: yallaflow request revise <work-id> --text TEXT --reason TEXT');
    const { values, positionals } = parseOptions(actionArgs, { text: { type: 'string' }, reason: { type: 'string' } });
    if (positionals.length !== 1) throw new Error('Usage: yallaflow request revise <work-id> --text TEXT --reason TEXT');
    return requestReviseCommand(positionals[0], { text: values.text, reason: values.reason });
  }
  if (command === 'intake') {
    if (rest[0] === 'add') {
      const { values, positionals } = parseOptions(rest.slice(1), { reason: { type: 'string' }, via: { type: 'string' }, 'before-start': { type: 'boolean' } });
      if (positionals.length < 2) throw new Error('Usage: yallaflow intake add <work-id> <file> [<file> ...] [--reason TEXT] [--before-start]');
      if (values.via !== undefined && values.via !== 'console') throw new Error('--via must be console');
      const [workId, ...files] = positionals;
      return intakeAddCommand(workId, files, { reason: values.reason, via: values.via, beforeStart: values['before-start'] });
    }
    if (rest[0] === 'ticket') {
      const { values, positionals } = parseOptions(rest.slice(1), {
        provider: { type: 'string' }, work: { type: 'string' }, reason: { type: 'string' }, fetch: { type: 'boolean' },
        attachments: { type: 'boolean' }, attachment: { type: 'string', multiple: true }, title: { type: 'string' }, 'max-comments': { type: 'string' }
      });
      if (positionals.length !== 1) throw new Error(`Usage: ${NAMESPACE_ACTIONS.intake.ticket}`);
      return intakeTicketCommand(positionals[0], { ...values, maxComments: values['max-comments'] });
    }
    const { values, positionals } = parseOptions(rest, { title: { type: 'string' } });
    if (positionals.length < 1) throw new Error('Usage: yallaflow intake <file> [<file> ...] [--title TITLE]');
    return intakeCommand(positionals, { title: values.title });
  }
  if (command === 'qc') {
    const [action, ...actionArgs] = rest;
    if (!action) return qcHelp();
    const usage = NAMESPACE_ACTIONS.qc[action];
    if (!usage) throw new Error(`Unknown qc action: ${action}. Use ${Object.keys(NAMESPACE_ACTIONS.qc).join(', ')}.`);
    const { values, positionals } = parseOptions(actionArgs, action === 'status' ? {} : { file: { type: 'string' }, ...(action === 'record' ? { 'allow-remote': { type: 'boolean' } } : {}) });
    if (positionals.length !== 1 || (action !== 'status' && !values.file)) throw new Error(`Usage: ${usage}`);
    if (action === 'plan') return qcPlanCommand(positionals[0], { file: values.file });
    if (action === 'record') return qcRecordCommand(positionals[0], { file: values.file, allowRemote: values['allow-remote'] === true });
    return qcStatusCommand(positionals[0]);
  }
  if (command === 'demo') {
    const [action, ...actionArgs] = rest;
    if (!action) return demoHelp();
    const usage = NAMESPACE_ACTIONS.demo[action];
    if (!usage) throw new Error(`Unknown demo action: ${action}. Use ${Object.keys(NAMESPACE_ACTIONS.demo).join(', ')}.`);
    const options = {
      propose: { file: { type: 'string' } },
      approve: { note: { type: 'string' }, only: { type: 'string' } },
      record: { file: { type: 'string' }, 'allow-remote': { type: 'boolean' } },
      status: {}
    }[action];
    const { values, positionals } = parseOptions(actionArgs, options);
    if (positionals.length !== 1 || ((action === 'propose' || action === 'record') && !values.file)) throw new Error(`Usage: ${usage}`);
    if (action === 'propose') return demoProposeCommand(positionals[0], { file: values.file });
    if (action === 'approve') return demoApproveCommand(positionals[0], { note: values.note, only: values.only });
    if (action === 'record') return demoRecordCommand(positionals[0], { file: values.file, allowRemote: values['allow-remote'] === true });
    return demoStatusCommand(positionals[0]);
  }
  if (command === 'source') {
    const [action, ...actionArgs] = rest;
    if (!action) return sourceHelp();
    if (action === 'list') {
      const { positionals } = parseOptions(actionArgs, {});
      if (positionals.length) throw new Error('Usage: yallaflow source list');
      return sourceCommand('list');
    }
    if (action === 'show') {
      const { values, positionals } = parseOptions(actionArgs, { content: { type: 'boolean' } });
      if (positionals.length !== 1) throw new Error('Usage: yallaflow source show <source-id> [--content]');
      return sourceCommand('show', { sourceId: positionals[0], content: values.content });
    }
    throw new Error(`Unknown source action: ${action}. Use list or show.`);
  }
  if (command === 'guide') {
    if (rest.length > 1) throw new Error('Usage: yallaflow guide [work-id]');
    return guideCommand(rest[0]);
  }
  if (command === 'skill') {
    const { values, positionals } = parseOptions(rest, { work: { type: 'string' } });
    if (positionals.length !== 1) throw new Error(`Usage: ${USAGE.skill}`);
    return skillCommand(positionals[0], { work: values.work });
  }
  if (command === 'checkpoint') {
    if (rest[0] === 'revise') {
      const { values, positionals } = parseOptions(rest.slice(1), {
        skill: { type: 'string' },
        status: { type: 'string' },
        reason: { type: 'string' },
        summary: { type: 'string' }
      });
      if (positionals.length > 1) throw new Error('Usage: yallaflow checkpoint revise [work-id] --skill SKILL --status STATUS --reason TEXT');
      return reviseCheckpointCommand(positionals[0], {
        skillId: values.skill,
        status: values.status,
        reason: values.reason,
        summary: values.summary
      });
    }
    const { values, positionals } = parseOptions(rest, {
      skill: { type: 'string' },
      status: { type: 'string' },
      start: { type: 'boolean' },
      complete: { type: 'boolean' },
      summary: { type: 'string' },
      evidence: { type: 'string', multiple: true },
      ruling: { type: 'string' },
      'ruling-reason': { type: 'string' },
      'cost-if-wrong': { type: 'string' }
    });
    if (positionals.length > 1) throw new Error('Usage: yallaflow checkpoint [work-id] --skill SKILL --status STATUS');
    const statusOptions = [values.status, values.start && 'in_progress', values.complete && 'completed'].filter(Boolean);
    if (statusOptions.length > 1) throw new Error('Use only one of --status, --start, or --complete.');
    const status = statusOptions[0];
    if ((values.skill && !status) || (!values.skill && status)) throw new Error('A skill checkpoint requires both --skill and a status option.');
    if (!values.skill && (values.summary || values.evidence)) throw new Error('--summary and --evidence require --skill.');
    const rulingValues = [values.ruling, values['ruling-reason'], values['cost-if-wrong']];
    if (rulingValues.some(Boolean) && !rulingValues.every(Boolean)) {
      throw new Error('A ruling requires --ruling, --ruling-reason, and --cost-if-wrong.');
    }
    return checkpointCommand(positionals[0], {
      skillId: values.skill,
      status,
      summary: values.summary,
      evidence: values.evidence ?? [],
      ruling: values.ruling ? {
        decision: values.ruling,
        reason: values['ruling-reason'],
        costIfWrong: values['cost-if-wrong']
      } : undefined
    });
  }
  if (command === 'knowledge') {
    const [action, ...actionArgs] = rest;
    if (!action) throw new Error('Usage: yallaflow knowledge <propose|list|promote|reject|review> [work-id]');
    if (action === 'propose') {
      const { values, positionals } = parseOptions(actionArgs, {
        kind: { type: 'string' },
        summary: { type: 'string' },
        evidence: { type: 'string', multiple: true },
        source: { type: 'string' },
        context: { type: 'string' },
        decision: { type: 'string' },
        reason: { type: 'string' },
        'cost-if-wrong': { type: 'string' },
        'from-ruling': { type: 'string' },
        supersedes: { type: 'string' },
        reconfirms: { type: 'string' },
        disputes: { type: 'string' },
        confidence: { type: 'string' },
        provenance: { type: 'string' }
      });
      if (positionals.length > 1) throw new Error('Usage: yallaflow knowledge propose [work-id] --kind KIND --summary TEXT --evidence REF');
      return knowledgeCommand(action, positionals[0], {
        kind: values.kind,
        summary: values.summary,
        evidence: values.evidence ?? [],
        source: values.source,
        context: values.context,
        decision: values.decision,
        reason: values.reason,
        costIfWrong: values['cost-if-wrong'],
        fromRuling: values['from-ruling'],
        supersedes: values.supersedes,
        reconfirms: values.reconfirms,
        disputes: values.disputes,
        confidence: values.confidence,
        provenance: values.provenance
      });
    }
    if (action === 'list') {
      const { positionals } = parseOptions(actionArgs, {});
      if (positionals.length > 1) throw new Error('Usage: yallaflow knowledge list [work-id]');
      return knowledgeCommand(action, positionals[0]);
    }
    if (action === 'promote' || action === 'reject') {
      const allowed = action === 'reject'
        ? { candidate: { type: 'string' }, reason: { type: 'string' } }
        : { candidate: { type: 'string' } };
      const { values, positionals } = parseOptions(actionArgs, allowed);
      if (positionals.length > 1) throw new Error(`Usage: yallaflow knowledge ${action} [work-id] --candidate ID`);
      return knowledgeCommand(action, positionals[0], {
        candidateId: values.candidate,
        reason: values.reason
      });
    }
    if (action === 'review') {
      const { values, positionals } = parseOptions(actionArgs, { none: { type: 'boolean' } });
      if (positionals.length > 1) throw new Error('Usage: yallaflow knowledge review [work-id] --none');
      return knowledgeCommand(action, positionals[0], { none: values.none });
    }
    throw new Error(`Unknown knowledge action: ${action}. Use propose, list, promote, reject, or review.`);
  }
  if (command === 'question') {
    const [action, ...actionArgs] = rest;
    if (!action) return questionHelp();
    if (action === 'add') {
      const { values, positionals } = parseOptions(actionArgs, {
        category: { type: 'string' },
        text: { type: 'string' },
        proposal: { type: 'string' },
        'non-material': { type: 'boolean' }
      });
      if (positionals.length > 1) throw new Error('Usage: yallaflow question add [work-id] --category CATEGORY --text TEXT');
      return questionCommand(action, positionals[0], {
        category: values.category,
        question: values.text,
        proposal: values.proposal,
        material: !values['non-material']
      });
    }
    if (action === 'list') {
      const { positionals } = parseOptions(actionArgs, {});
      if (positionals.length > 1) throw new Error('Usage: yallaflow question list [work-id]');
      return questionCommand(action, positionals[0]);
    }
    if (action === 'answer' || action === 'resolve') {
      const allowed = action === 'answer'
        ? { id: { type: 'string' }, answer: { type: 'string' } }
        : { id: { type: 'string' }, resolution: { type: 'string' } };
      const { values, positionals } = parseOptions(actionArgs, allowed);
      if (positionals.length > 1) throw new Error(`Usage: yallaflow question ${action} [work-id] --id Q-001`);
      return questionCommand(action, positionals[0], {
        questionId: values.id,
        answer: values.answer,
        resolution: values.resolution
      });
    }
    throw new Error(`Unknown question action: ${action}. Use add, list, answer, or resolve.`);
  }
  if (command === 'route') {
    const { values, positionals } = parseOptions(rest, {
      type: { type: 'string' },
      scope: { type: 'string' },
      confidence: { type: 'string' },
      reason: { type: 'string' },
      title: { type: 'string' }
    });
    if (positionals.length !== 1) throw new Error('Usage: yallaflow route <work-id> --type TYPE --scope SCOPE --confidence LEVEL --reason REASON');
    return routeCommand(positionals[0], {
      work_type: values.type,
      scope: values.scope,
      confidence: values.confidence,
      reason: values.reason,
      title: values.title
    });
  }
  if (command === 'status') return statusCommand();
  if (command === 'console') {
    const { values, positionals } = parseOptions(rest, { port: { type: 'string' }, 'no-open': { type: 'boolean' }, project: { type: 'string', multiple: true }, poll: { type: 'boolean' }, 'read-only': { type: 'boolean' }, agents: { type: 'boolean' }, 'experimental-claude': { type: 'boolean' } });
    if (['add', 'remove', 'list'].includes(positionals[0])) {
      if (positionals.length > 2 || (positionals[0] === 'list' && positionals.length > 1)) throw new Error('Usage: yallaflow console add [DIR] | remove DIR | list');
      return consoleProjectsCommand(positionals[0], positionals[1]);
    }
    if (positionals.length) throw new Error('Usage: yallaflow console [--port N] [--no-open] [--project DIR]... [--read-only]\n  yallaflow console add [DIR] | remove DIR | list');
    const port = values.port === undefined ? undefined : Number(values.port);
    if (port !== undefined && !(Number.isInteger(port) && port >= 0 && port < 65536)) throw new Error('--port must be a number between 0 and 65535');
    return consoleCommand({ port, open: !values['no-open'], projects: values.project ?? [], poll: values.poll, readOnly: Boolean(values['read-only']), agents: Boolean(values.agents), experimentalClaude: Boolean(values['experimental-claude']) });
  }
  if (command === 'runtime') return runtimeCommand(rest);
  if (command === 'new') return newCommand(rest);
  if (command === 'history') return historyCommand(rest);
  if (command === 'overview') {
    const { values, positionals } = parseOptions(rest, { json: { type: 'boolean' } });
    if (positionals.length) throw new Error('Usage: yallaflow overview [--json]');
    return overviewCommand({ json: values.json });
  }
  if (command === 'snapshot') {
    const { values, positionals } = parseOptions(rest, { json: { type: 'boolean' } });
    if (positionals.length) throw new Error('Usage: yallaflow snapshot [--json]');
    return snapshotCommand({ json: values.json });
  }
  if (command === 'work') {
    if (['hold', 'resume', 'close'].includes(rest[0])) {
      const { values, positionals } = parseOptions(rest.slice(1), { reason: { type: 'string' }, note: { type: 'string' }, outcome: { type: 'string' }, by: { type: 'string' }, 'accept-minimum-version': { type: 'string' } });
      if (positionals.length !== 1) throw new Error(`Usage: ${WORK_LIFECYCLE_USAGE}`);
      return workLifecycleCommand(rest[0], positionals[0], values);
    }
    const { values, positionals } = parseOptions(rest, { json: { type: 'boolean' } });
    if (positionals[0] !== 'show' || positionals.length !== 2) throw new Error(`Usage: ${WORK_LIFECYCLE_USAGE}`);
    return workShowCommand(positionals[1], { json: values.json });
  }
  if (command === 'resume') {
    if (rest.length > 1) throw new Error('Usage: yallaflow resume [work-id]');
    return resumeCommand(rest[0]);
  }
  if (command === 'ready') {
    if (rest.length > 1) throw new Error('Usage: yallaflow ready [work-id]');
    return readyCommand(rest[0]);
  }
  if (command === 'doctor') {
    const { values, positionals } = parseOptions(rest, { 'clear-lock': { type: 'boolean' } });
    if (positionals.length) throw new Error('Usage: yallaflow doctor [--clear-lock]');
    return doctorCommand({ clearLock: values['clear-lock'] });
  }
  if (command === 'advance') {
    if (rest.length > 1) throw new Error('Usage: yallaflow advance [work-id]');
    return advanceCommand(rest[0]);
  }
  if (command === 'verify') {
    if (rest[0] === 'list') {
      const { positionals } = parseOptions(rest.slice(1), {});
      if (positionals.length > 1) throw new Error('Usage: yallaflow verify list [work-id]');
      return verifyListCommand(positionals[0]);
    }
    const sepIndex = rest.indexOf('--');
    const shellIndex = rest.indexOf('--shell');
    const scriptIndex = rest.indexOf('--script');
    const modeCount = [sepIndex, shellIndex, scriptIndex].filter((index) => index >= 0).length;
    if (modeCount > 1) throw new Error('Use only one of: -- <executable> [args...], --shell "<command>", --script <path>.');
    if (shellIndex >= 0) {
      if (shellIndex > 1) throw new Error('Usage: yallaflow verify [work-id] --shell "<command>"');
      if (rest.length !== shellIndex + 2) throw new Error('Usage: yallaflow verify [work-id] --shell "<command>"');
      const workId = shellIndex === 1 ? rest[0] : undefined;
      return verifyShellCommand(rest[shellIndex + 1], workId);
    }
    if (scriptIndex >= 0) {
      if (scriptIndex > 1) throw new Error('Usage: yallaflow verify [work-id] --script <path>');
      if (rest.length !== scriptIndex + 2) throw new Error('Usage: yallaflow verify [work-id] --script <path>');
      const workId = scriptIndex === 1 ? rest[0] : undefined;
      return verifyScriptCommand(rest[scriptIndex + 1], workId);
    }
    if (sepIndex === -1) throw new Error('Usage: yallaflow verify [work-id] -- <executable> [args...] (or --shell / --script)');
    if (sepIndex > 1) throw new Error('Usage: yallaflow verify [work-id] -- <executable> [args...]');
    const workId = sepIndex === 1 ? rest[0] : undefined;
    return verifyCommand(rest.slice(sepIndex + 1), workId);
  }
  if (command === 'reopen') {
    const { values, positionals } = parseOptions(rest, { to: { type: 'string' }, reason: { type: 'string' } });
    if (positionals.length !== 1) throw new Error('Usage: yallaflow reopen <work-id> --to implementation|verification|review --reason "..."   (closed work: yallaflow reopen <work-id> --reason "...")');
    // v1.4.0: closed work reopens at its preserved stage; DONE work keeps `--to` exactly as before.
    const closed = await isClosedWork(positionals[0]);
    if (closed) {
      if (values.to) throw new Error(`${positionals[0]} is closed; it reopens at its preserved stage, so --to does not apply. No files were changed.`);
      return reopenClosedCommand(positionals[0], values.reason);
    }
    return reopenCommand(positionals[0], { toStage: values.to, reason: values.reason });
  }
  if (command === 'decompose') {
    if (!rest[0]) return decomposeHelp();
    const [action, ...actionArgs] = rest;
    if (action === 'propose') {
      const { values, positionals } = parseOptions(actionArgs, { file: { type: 'string' } });
      if (positionals.length !== 1) throw new Error('Usage: yallaflow decompose propose <parent-id> --file <decomposition.json>');
      return decomposeProposeCommand(positionals[0], { file: values.file });
    }
    if (action === 'validate') {
      const { positionals } = parseOptions(actionArgs, {});
      if (positionals.length !== 1) throw new Error('Usage: yallaflow decompose validate <parent-id>');
      return decomposeValidateCommand(positionals[0]);
    }
    if (action === 'execute') {
      const { positionals } = parseOptions(actionArgs, {});
      if (positionals.length !== 1) throw new Error('Usage: yallaflow decompose execute <parent-id>');
      return decomposeExecuteCommand(positionals[0]);
    }
    if (action === 'status') {
      const { positionals } = parseOptions(actionArgs, {});
      if (positionals.length !== 1) throw new Error('Usage: yallaflow decompose status <parent-id>');
      return decomposeStatusCommand(positionals[0]);
    }
    throw new Error(`Unknown decompose action: ${action}. Use propose, validate, execute, or status.`);
  }
  if (command === 'progress') {
    if (rest.length !== 1) throw new Error('Usage: yallaflow progress <parent-id>');
    return projectProgressCommand(rest[0]);
  }
  if (command === 'next') {
    if (rest.length !== 1) throw new Error('Usage: yallaflow next <parent-id>');
    return nextCommand(rest[0]);
  }
  if (command === 'approve') {
    const { values, positionals } = parseOptions(rest, { stage: { type: 'string' }, note: { type: 'string' } });
    if (positionals.length !== 1) throw new Error('Usage: yallaflow approve <work-id> --stage GATE [--note TEXT]');
    return approveCommand(positionals[0], { stage: values.stage, note: values.note });
  }
  if (command === 'feedback') {
    const { values, positionals } = parseOptions(rest, {
      stage: { type: 'string' }, 'changes-requested': { type: 'boolean' }, note: { type: 'string' }
    });
    if (positionals.length !== 1) throw new Error('Usage: yallaflow feedback <work-id> --stage GATE --changes-requested [--note TEXT]');
    return feedbackCommand(positionals[0], { stage: values.stage, changesRequested: values['changes-requested'], note: values.note });
  }
  if (command === 'baseline') {
    const [action, ...actionArgs] = rest;
    if (!action) return baselineHelp();
    if (action === 'start') {
      const { values, positionals } = parseOptions(actionArgs, { objective: { type: 'string' }, preserve: { type: 'string', multiple: true }, focus: { type: 'string', multiple: true } });
      if (positionals.length || ((values.preserve || values.focus) && !values.objective)) throw new Error('Usage: yallaflow baseline start [--objective TEXT] [--preserve TEXT]... [--focus TEXT]...');
      return baselineStartCommand(values.objective ? { objective: values.objective, preserve: values.preserve, focus: values.focus } : undefined);
    }
    if (action === 'draft') {
      const { values, positionals } = parseOptions(actionArgs, { file: { type: 'string' } });
      if (positionals.length !== 1) throw new Error('Usage: yallaflow baseline draft <work-id> --file <baseline.json>');
      return baselineDraftCommand(positionals[0], { file: values.file });
    }
    if (action === 'status') {
      const { positionals } = parseOptions(actionArgs, {});
      if (positionals.length > 1) throw new Error('Usage: yallaflow baseline status [work-id]');
      return baselineStatusCommand(positionals[0]);
    }
    if (action === 'show') {
      const { positionals } = parseOptions(actionArgs, {});
      if (positionals.length > 1) throw new Error('Usage: yallaflow baseline show [work-id]');
      return baselineShowCommand(positionals[0]);
    }
    if (action === 'approve') {
      const { values, positionals } = parseOptions(actionArgs, { note: { type: 'string' } });
      if (positionals.length > 1) throw new Error('Usage: yallaflow baseline approve [work-id] [--note TEXT]');
      return baselineApproveCommand(positionals[0], { note: values.note });
    }
    if (action === 'feedback') {
      const { values, positionals } = parseOptions(actionArgs, { 'changes-requested': { type: 'boolean' }, note: { type: 'string' } });
      if (positionals.length > 1) throw new Error('Usage: yallaflow baseline feedback [work-id] --changes-requested [--note TEXT]');
      return baselineFeedbackCommand(positionals[0], { changesRequested: values['changes-requested'], note: values.note });
    }
    throw new Error(`Unknown baseline action: ${action}. Use start, draft, status, show, approve, or feedback.`);
  }
  if (command === 'context') {
    const [action, ...actionArgs] = rest;
    if (!action) return contextHelp();
    if (action === 'status') {
      const { positionals } = parseOptions(actionArgs, {});
      if (positionals.length) throw new Error('Usage: yallaflow context status');
      return contextStatusCommand();
    }
    if (action === 'list') {
      const { values, positionals } = parseOptions(actionArgs, { area: { type: 'string' }, all: { type: 'boolean' } });
      if (positionals.length) throw new Error('Usage: yallaflow context list [--area AREA] [--all]');
      return contextListCommand({ area: values.area, all: values.all });
    }
    if (action === 'show' || action === 'history') {
      const { positionals } = parseOptions(actionArgs, {});
      if (positionals.length !== 1) throw new Error(`Usage: yallaflow context ${action} <CTX-id>`);
      return action === 'show' ? contextShowCommand(positionals[0]) : contextHistoryCommand(positionals[0]);
    }
    if (action === 'affected') {
      const { values, positionals } = parseOptions(actionArgs, { since: { type: 'string' } });
      return contextAffectedCommand({ since: values.since, paths: positionals });
    }
    if (action === 'adopt') {
      const { values, positionals } = parseOptions(actionArgs, { 'dry-run': { type: 'boolean' } });
      if (positionals.length) throw new Error('Usage: yallaflow context adopt [--dry-run]');
      return contextAdoptCommand({ dryRun: values['dry-run'] });
    }
    if (action === 'render') {
      const { positionals } = parseOptions(actionArgs, {});
      if (positionals.length) throw new Error('Usage: yallaflow context render');
      return contextRenderCommand();
    }
    if (action === 'reconcile') return reconcileCommand(actionArgs);
    throw new Error(`Unknown context action: ${action}. Use status, list, show, history, affected, adopt, render, or reconcile.`);
  }
  if (command === 'agent') {
    const [action, ...actionArgs] = rest;
    if (!action) return agentHelp();
    if (action === 'status') {
      const { positionals } = parseOptions(actionArgs, {});
      if (positionals.length) throw new Error('Usage: yallaflow agent status');
      return agentStatusCommand();
    }
    if (action === 'refresh') {
      const { values, positionals } = parseOptions(actionArgs, { 'preserve-existing': { type: 'boolean' }, 'dry-run': { type: 'boolean' } });
      if (positionals.length) throw new Error('Usage: yallaflow agent refresh [--preserve-existing] [--dry-run]');
      return agentRefreshCommand({ preserveExisting: values['preserve-existing'], dryRun: values['dry-run'] });
    }
    if (action === 'setup') {
      const { values, positionals } = parseOptions(actionArgs, { 'preserve-existing': { type: 'boolean' }, 'dry-run': { type: 'boolean' } });
      if (positionals.length !== 1) throw new Error('Usage: yallaflow agent setup <codex|claude> [--preserve-existing] [--dry-run]');
      return agentSetupCommand(positionals[0], { preserveExisting: values['preserve-existing'], dryRun: values['dry-run'] });
    }
    throw new Error(`Unknown agent action: ${action}. Use status, refresh, or setup.`);
  }
  if (command === 'requirement' || command === 'convergence' || command === 'impact') return deliveryCommand(command, rest);
  if (command === 'limitation') {
    const [action, ...actionArgs] = rest;
    if (!action) return limitationHelp();
    if (action === 'add') {
      const { values, positionals } = parseOptions(actionArgs, {
        type: { type: 'string' }, area: { type: 'string' }, summary: { type: 'string' }, reason: { type: 'string' }
      });
      if (positionals.length > 1) throw new Error('Usage: yallaflow limitation add [work-id] --type TYPE --area AREA --summary TEXT --reason TEXT');
      return limitationCommand('add', positionals[0], { type: values.type, area: values.area, summary: values.summary, reason: values.reason });
    }
    if (action === 'list') {
      const { positionals } = parseOptions(actionArgs, {});
      if (positionals.length > 1) throw new Error('Usage: yallaflow limitation list [work-id]');
      return limitationCommand('list', positionals[0]);
    }
    throw new Error(`Unknown limitation action: ${action}. Use add or list.`);
  }
  if (command === 'upgrade') {
    const [action, ...actionArgs] = rest;
    if (!action) return upgradeHelp();
    const { positionals } = parseOptions(actionArgs, {});
    if (positionals.length) throw new Error(`Usage: yallaflow upgrade ${action}`);
    if (action === 'status') return upgradeStatusCommand();
    if (action === 'plan') return upgradePlanCommand();
    throw new Error(`Unknown upgrade action: ${action}. Use status or plan.`);
  }
  if (command === 'brief') {
    if (rest.length) throw new Error('Usage: yallaflow brief');
    return briefCommand();
  }
  if (command === 'inspect') {
    if (rest.length) throw new Error('Usage: yallaflow inspect');
    return inspectCommand();
  }
  if (command === 'shared') {
    const [action, ...actionArgs] = rest;
    if (!action) return sharedHelp();
    if (action === 'enable') {
      const { values, positionals } = parseOptions(actionArgs, { 'integration-branch': { type: 'string' }, 'dry-run': { type: 'boolean' } });
      if (positionals.length) throw new Error(`Usage: ${NAMESPACE_ACTIONS.shared.enable}`);
      return sharedEnableCommand({ integrationBranch: values['integration-branch'], dryRun: values['dry-run'] });
    }
    if (action === 'status') {
      const { values, positionals } = parseOptions(actionArgs, { verbose: { type: 'boolean' } });
      if (positionals.length) throw new Error(`Usage: ${NAMESPACE_ACTIONS.shared.status}`);
      return sharedStatusCommand({ verbose: values.verbose });
    }
    if (action === 'check') {
      if (actionArgs.length) throw new Error(`Usage: ${NAMESPACE_ACTIONS.shared.check}`);
      return sharedCheckCommand();
    }
    if (action === 'integrate') {
      const { values, positionals } = parseOptions(actionArgs, { 'dry-run': { type: 'boolean' }, verbose: { type: 'boolean' } });
      if (positionals.length) throw new Error(`Usage: ${NAMESPACE_ACTIONS.shared.integrate}`);
      return sharedIntegrateCommand({ dryRun: values['dry-run'], verbose: values.verbose });
    }
    throw new Error(`Unknown shared action: ${action}. Use enable, status, check, or integrate.`);
  }
  // PF-0112 (1.5.0): Review & Merge records, written by the console after a verified merge.
  if (command === 'integration') {
    const [action, ...actionArgs] = rest;
    if (action === 'record' || action === 'show') {
      const { values, positionals } = parseOptions(actionArgs, action === 'record' ? { file: { type: 'string' }, 'accept-minimum-version': { type: 'string' } } : {});
      if (positionals.length !== 1) throw new Error(`Usage: ${NAMESPACE_ACTIONS.integration[action]}`);
      return integrationCommand(action, positionals[0], values);
    }
    throw new Error(`Usage: ${NAMESPACE_ACTIONS.integration.record}\n       ${NAMESPACE_ACTIONS.integration.show}`);
  }
  if (command === 'execution') {
    const [group, action, ...actionArgs] = rest;
    if (group === 'checks' && (action === 'set' || action === 'show')) {
      const { values, positionals } = parseOptions(actionArgs, action === 'set' ? { file: { type: 'string' }, 'accept-minimum-version': { type: 'string' } } : {});
      if (positionals.length) throw new Error(`Usage: ${NAMESPACE_ACTIONS.execution[`checks ${action}`]}`);
      return executionChecksCommand(action, values);
    }
    throw new Error(`Usage: ${NAMESPACE_ACTIONS.execution['checks set']}\n       ${NAMESPACE_ACTIONS.execution['checks show']}`);
  }
  if (command === 'purpose') {
    const [action, ...actionArgs] = rest;
    if (!action) return purposeHelp();
    if (action === 'set') {
      const { values, positionals } = parseOptions(actionArgs, { objective: { type: 'string' }, mode: { type: 'string' }, preserve: { type: 'string', multiple: true }, focus: { type: 'string', multiple: true } });
      if (positionals.length > 1) throw new Error(`Usage: ${NAMESPACE_ACTIONS.purpose.set}`);
      return purposeCommand('set', positionals[0], values);
    }
    if (action === 'show') {
      const { positionals } = parseOptions(actionArgs, {});
      if (positionals.length > 1) throw new Error(`Usage: ${NAMESPACE_ACTIONS.purpose.show}`);
      return purposeCommand('show', positionals[0]);
    }
    throw new Error(`Unknown purpose action: ${action}. Use set or show.`);
  }
  if (command === 'finish') {
    const { values, positionals } = parseOptions(rest, { verbose: { type: 'boolean' } });
    if (positionals.length > 1) throw new Error(`Usage: ${USAGE.finish}`);
    return finishCommand(positionals[0], { verbose: values.verbose });
  }
  if (command === 'handoff') {
    if (rest.length > 1) throw new Error('Usage: yallaflow handoff [work-id]');
    return handoffCommand(rest[0]);
  }

  const workMap = { feature: 'feature', bug: 'bug', investigate: 'investigation', change: 'change', refactor: 'refactor', release: 'release' };
  if (workMap[command]) {
    const { values, positionals } = parseOptions(rest, {
      scope: { type: 'string' },
      complexity: { type: 'string' }
    });
    const title = positionals.join(' ').trim();
    if (!title) throw new Error(`${command} requires a title`);
    if (values.scope && values.complexity) throw new Error('Use --scope; do not provide both --scope and the legacy --complexity option.');
    const scope = values.scope ?? (values.complexity === 'unknown' ? undefined : values.complexity);
    if (scope && !SCOPES.includes(scope)) throw new Error('--scope must be spike, bounded, or architectural');
    return newWorkCommand(workMap[command], title, scope, command);
  }

  throw new Error(`Unknown command: ${command}`);
}

function reconcileCommand(args) {
  const [action, ...actionArgs] = args;
  const usage = (line) => new Error(`Usage: yallaflow context reconcile ${line}`);
  if (!action) return console.log(`Usage:\n  ${RECONCILE_USAGE}\n`);
  if (action === 'start') {
    if (actionArgs.length) throw usage('start');
    return reconcileStartCommand();
  }
  if (['status', 'preview', 'apply'].includes(action)) {
    const { positionals } = parseOptions(actionArgs, {});
    if (positionals.length > 1) throw usage(`${action} [work-id]`);
    return { status: reconcileStatusCommand, preview: reconcilePreviewCommand, apply: reconcileApplyCommand }[action](positionals[0]);
  }
  if (action === 'show') {
    const { values, positionals } = parseOptions(actionArgs, { candidate: { type: 'string' } });
    if (positionals.length > 1) throw usage('show [work-id] [--candidate RC-####]');
    return reconcileShowCommand(positionals[0], { candidate: values.candidate });
  }
  if (action === 'plan') {
    const { values, positionals } = parseOptions(actionArgs, { file: { type: 'string' } });
    if (positionals.length > 1 || !values.file) throw usage('plan [work-id] --file <decisions.json>');
    return reconcilePlanCommand(positionals[0], { file: values.file });
  }
  if (action === 'approve') {
    const { values, positionals } = parseOptions(actionArgs, { note: { type: 'string' } });
    if (positionals.length > 1) throw usage('approve [work-id] [--note TEXT]');
    return reconcileApproveCommand(positionals[0], { note: values.note });
  }
  if (action === 'feedback') {
    const { values, positionals } = parseOptions(actionArgs, { 'changes-requested': { type: 'boolean' }, note: { type: 'string' } });
    if (positionals.length > 1) throw usage('feedback [work-id] --changes-requested [--note TEXT]');
    return reconcileFeedbackCommand(positionals[0], { changesRequested: values['changes-requested'], note: values.note });
  }
  throw new Error(`Unknown context reconcile action: ${action}. Use start, status, show, plan, preview, approve, feedback, or apply.`);
}

// A reader that closes early (`yallaflow … | head`, `| grep -q`) is not an error: further
// output is discarded, and the command still runs to completion and exits with its own
// exit code (never cut short between state writes). Anything else still throws.
process.stdout.on('error', (error) => {
  if (error.code !== 'EPIPE') throw error;
  process.stdout.write = () => true;
});

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
