// Runtime suggestions (1.4.0): candidate service definitions derived from repository
// evidence. Data only: a suggestion is never started. The developer adds it explicitly
// (`yallaflow runtime add --from-suggestion N`) and trusts it before anything runs.
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { inventoryRepository } from '../inventory/inventory.js';
import { MAX_MANIFEST_BYTES } from '../inventory/constants.js';

const exists = async (file) => { try { return (await lstat(file)).isFile(); } catch { return false; } };

function serviceId(base, taken) {
  let id = base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'service';
  if (!/^[a-z]/.test(id)) id = `s-${id}`;
  let candidate = id;
  for (let n = 2; taken.has(candidate); n++) candidate = `${id}-${n}`;
  taken.add(candidate);
  return candidate;
}

export async function suggestServices(root, { existing = [] } = {}) {
  const inventory = await inventoryRepository(root);
  const taken = new Set(existing.map((service) => service.id));
  const suggestions = [];
  const dirOf = (relative) => (path.posix.dirname(relative) === '.' ? '.' : path.posix.dirname(relative));

  for (const manifest of inventory.manifests) {
    const dir = dirOf(manifest.path);
    const at = (name) => (dir === '.' ? name : `${dir}/${name}`);
    if (manifest.name === 'composer.json' && (manifest.frameworks ?? []).some((hint) => hint.framework === 'Laravel') && await exists(path.join(root, at('artisan')))) {
      suggestions.push({ id: serviceId(dir === '.' ? 'laravel' : `laravel-${dir}`, taken), name: 'Laravel development server', kind: 'process', command: ['php', 'artisan', 'serve', '--host=127.0.0.1', '--port=8000'], cwd: dir, env: [], ports: [8000], ready: { port: 8000 }, evidence: [manifest.path, at('artisan')] });
    }
    if (manifest.name === 'package.json' && !manifest.unreadable) {
      let pkg;
      try {
        const text = await readFile(path.join(root, manifest.path), 'utf8');
        if (text.length > MAX_MANIFEST_BYTES) continue;
        pkg = JSON.parse(text.replace(/^﻿/, ''));
      } catch {
        continue;
      }
      const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
      const manager = await exists(path.join(root, at('pnpm-lock.yaml'))) ? 'pnpm' : await exists(path.join(root, at('yarn.lock'))) ? 'yarn' : 'npm';
      for (const script of ['dev', 'start']) {
        if (typeof scripts[script] !== 'string') continue;
        suggestions.push({
          id: serviceId(dir === '.' ? `node-${script}` : `${dir}-${script}`, taken),
          name: `${manager} run ${script}${dir === '.' ? '' : ` (${dir})`}`,
          kind: 'process',
          command: manager === 'yarn' ? ['yarn', script] : [manager, 'run', script],
          cwd: dir, env: [], ports: [], ready: null,
          evidence: [`${manifest.path}#scripts.${script}`],
          note: 'A package script can run any command; review what it does before trusting it.'
        });
        break; // one Node suggestion per module: dev, else start
      }
    }
  }
  for (const config of inventory.containerCi) {
    if (config.kind !== 'Docker Compose' || !config.meaningful) continue;
    const dir = dirOf(config.path);
    suggestions.push({ id: serviceId(dir === '.' ? 'compose' : `compose-${dir}`, taken), name: 'Docker Compose services', kind: 'docker-compose', command: ['docker', 'compose', '-f', path.posix.basename(config.path), 'up'], cwd: dir, env: [], ports: [], ready: null, stopSignal: 'SIGINT', evidence: [config.path], note: 'Stopping sends Ctrl-C to `docker compose up`, which stops these containers; containers YallaFlow did not start are never touched.' });
  }
  return suggestions;
}
