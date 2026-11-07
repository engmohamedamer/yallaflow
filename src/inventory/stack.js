// Evidence-based technology-stack detection (1.4.0, read-only).
//
// Every entry names the file that supports it and a basis:
//   declared  a manifest or config file states it (a dependency, a runtime constraint,
//             a container image). It is a declaration, not proof that the code uses it.
//   detected  a file's presence shows it (a lockfile, a Dockerfile, a CI workflow).
//   inferred  counted, not read (source files by extension).
// Nothing is executed and no lockfile is resolved. Environment files are never opened:
// only manifests, compose files and Dockerfiles are read, size-capped, and only names,
// image references and version constraints are taken from them. A missing or unreadable
// input is reported, never guessed.
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { MAX_CONFIG_BYTES, MAX_MANIFEST_BYTES } from './constants.js';

export const STACK_BASIS = Object.freeze(['declared', 'detected', 'inferred']);

// Manifest → ecosystem. A manifest says which toolchain a module uses.
const ECOSYSTEM = Object.freeze({
  'package.json': 'Node.js',
  'composer.json': 'PHP',
  'pyproject.toml': 'Python',
  'requirements.txt': 'Python',
  'setup.py': 'Python',
  'go.mod': 'Go',
  'Cargo.toml': 'Rust',
  'pom.xml': 'Java (Maven)',
  'build.gradle': 'JVM (Gradle)',
  'build.gradle.kts': 'JVM (Gradle)',
  Gemfile: 'Ruby',
  'pubspec.yaml': 'Dart',
  'mix.exs': 'Elixir',
  'angular.json': 'Node.js'
});

// Lockfiles by ecosystem; two package-manager lockfiles in one module conflict.
const LOCKFILES = Object.freeze({
  'Node.js': ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock'],
  PHP: ['composer.lock'],
  Python: ['poetry.lock', 'Pipfile.lock', 'uv.lock'],
  Rust: ['Cargo.lock'],
  Go: ['go.sum'],
  Ruby: ['Gemfile.lock'],
  Dart: ['pubspec.lock'],
  Elixir: ['mix.lock']
});

// Source extensions → language (inferred from counts only).
const LANGUAGE = Object.freeze({
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.vue': 'Vue SFC', '.svelte': 'Svelte',
  '.php': 'PHP', '.py': 'Python', '.rb': 'Ruby', '.go': 'Go', '.rs': 'Rust',
  '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin', '.scala': 'Scala', '.groovy': 'Groovy',
  '.cs': 'C#', '.fs': 'F#', '.vb': 'Visual Basic', '.swift': 'Swift', '.m': 'Objective-C', '.mm': 'Objective-C',
  '.c': 'C', '.h': 'C/C++', '.cc': 'C++', '.cpp': 'C++', '.cxx': 'C++', '.hpp': 'C++',
  '.dart': 'Dart', '.ex': 'Elixir', '.exs': 'Elixir', '.erl': 'Erlang', '.clj': 'Clojure', '.lua': 'Lua'
});

// Well-known service images → a readable component name. Anything else keeps its image name.
const SERVICE_IMAGES = Object.freeze([
  [/^(?:.*\/)?mysql$/, 'MySQL', 'database'],
  [/^(?:.*\/)?mariadb$/, 'MariaDB', 'database'],
  [/^(?:.*\/)?postgres(?:ql)?$/, 'PostgreSQL', 'database'],
  [/^(?:.*\/)?postgis\/postgis$/, 'PostgreSQL (PostGIS)', 'database'],
  [/^(?:.*\/)?mongo$/, 'MongoDB', 'database'],
  [/^(?:.*\/)?(?:mcr\.microsoft\.com\/)?mssql\/server$/, 'SQL Server', 'database'],
  [/^(?:.*\/)?redis$/, 'Redis', 'cache'],
  [/^(?:.*\/)?valkey\/valkey$/, 'Valkey', 'cache'],
  [/^(?:.*\/)?memcached$/, 'Memcached', 'cache'],
  [/^(?:.*\/)?rabbitmq$/, 'RabbitMQ', 'queue'],
  [/^(?:.*\/)?(?:elasticsearch|elasticsearch\/elasticsearch)$/, 'Elasticsearch', 'search'],
  [/^(?:.*\/)?opensearch(?:project\/opensearch)?$/, 'OpenSearch', 'search'],
  [/^(?:.*\/)?getmeili\/meilisearch$/, 'Meilisearch', 'search'],
  [/^(?:.*\/)?(?:axllent\/)?mailpit$/, 'Mailpit', 'mail'],
  [/^(?:.*\/)?mailhog\/mailhog$/, 'MailHog', 'mail'],
  [/^(?:.*\/)?minio\/minio$/, 'MinIO', 'storage'],
  [/^(?:.*\/)?nginx$/, 'nginx', 'web server'],
  [/^(?:.*\/)?httpd$/, 'Apache httpd', 'web server'],
  [/^(?:.*\/)?node$/, 'Node.js', 'runtime'],
  [/^(?:.*\/)?php$/, 'PHP', 'runtime'],
  [/^(?:.*\/)?python$/, 'Python', 'runtime']
]);

async function readCapped(file, limit) {
  const info = await lstat(file);
  if (!info.isFile()) throw new Error('not a regular file');
  if (info.size > limit) throw Object.assign(new Error(`larger than ${limit} bytes; not read`), { code: 'TOO_LARGE' });
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(info.size);
    const { bytesRead } = await handle.read(buffer, 0, info.size, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function exists(file) {
  try {
    return (await lstat(file)).isFile();
  } catch {
    return false;
  }
}

function json(text) {
  const value = JSON.parse(text.replace(/^﻿/, ''));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not a JSON object');
  return value;
}

// Only short version-like strings are reported; anything else is not echoed.
function versionText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= 64 && /^[0-9A-Za-z.^~<>=*|, x-]+$/.test(text) ? text : null;
}

function runtimeDeclarations(name, text) {
  const out = [];
  if (name === 'package.json') {
    const pkg = json(text);
    const node = versionText(pkg.engines?.node);
    if (node) out.push({ component: 'Node.js', kind: 'runtime', declared: node, locator: 'engines.node' });
    const manager = typeof pkg.packageManager === 'string' ? /^(npm|pnpm|yarn|bun)@([0-9][0-9A-Za-z.+-]{0,40})/.exec(pkg.packageManager) : null;
    if (manager) out.push({ component: manager[1], kind: 'package manager', declared: manager[2], locator: 'packageManager' });
    if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) out.push({ component: 'TypeScript', kind: 'language', declared: versionText(pkg.devDependencies?.typescript ?? pkg.dependencies?.typescript), locator: 'typescript dependency' });
  } else if (name === 'composer.json') {
    const composer = json(text);
    const php = versionText(composer.require?.php);
    if (php) out.push({ component: 'PHP', kind: 'runtime', declared: php, locator: 'require.php' });
  } else if (name === 'pyproject.toml') {
    const python = /^\s*requires-python\s*=\s*["']([^"']{1,64})["']/m.exec(text)?.[1];
    if (versionText(python)) out.push({ component: 'Python', kind: 'runtime', declared: versionText(python), locator: 'requires-python' });
    for (const [pattern, framework] of [[/["']?django\b/i, 'Django'], [/["']?fastapi\b/i, 'FastAPI'], [/["']?flask\b/i, 'Flask']]) {
      if (pattern.test(text)) out.push({ component: framework, kind: 'framework', declared: null, locator: 'dependency reference' });
    }
  } else if (name === 'requirements.txt') {
    for (const [pattern, framework] of [[/^django\b/im, 'Django'], [/^fastapi\b/im, 'FastAPI'], [/^flask\b/im, 'Flask']]) {
      if (pattern.test(text)) out.push({ component: framework, kind: 'framework', declared: null, locator: 'requirement line' });
    }
  } else if (name === 'go.mod') {
    const go = /^go\s+([0-9][0-9.]{0,20})\s*$/m.exec(text)?.[1];
    if (go) out.push({ component: 'Go', kind: 'runtime', declared: go, locator: 'go directive' });
  } else if (name === 'Gemfile') {
    const ruby = /^\s*ruby\s+["']([^"']{1,40})["']/m.exec(text)?.[1];
    if (versionText(ruby)) out.push({ component: 'Ruby', kind: 'runtime', declared: versionText(ruby), locator: 'ruby directive' });
    if (/^\s*gem\s+["']rails["']/m.test(text)) out.push({ component: 'Ruby on Rails', kind: 'framework', declared: null, locator: 'gem rails' });
  }
  return out;
}

// `image:` values from compose files only. Environment blocks are never parsed.
export function composeImages(text) {
  const images = [];
  for (const [, raw] of text.matchAll(/^\s*image\s*:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/gm)) {
    if (raw.includes('${')) {
      images.push({ image: null, tag: null, unresolved: true });
      continue;
    }
    const at = raw.split('@')[0];
    const slash = at.lastIndexOf('/');
    const colon = at.lastIndexOf(':');
    const name = colon > slash ? at.slice(0, colon) : at;
    const tag = colon > slash ? at.slice(colon + 1) : null;
    images.push({ image: name, tag: tag && tag.length <= 64 ? tag : null });
  }
  return images;
}

function describeImage(image) {
  const bare = image.replace(/^docker\.io\//, '').replace(/^library\//, '');
  for (const [pattern, component, kind] of SERVICE_IMAGES) if (pattern.test(bare)) return { component, kind };
  return { component: bare, kind: 'container image' };
}

function dockerfileBases(text) {
  const bases = [];
  for (const [, ref] of text.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?([^\s]+)(?:\s+AS\s+\S+)?\s*$/gim)) {
    if (ref.includes('$') || ref === 'scratch') continue;
    const at = ref.split('@')[0];
    const slash = at.lastIndexOf('/');
    const colon = at.lastIndexOf(':');
    bases.push({ image: colon > slash ? at.slice(0, colon) : at, tag: colon > slash ? at.slice(colon + 1) : null });
  }
  return bases;
}

// inventory: the result of inventoryRepository(root). Returns { entries, modules, unread }.
export async function detectStack(root, inventory) {
  const entries = [];
  const unread = [];
  const modules = new Map();
  const moduleFor = (dir) => {
    if (!modules.has(dir)) modules.set(dir, { path: dir || '.', manifests: [], ecosystems: [], frameworks: [], lockfiles: [], conflicts: [] });
    return modules.get(dir);
  };
  const add = (entry) => entries.push({ declared: null, ...entry });

  for (const manifest of inventory.manifests) {
    const dir = path.posix.dirname(manifest.path) === '.' ? '' : path.posix.dirname(manifest.path);
    const module = moduleFor(dir);
    module.manifests.push(manifest.path);
    const ecosystem = ECOSYSTEM[manifest.name] ?? (manifest.name.endsWith('.csproj') || manifest.name.endsWith('.sln') ? '.NET' : null);
    if (ecosystem && !module.ecosystems.includes(ecosystem)) {
      module.ecosystems.push(ecosystem);
      add({ component: ecosystem, kind: 'ecosystem', basis: 'declared', path: manifest.path, locator: 'manifest' });
    }
    if (manifest.unreadable) unread.push({ path: manifest.path, reason: manifest.unreadable });
    for (const hint of manifest.frameworks ?? []) {
      module.frameworks.push(hint.framework);
      add({ component: hint.framework, kind: 'framework', basis: 'declared', declared: hint.declared, path: manifest.path, locator: `${hint.source}: ${hint.package}` });
    }
    if (['package.json', 'composer.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Gemfile'].includes(manifest.name)) {
      try {
        const text = await readCapped(path.join(root, manifest.path), MAX_MANIFEST_BYTES);
        for (const found of runtimeDeclarations(manifest.name, text)) {
          if (found.kind === 'framework') module.frameworks.push(found.component);
          add({ ...found, basis: 'declared', path: manifest.path });
        }
      } catch (error) {
        if (!manifest.unreadable) unread.push({ path: manifest.path, reason: error.code === 'TOO_LARGE' ? error.message : 'could not be parsed' });
      }
    }
    for (const lock of LOCKFILES[ecosystem] ?? []) {
      const relative = dir ? `${dir}/${lock}` : lock;
      if (!module.lockfiles.includes(relative) && await exists(path.join(root, relative))) {
        module.lockfiles.push(relative);
        add({ component: lock, kind: 'lockfile', basis: 'detected', path: relative, locator: 'present' });
      }
    }
  }
  for (const module of modules.values()) {
    const nodeLocks = module.lockfiles.filter((file) => LOCKFILES['Node.js'].includes(path.posix.basename(file)));
    if (nodeLocks.length > 1) module.conflicts.push(`more than one Node.js lockfile: ${nodeLocks.join(', ')}`);
    module.frameworks = [...new Set(module.frameworks)];
  }

  for (const config of inventory.containerCi) {
    if (config.unreadable) {
      unread.push({ path: config.path, reason: config.unreadable });
      continue;
    }
    add({ component: config.kind, kind: /docker|compose/i.test(config.kind) ? 'container' : 'ci', basis: 'detected', path: config.path, locator: config.meaningful ? 'configuration' : 'empty or comment-only' });
    const name = path.posix.basename(config.path);
    const isCompose = /^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(name);
    const isDockerfile = /^Dockerfile/.test(name) || name.endsWith('.Dockerfile');
    if (!isCompose && !isDockerfile) continue;
    try {
      const text = await readCapped(path.join(root, config.path), MAX_CONFIG_BYTES);
      const images = isCompose ? composeImages(text) : dockerfileBases(text);
      for (const image of images) {
        if (image.unresolved) {
          add({ component: 'container image from a variable', kind: 'container image', basis: 'declared', path: config.path, locator: 'image: ${…} (not resolved)' });
          continue;
        }
        const described = describeImage(image.image);
        add({ component: described.component, kind: described.kind, basis: 'declared', declared: image.tag, path: config.path, locator: isCompose ? `image: ${image.image}` : `FROM ${image.image}` });
      }
    } catch (error) {
      unread.push({ path: config.path, reason: error.code === 'TOO_LARGE' ? error.message : 'could not be read' });
    }
  }

  const languages = new Map();
  for (const [ext, count] of Object.entries(inventory.sourceFiles.byExtension)) {
    const language = LANGUAGE[ext];
    if (language) languages.set(language, (languages.get(language) ?? 0) + count);
  }
  for (const [language, count] of [...languages].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    add({ component: language, kind: 'language', basis: 'inferred', path: null, locator: `${count} source file(s)`, count });
  }

  return {
    entries,
    modules: [...modules.values()].sort((a, b) => a.path.localeCompare(b.path)),
    unread
  };
}
