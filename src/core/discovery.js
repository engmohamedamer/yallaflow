import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { exists, writeText } from '../utils/fs.js';
import { workspacePath } from './workspace.js';

export async function deterministicDiscovery(root) {
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
  if (await exists(path.join(root, 'docker-compose.yml')) || await exists(path.join(root, 'compose.yaml'))) hints.push('Docker Compose detected');
  if (await exists(path.join(root, 'azure-pipelines.yml'))) hints.push('Azure Pipelines detected');
  if (await exists(path.join(root, '.github', 'workflows'))) hints.push('GitHub Actions detected');

  return { stack, hints };
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
    ''
  ];
  await writeText(path.join(workspacePath(root), 'context', 'tech-stack.md'), lines.join('\n'));
}
