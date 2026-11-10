// PF-0112 test support: drives one work item to DONE through YallaFlow's own commands, the
// way an agent following `yallaflow guide` would (checkpoints, verification, knowledge review,
// advance). Only for disposable test workspaces; it never decides a review gate.
// Lives outside test/ because node --test loads every file under test/.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const run = (root, args) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' });

export function driveToDone(root, workId, { maxSteps = 60 } = {}) {
  for (let step = 0; step < maxSteps; step++) {
    const guide = run(root, ['guide', workId]).stdout;
    if (/^Stage: DONE$/m.test(guide)) return;
    const next = (/NEXT VALID ACTION:\n(.+)/.exec(guide) ?? [])[1]?.trim() ?? '';
    let args;
    if (/^yallaflow advance /.test(next)) args = ['advance', workId];
    else if (/^yallaflow checkpoint .*--skill (\S+)/.test(next)) args = ['checkpoint', workId, '--skill', /--skill (\S+)/.exec(next)[1], '--complete', '--summary', 'Done in a test workspace.'];
    else if (/knowledge (?:review|propose)/.test(next)) args = ['knowledge', 'review', workId, '--none'];
    else if (/^yallaflow verify/.test(next)) args = ['verify', workId, '--', process.execPath, '-e', 'process.exit(0)'];
    else if (/approve .*--stage/.test(next)) throw new Error(`${workId} waits for a review gate; driveToDone never decides one (${next}).`);
    else args = ['advance', workId];
    const result = run(root, args);
    if (result.status !== 0 && args[0] === 'advance') {
      const text = `${result.stdout}${result.stderr}`;
      if (/knowledge review/.test(text)) run(root, ['knowledge', 'review', workId, '--none']);
      else if (/verification/.test(text)) run(root, ['verify', workId, '--', process.execPath, '-e', 'process.exit(0)']);
    }
  }
  throw new Error(`${workId} did not reach DONE in ${maxSteps} steps:\n${run(root, ['guide', workId]).stdout}`);
}
