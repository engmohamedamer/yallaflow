#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { initCommand } from './commands/init.js';
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';
import { resumeCommand } from './commands/resume.js';
import { doctorCommand } from './commands/doctor.js';
import { newWorkCommand } from './commands/work.js';
import { advanceCommand } from './commands/advance.js';
import { verifyCommand } from './commands/verify.js';
import { routeCommand } from './commands/route.js';
import { guideCommand } from './commands/guide.js';
import { skillCommand } from './commands/skill.js';
import { checkpointCommand, reviseCheckpointCommand } from './commands/checkpoint.js';
import { knowledgeCommand } from './commands/knowledge.js';
import { questionCommand } from './commands/question.js';
import { readyCommand } from './commands/ready.js';
import { intakeAddCommand, intakeCommand } from './commands/intake.js';
import { sourceCommand } from './commands/source.js';
import { SCOPES } from './behavior/constants.js';

const VALID_PROJECT_TYPES = new Set(['greenfield', 'brownfield']);

function help() {
  console.log(`YallaFlow foundation CLI\n\nGive AI your project, not just your prompt.\n\nUsage:\n  yallaflow init [--name NAME] [--type greenfield|brownfield]\n  yallaflow start [request]\n  yallaflow intake <file> [<file> ...] [--title TITLE]\n  yallaflow intake add <work-id> <file> [<file> ...]\n  yallaflow source --help\n  yallaflow route <work-id> --type TYPE --scope SCOPE --confidence LEVEL --reason REASON [--title TITLE]\n  yallaflow guide [work-id]\n  yallaflow ready [work-id]\n  yallaflow skill <skill-id>\n  yallaflow checkpoint --help\n  yallaflow question --help\n  yallaflow knowledge --help\n  yallaflow feature <title> [--scope VALUE]\n  yallaflow bug <title> [--scope VALUE]\n  yallaflow investigate <title> [--scope VALUE]\n  yallaflow change <title> [--scope VALUE]\n  yallaflow refactor <title> [--scope VALUE]\n  yallaflow release <title> [--scope VALUE]\n  yallaflow status\n  yallaflow resume\n  yallaflow doctor\n  yallaflow advance\n  yallaflow verify -- <command>\n  yallaflow --version\n`);
}

function sourceHelp() {
  console.log(`Usage:\n  yallaflow source list\n  yallaflow source show <source-id> [--content]\n`);
}

function checkpointHelp() {
  console.log(`Usage:\n  yallaflow checkpoint [work-id] --skill SKILL --status STATUS [--summary TEXT] [--evidence REF]\n  yallaflow checkpoint [work-id] --skill SKILL --start\n  yallaflow checkpoint [work-id] --skill SKILL --complete --summary TEXT [--evidence REF]\n  yallaflow checkpoint revise [work-id] --skill SKILL --status STATUS --reason TEXT [--summary TEXT]\n  yallaflow checkpoint [work-id] --ruling DECISION --ruling-reason WHY --cost-if-wrong IMPACT\n`);
}

function knowledgeHelp() {
  console.log(`Usage:\n  yallaflow knowledge propose [work-id] --kind KIND --source design-spec|implementation-runtime --summary TEXT --evidence REF\n  yallaflow knowledge list [work-id]\n  yallaflow knowledge promote [work-id] --candidate ID\n  yallaflow knowledge reject [work-id] --candidate ID --reason TEXT\n  yallaflow knowledge review [work-id] --none\n`);
}

function questionHelp() {
  console.log(`Usage:\n  yallaflow question add [work-id] --category business|architecture --text TEXT [--proposal TEXT] [--non-material]\n  yallaflow question list [work-id]\n  yallaflow question answer [work-id] --id Q-001 --answer TEXT\n  yallaflow question resolve [work-id] --id Q-001 [--resolution TEXT]\n`);
}

function parseOptions(args, allowed) {
  return parseArgs({ args, options: allowed, allowPositionals: true, strict: true });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') return help();
  if (command === '--version' || command === '-v') return console.log('0.3.0-internal.2');

  if (command === 'init') {
    const { values } = parseOptions(rest, { name: { type: 'string' }, type: { type: 'string' } });
    if (values.type && !VALID_PROJECT_TYPES.has(values.type)) throw new Error('--type must be greenfield or brownfield');
    return initCommand({ name: values.name, type: values.type });
  }

  if (command === 'start') return startCommand(rest.join(' '));
  if (command === 'intake') {
    if (rest[0] === 'add') {
      const { positionals } = parseOptions(rest.slice(1), {});
      if (positionals.length < 2) throw new Error('Usage: yallaflow intake add <work-id> <file> [<file> ...]');
      const [workId, ...files] = positionals;
      return intakeAddCommand(workId, files);
    }
    const { values, positionals } = parseOptions(rest, { title: { type: 'string' } });
    if (positionals.length < 1) throw new Error('Usage: yallaflow intake <file> [<file> ...] [--title TITLE]');
    return intakeCommand(positionals, { title: values.title });
  }
  if (command === 'source') {
    if (rest[0] === '--help' || rest[0] === '-h') return sourceHelp();
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
    if (rest[0] === '--help' || rest[0] === '-h') return checkpointHelp();
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
    if (rest[0] === '--help' || rest[0] === '-h') return knowledgeHelp();
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
        'from-ruling': { type: 'string' }
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
        fromRuling: values['from-ruling']
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
    if (rest[0] === '--help' || rest[0] === '-h') return questionHelp();
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
  if (command === 'resume') return resumeCommand();
  if (command === 'ready') {
    if (rest.length > 1) throw new Error('Usage: yallaflow ready [work-id]');
    return readyCommand(rest[0]);
  }
  if (command === 'doctor') return doctorCommand();
  if (command === 'advance') return advanceCommand();
  if (command === 'verify') {
    const parts = rest[0] === '--' ? rest.slice(1) : rest;
    return verifyCommand(parts);
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
    return newWorkCommand(workMap[command], title, scope);
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
