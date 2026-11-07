import { killAllAgentsNow } from '../agents/acp.js';
import { CLAUDE_NOT_INCLUDED, claudeIncluded } from '../agents/experimental.js';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { findProjectRoot } from '../core/workspace.js';
import { startConsoleServer } from '../console/server.js';
import { addProject, loadRegistry, registryPath, removeProject } from '../console/registry.js';
import { exists } from '../utils/fs.js';

const DEFAULT_PORT = 4747;

// `yallaflow console`: a local web view of one or more workspaces (v1.2.0). Its only
// write is Create Work, through this package's own CLI; --read-only turns it off. It runs
// no agent and stops with Ctrl-C (no daemon).
// Projects shown: the current workspace (if any), every --project, then the saved list
// (`yallaflow console add|remove|list`). A saved project whose folder is gone is reported
// as unavailable, never dropped silently.
export async function consoleCommand({ port, open = true, projects = [], poll = false, readOnly = false, agents = false, experimentalClaude = false } = {}) {
  if (readOnly && agents) throw new Error('--agents needs writes; it cannot be combined with --read-only.');
  if (experimentalClaude && !agents) throw new Error('--experimental-claude needs --agents.');
  if (experimentalClaude && !claudeIncluded()) throw new Error(CLAUDE_NOT_INCLUDED);
  const roots = [];
  const missing = [];
  const here = await findProjectRoot(process.cwd());
  if (here) roots.push(here);
  for (const start of projects) {
    const root = await findProjectRoot(path.resolve(start));
    if (!root) throw new Error(`No .yallaflow workspace found at ${start}. Run \`yallaflow init\` there first.`);
    if (!roots.includes(root)) roots.push(root);
  }
  for (const entry of (await loadRegistry()).projects) {
    if (roots.includes(entry.root)) continue;
    if (await exists(path.join(entry.root, '.yallaflow'))) roots.push(entry.root);
    else missing.push(entry.root);
  }
  // 1.4.0 (PF-0057): with no project yet, a normal console starts on New project, so the
  // first project can be created from the browser. A read-only console has nothing to show.
  if (!roots.length && readOnly) throw new Error('No YallaFlow project to show. Run it inside a project, pass --project DIR, or save one with `yallaflow console add DIR`.');
  const server = await listen(roots, port, poll, missing, readOnly, { agents, experimentalClaude });
  const link = `${server.url}#token=${server.token}`;
  console.log(readOnly ? 'YallaFlow console is running (read-only).' : 'YallaFlow console is running. It changes things only when you confirm an action on the page (--read-only turns every change off).');
  if (server.agents?.enabled) console.log(`Agent Workspace: on (Codex${server.agents.claude ? ', Claude Code experimental' : ''}). Agents use your own subscriptions; YallaFlow never uses API keys.`);
  console.log(`\nOpen: ${link}\n`);
  for (const project of server.projects) console.log(`Project: ${project.name} (${project.root})`);
  if (!server.projects.length) console.log('No projects yet: open the link to create one, or add an existing project from the page.');
  for (const root of missing) console.log(`Unavailable (folder or workspace missing): ${root}`);
  console.log(`Live updates: ${server.watchModes.includes('poll') ? 'polling every 2 s' : 'file watcher'}`);
  console.log('The link carries a private token for this run only. Press Ctrl-C to stop.');
  if (open) openBrowser(link);

  // Agent processes run in their own process group, so the terminal's signals do not reach
  // them: the console ends them. A second Ctrl-C while stopping, or a closed terminal
  // (SIGHUP), kills every agent group at once instead of leaving it behind.
  let stopping = false;
  await new Promise((resolve) => {
    const stop = () => {
      if (stopping) {
        killAllAgentsNow();
        process.exit(130);
      }
      stopping = true;
      resolve();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    process.on('SIGHUP', stop);
  });
  process.once('exit', killAllAgentsNow);
  const incomplete = await server.close();
  for (const entry of incomplete ?? []) {
    console.log(entry.cleanup.verified === false
      ? `\nWarning: the Codex adapter in ${entry.project} was stopped, but on this system YallaFlow cannot check the processes it started. Check them yourself.`
      : `\nWarning: a Codex session in ${entry.project} was ended, but these processes it started are still running and could not be stopped: ${entry.cleanup.survivors.join(', ')}. Check them yourself (for example with \`ps -p <pid>\`).`);
  }
  console.log('\nConsole stopped.');
}

async function listen(roots, port, poll, missing, readOnly, extra = {}) {
  if (port !== undefined) return startConsoleServer({ roots, port, poll, missing, readOnly, ...extra });
  for (let candidate = DEFAULT_PORT; candidate < DEFAULT_PORT + 10; candidate++) {
    try {
      return await startConsoleServer({ roots, port: candidate, poll, missing, readOnly, ...extra });
    } catch (error) {
      if (error.code !== 'EADDRINUSE') throw error;
    }
  }
  return startConsoleServer({ roots, port: 0, poll, missing, readOnly, ...extra });
}

function openBrowser(url) {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // no browser launcher: the link above is enough
  }
}

// `yallaflow console add [DIR] | remove DIR | list`: the saved project list (user-level
// file; no project state is written).
export async function consoleProjectsCommand(action, dir) {
  if (action === 'add') {
    const result = await addProject(dir ?? process.cwd());
    console.log(result.added ? `Added ${result.root} to the console.` : `${result.root} is already in the console.`);
    return;
  }
  if (action === 'remove') {
    if (!dir) throw new Error('Usage: yallaflow console remove <dir>');
    const result = await removeProject(dir);
    console.log(result.removed ? `Removed ${result.root} from the console (its files are untouched).` : `${result.root} was not in the console.`);
    return;
  }
  const registry = await loadRegistry();
  console.log(`Saved console projects (${registryPath()}):`);
  if (!registry.projects.length) console.log('  none — add one with `yallaflow console add DIR`');
  for (const entry of registry.projects) console.log(`  ${entry.root}${await exists(path.join(entry.root, '.yallaflow')) ? '' : '  (unavailable)'}`);
}
