#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { initCommand } from './commands/init.js';
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';
import { resumeCommand } from './commands/resume.js';
import { doctorCommand } from './commands/doctor.js';
import { newWorkCommand } from './commands/work.js';
import { advanceCommand } from './commands/advance.js';
import { verifyCommand, verifyListCommand, verifyScriptCommand, verifyShellCommand } from './commands/verify.js';
import { routeCommand } from './commands/route.js';
import { guideCommand } from './commands/guide.js';
import { skillCommand } from './commands/skill.js';
import { checkpointCommand, reviseCheckpointCommand } from './commands/checkpoint.js';
import { knowledgeCommand } from './commands/knowledge.js';
import { questionCommand } from './commands/question.js';
import { readyCommand } from './commands/ready.js';
import { intakeAddCommand, intakeCommand } from './commands/intake.js';
import { sourceCommand } from './commands/source.js';
import { reopenCommand } from './commands/reopen.js';
import { decomposeExecuteCommand, decomposeProposeCommand, decomposeStatusCommand, decomposeValidateCommand } from './commands/decompose.js';
import { projectProgressCommand } from './commands/progress.js';
import { nextCommand } from './commands/next.js';
import { approveCommand, feedbackCommand } from './commands/review.js';
import { handoffCommand } from './commands/handoff.js';
import { requestReviseCommand } from './commands/request.js';
import {
  contextAdoptCommand,
  contextAffectedCommand,
  contextHistoryCommand,
  contextListCommand,
  contextRenderCommand,
  contextShowCommand,
  contextStatusCommand
} from './commands/context.js';
import { limitationCommand } from './commands/limitation.js';
import { agentRefreshCommand, agentStatusCommand } from './commands/agent.js';
import {
  baselineApproveCommand,
  baselineDraftCommand,
  baselineFeedbackCommand,
  baselineShowCommand,
  baselineStartCommand,
  baselineStatusCommand
} from './commands/baseline.js';
import { SCOPES } from './behavior/constants.js';
import { INTERACTION_MODES, GATE_NAMES } from './behavior/interaction.js';

const VALID_PROJECT_TYPES = new Set(['greenfield', 'brownfield']);

function help() {
  console.log(`YallaFlow foundation CLI\n\nGive AI your project, not just your prompt.\n\nUsage:\n  yallaflow init [--name NAME] [--type greenfield|brownfield] [--mode autonomous|adaptive|gated]\n  yallaflow start [request]\n  yallaflow request --help\n  yallaflow intake <file> [<file> ...] [--title TITLE]\n  yallaflow intake add <work-id> <file> [<file> ...] [--reason TEXT]\n  yallaflow source --help\n  yallaflow route <work-id> --type TYPE --scope SCOPE --confidence LEVEL --reason REASON [--title TITLE]\n  yallaflow baseline --help\n  yallaflow guide [work-id]\n  yallaflow ready [work-id]\n  yallaflow skill <skill-id>\n  yallaflow checkpoint --help\n  yallaflow question --help\n  yallaflow knowledge --help\n  yallaflow context --help\n  yallaflow limitation --help\n  yallaflow agent --help\n  yallaflow decompose --help\n  yallaflow progress <parent-id>\n  yallaflow next <parent-id>\n  yallaflow approve <work-id> --stage GATE [--note TEXT]\n  yallaflow feedback <work-id> --stage GATE --changes-requested [--note TEXT]\n  yallaflow handoff [work-id]\n  yallaflow feature <title> --scope SCOPE\n  yallaflow bug <title> --scope SCOPE\n  yallaflow investigate <title> --scope SCOPE\n  yallaflow change <title> --scope SCOPE\n  yallaflow refactor <title> --scope SCOPE\n  yallaflow release <title> --scope SCOPE\n  yallaflow status\n  yallaflow resume [work-id]\n  yallaflow doctor\n  yallaflow advance [work-id]\n  yallaflow verify [work-id] -- <executable> [args...]\n  yallaflow verify [work-id] --shell "<command>"\n  yallaflow verify [work-id] --script <path>\n  yallaflow verify list [work-id]\n  yallaflow reopen <work-id> --to implementation|verification|review --reason REASON\n  yallaflow --version\n`);
}

function decomposeHelp() {
  console.log(`Usage:\n  yallaflow decompose propose <parent-id> --file <decomposition.json>\n  yallaflow decompose validate <parent-id>\n  yallaflow decompose execute <parent-id>\n  yallaflow decompose status <parent-id>\n\nGate names (for approve/feedback): ${GATE_NAMES.join(', ')}\n`);
}

function baselineHelp() {
  console.log(`Usage:\n  yallaflow baseline start\n  yallaflow baseline draft <work-id> --file <baseline.json>\n  yallaflow baseline status [work-id]\n  yallaflow baseline show [work-id]\n  yallaflow baseline approve <work-id> [--note TEXT]\n  yallaflow baseline feedback <work-id> --changes-requested [--note TEXT]\n`);
}

const CONTEXT_USAGE = 'yallaflow context status\n  yallaflow context list [--area AREA] [--all]\n  yallaflow context show <CTX-id>\n  yallaflow context history <CTX-id>\n  yallaflow context affected [--since REF] [path ...]\n  yallaflow context adopt [--dry-run]\n  yallaflow context render';
const AGENT_USAGE = 'yallaflow agent status\n  yallaflow agent refresh [--preserve-existing] [--dry-run]';
const LIMITATION_USAGE = 'yallaflow limitation add [work-id] --type TYPE --area AREA --summary TEXT --reason TEXT\n  yallaflow limitation list [work-id]';

function contextHelp() {
  console.log(`Usage:\n  ${CONTEXT_USAGE}\n\nProject memory lives in .yallaflow/context/index.yaml; context/*.md is its projection.\nEvolve facts through work: yallaflow knowledge propose ... --supersedes|--reconfirms|--disputes CTX-####\n`);
}

function agentHelp() {
  console.log(`Usage:\n  ${AGENT_USAGE}\n\nAGENT.md is project-owned; YallaFlow manages only its marked agent-contract block and never rewrites it automatically.\n`);
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
  start: 'yallaflow start [request]',
  intake: 'yallaflow intake <file> [<file> ...] [--title TITLE]\n  yallaflow intake add <work-id> <file> [<file> ...] [--reason TEXT]',
  guide: 'yallaflow guide [work-id]',
  skill: 'yallaflow skill <skill-id>',
  route: 'yallaflow route <work-id> --type TYPE --scope SCOPE --confidence LEVEL --reason REASON [--title TITLE]',
  status: 'yallaflow status',
  resume: 'yallaflow resume [work-id]',
  ready: 'yallaflow ready [work-id]',
  doctor: 'yallaflow doctor',
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
  limitation: LIMITATION_USAGE,
  agent: AGENT_USAGE,
  baseline: 'yallaflow baseline start\n  yallaflow baseline draft <work-id> --file <baseline.json>\n  yallaflow baseline status [work-id]\n  yallaflow baseline show [work-id]\n  yallaflow baseline approve <work-id> [--note TEXT]\n  yallaflow baseline feedback <work-id> --changes-requested [--note TEXT]',
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
  baseline: {
    start: 'yallaflow baseline start',
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
    render: 'yallaflow context render'
  },
  agent: {
    status: 'yallaflow agent status',
    refresh: 'yallaflow agent refresh [--preserve-existing] [--dry-run]'
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
    add: 'yallaflow intake add <work-id> <file> [<file> ...] [--reason TEXT]'
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
  if (!PAYLOAD_BOUNDARY_COMMANDS.has(command)) return rest;
  const sepIndex = rest.indexOf('--');
  return sepIndex === -1 ? rest : rest.slice(0, sepIndex);
}

function printCommandHelp(command, rest) {
  const actionKey = rest.find((token) => !isHelpToken(token) && !token.startsWith('-'));
  const nested = NAMESPACE_ACTIONS[command]?.[actionKey];
  if (nested) return console.log(`Usage:\n  ${nested}\n`);
  const dedicated = { agent: agentHelp, context: contextHelp, limitation: limitationHelp, source: sourceHelp, checkpoint: checkpointHelp, knowledge: knowledgeHelp, question: questionHelp, decompose: decomposeHelp, baseline: baselineHelp };
  if (dedicated[command]) return dedicated[command]();
  if (USAGE[command]) return console.log(`Usage:\n  ${USAGE[command]}\n`);
  return help();
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') return help();
  if (command === '--version' || command === '-v') return console.log('0.3.6-internal.1');
  // Asking for help never mutates YallaFlow state, for any command/sub-action, at any
  // position within YallaFlow's own arguments — but never crosses a documented `--`
  // payload boundary into a child command's own argv (see helpScanScope above). This,
  // plus the per-namespace usage table above, is the entire help strategy; no
  // scattered per-branch exceptions are needed or present.
  if (helpScanScope(command, rest).some(isHelpToken)) return printCommandHelp(command, rest);

  if (command === 'init') {
    const { values } = parseOptions(rest, { name: { type: 'string' }, type: { type: 'string' }, mode: { type: 'string' } });
    if (values.type && !VALID_PROJECT_TYPES.has(values.type)) throw new Error('--type must be greenfield or brownfield');
    if (values.mode && !INTERACTION_MODES.includes(values.mode)) throw new Error(`--mode must be one of: ${INTERACTION_MODES.join(', ')}`);
    return initCommand({ name: values.name, type: values.type, mode: values.mode });
  }

  if (command === 'start') return startCommand(rest.join(' '));
  if (command === 'request') {
    const [action, ...actionArgs] = rest;
    if (action !== 'revise') throw new Error('Usage: yallaflow request revise <work-id> --text TEXT --reason TEXT');
    const { values, positionals } = parseOptions(actionArgs, { text: { type: 'string' }, reason: { type: 'string' } });
    if (positionals.length !== 1) throw new Error('Usage: yallaflow request revise <work-id> --text TEXT --reason TEXT');
    return requestReviseCommand(positionals[0], { text: values.text, reason: values.reason });
  }
  if (command === 'intake') {
    if (rest[0] === 'add') {
      const { values, positionals } = parseOptions(rest.slice(1), { reason: { type: 'string' } });
      if (positionals.length < 2) throw new Error('Usage: yallaflow intake add <work-id> <file> [<file> ...] [--reason TEXT]');
      const [workId, ...files] = positionals;
      return intakeAddCommand(workId, files, { reason: values.reason });
    }
    const { values, positionals } = parseOptions(rest, { title: { type: 'string' } });
    if (positionals.length < 1) throw new Error('Usage: yallaflow intake <file> [<file> ...] [--title TITLE]');
    return intakeCommand(positionals, { title: values.title });
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
    if (rest.length !== 1) throw new Error('Usage: yallaflow skill <skill-id>');
    return skillCommand(rest[0]);
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
  if (command === 'resume') {
    if (rest.length > 1) throw new Error('Usage: yallaflow resume [work-id]');
    return resumeCommand(rest[0]);
  }
  if (command === 'ready') {
    if (rest.length > 1) throw new Error('Usage: yallaflow ready [work-id]');
    return readyCommand(rest[0]);
  }
  if (command === 'doctor') return doctorCommand();
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
    if (positionals.length !== 1) throw new Error('Usage: yallaflow reopen <work-id> --to implementation|verification|review --reason "..."');
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
      if (actionArgs.length) throw new Error('Usage: yallaflow baseline start');
      return baselineStartCommand();
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
    throw new Error(`Unknown context action: ${action}. Use status, list, show, history, affected, adopt, or render.`);
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
    throw new Error(`Unknown agent action: ${action}. Use status or refresh.`);
  }
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
