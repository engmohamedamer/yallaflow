import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { exists, writeText } from '../utils/fs.js';
import { workspacePath } from './workspace.js';
import { describeHint } from '../inventory/frameworks.js';
import { TECH_STACK_HINT_LIMIT } from '../inventory/constants.js';
import { CONTAINER_CI_KINDS, inventoryRepository, listSome } from '../inventory/inventory.js';

export async function deterministicDiscovery(root, inventory = null) {
  inventory ??= await inventoryRepository(root);
  const stack = [];
  const hints = [];

  if (await exists(path.join(root, 'composer.json'))) {
    stack.push('PHP / Composer');
    const composer = JSON.parse(await readFile(path.join(root, 'composer.json'), 'utf8'));
    if (composer.require?.['laravel/framework']) stack.push(`Laravel ${composer.require['laravel/framework']}`);
    if (composer.require?.['yiisoft/yii2']) stack.push(`Yii2 ${composer.require['yiisoft/yii2']}`);
  }
  if (await exists(path.join(root, 'package.json'))) {
    stack.push('Node.js / JavaScript or TypeScript');
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const name of ['vue', 'react', 'next', 'vite', '@nestjs/core']) {
      if (deps[name]) stack.push(`${name} ${deps[name]}`);
    }
  }
  if (await exists(path.join(root, 'pyproject.toml'))) stack.push('Python / pyproject.toml');
  if (await exists(path.join(root, 'go.mod'))) stack.push('Go');
  if (await exists(path.join(root, 'Cargo.toml'))) stack.push('Rust');
  // v0.3.9: repository hints come from the same inventory truth that classifies the
  // project — only meaningful container/CI files, grouped by deterministic kind, with
  // their paths. Empty, comment-only, or unreadable files are not hints.
  for (const kind of CONTAINER_CI_KINDS) {
    const paths = inventory.containerCi.filter((entry) => entry.meaningful && entry.kind === kind).map((entry) => entry.path);
    if (paths.length) hints.push(`${kind} detected (${listSome(paths)})`);
  }

  // v0.3.9: framework hints from nested manifests (the root lines above are unchanged).
  const nested = [];
  for (const manifest of inventory.manifests) {
    if (!manifest.path.includes('/')) continue;
    for (const entry of manifest.frameworks) nested.push(`${describeHint(entry)} — ${manifest.path}`);
  }
  if (nested.length > TECH_STACK_HINT_LIMIT) {
    const more = nested.length - TECH_STACK_HINT_LIMIT;
    nested.splice(TECH_STACK_HINT_LIMIT, more, `… +${more} more — run \`yallaflow inspect\``);
  }

  return { stack, hints, nested };
}

export async function writeDiscovery(root, result) {
  const lines = [
    '# Tech Stack',
    '',
    '> Deterministically discovered during YallaFlow bootstrap. Confirm or refine durable details as work progresses.',
    '',
    '## Detected stack',
    '',
    ...(result.stack.length ? result.stack.map((v) => `- ${v}`) : ['- No framework marker detected yet.']),
    '',
    '## Repository hints',
    '',
    ...(result.hints.length ? result.hints.map((v) => `- ${v}`) : ['- No CI/container marker detected yet.']),
    '',
    ...(result.nested?.length ? [
      '## Nested manifest framework hints',
      '',
      '> Init-time deterministic bootstrap snapshot of manifest declarations — NOT approved project memory. Never refreshed; run `yallaflow inspect` for the current repository state.',
      '',
      ...result.nested.map((v) => `- ${v}`),
      ''
    ] : [])
  ];
  await writeText(path.join(workspacePath(root), 'context', 'tech-stack.md'), lines.join('\n'));
}
