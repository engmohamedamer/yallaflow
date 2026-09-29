// Deterministic framework/version hints read from manifest text only. A hint reports
// the declared version string and, only when that string is a single literal version
// (optionally ^/~ prefixed), its major number. Nothing is inferred beyond the
// manifest: no lockfiles, no parent-POM resolution across files, no semantic labels.

const NPM_FRAMEWORKS = Object.freeze([
  ['@angular/core', 'Angular'],
  ['react', 'React'],
  ['vue', 'Vue'],
  ['next', 'Next.js'],
  ['@nestjs/core', 'NestJS'],
  ['vite', 'Vite']
]);

const COMPOSER_FRAMEWORKS = Object.freeze([
  ['laravel/framework', 'Laravel'],
  ['yiisoft/yii2', 'Yii2']
]);

const SPRING_BOOT = 'Spring Boot';
const SPRING_BOOT_GROUP = 'org.springframework.boot';

export function majorOf(declared) {
  if (typeof declared !== 'string') return null;
  const match = /^[\^~]?v?(\d+)(?:\.(?:\d+|x|\*))*(?:[-.+][0-9A-Za-z.-]+)?$/.exec(declared.trim());
  return match ? Number(match[1]) : null;
}

function hint(framework, pkg, declared, source) {
  const literal = typeof declared === 'string' && declared.trim() ? declared.trim() : null;
  return { framework, package: pkg, declared: literal, major: majorOf(literal), source };
}

function dependencyHints(table, groups) {
  const hints = [];
  for (const [pkg, framework] of table) {
    for (const group of groups) {
      const deps = group.deps;
      if (deps && typeof deps === 'object' && !Array.isArray(deps) && Object.hasOwn(deps, pkg)) {
        hints.push(hint(framework, pkg, deps[pkg], group.name));
        break;
      }
    }
  }
  return hints;
}

function parseJsonManifest(text) {
  let value;
  try {
    // A leading UTF-8 BOM is tolerated, as npm and Node do.
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    // Fixed reason: never echo manifest content into output.
    throw new Error('invalid JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not a JSON object');
  return value;
}

export function packageJsonHints(text) {
  const pkg = parseJsonManifest(text);
  return dependencyHints(NPM_FRAMEWORKS, [
    { name: 'dependencies', deps: pkg.dependencies },
    { name: 'devDependencies', deps: pkg.devDependencies },
    { name: 'peerDependencies', deps: pkg.peerDependencies }
  ]);
}

export function composerJsonHints(text) {
  const composer = parseJsonManifest(text);
  return dependencyHints(COMPOSER_FRAMEWORKS, [
    { name: 'require', deps: composer.require },
    { name: 'require-dev', deps: composer['require-dev'] }
  ]);
}

function tag(block, name) {
  const match = new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`).exec(block);
  return match ? match[1] : null;
}

// `${property}` is resolved only from a literal entry in this same file's project-level
// <properties> (profile properties are ignored). Unresolvable, it stays the declared
// literal (e.g. `${project.parent.version}`) and has no major version.
function resolveProperty(xml, value) {
  const reference = /^\$\{([^}]+)\}$/.exec(value ?? '');
  if (!reference) return value;
  const projectLevel = xml.replace(/<profiles>[\s\S]*?<\/profiles>/g, '');
  const properties = /<properties>([\s\S]*?)<\/properties>/.exec(projectLevel)?.[1] ?? '';
  const resolved = tag(properties, reference[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return resolved && !resolved.includes('${') ? resolved : value;
}

export function pomHints(text) {
  const xml = text.replace(/<!--[\s\S]*?-->/g, '');
  const parent = /<parent>([\s\S]*?)<\/parent>/.exec(xml)?.[1];
  if (parent && tag(parent, 'groupId') === SPRING_BOOT_GROUP && tag(parent, 'artifactId') === 'spring-boot-starter-parent') {
    return [hint(SPRING_BOOT, 'spring-boot-starter-parent', resolveProperty(xml, tag(parent, 'version')), 'parent')];
  }
  for (const [, block] of xml.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    if (tag(block, 'groupId') === SPRING_BOOT_GROUP && tag(block, 'artifactId') === 'spring-boot-dependencies') {
      return [hint(SPRING_BOOT, 'spring-boot-dependencies', resolveProperty(xml, tag(block, 'version')), 'bom')];
    }
  }
  if (/<groupId>\s*org\.springframework\.boot\s*<\/groupId>/.test(xml)) {
    return [hint(SPRING_BOOT, SPRING_BOOT_GROUP, null, 'reference')];
  }
  return [];
}

export function gradleHints(source) {
  // Comments are stripped (a `//` preceded by `:` is kept, so URLs survive).
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const plugin = /id\s*\(?\s*["']org\.springframework\.boot["']\s*\)?\s*version\s*["']([^"']+)["']/.exec(text);
  if (plugin) return [hint(SPRING_BOOT, SPRING_BOOT_GROUP, plugin[1], 'plugin')];
  const classpath = /["']org\.springframework\.boot:spring-boot-gradle-plugin:([^"'$]+)["']/.exec(text);
  if (classpath) return [hint(SPRING_BOOT, 'spring-boot-gradle-plugin', classpath[1], 'plugin')];
  if (/org\.springframework\.boot/.test(text)) return [hint(SPRING_BOOT, SPRING_BOOT_GROUP, null, 'reference')];
  return [];
}

const PARSERS = Object.freeze({
  'package.json': packageJsonHints,
  'composer.json': composerJsonHints,
  'pom.xml': pomHints,
  'build.gradle': gradleHints,
  'build.gradle.kts': gradleHints
});

export function hasHintParser(name) {
  return Object.hasOwn(PARSERS, name);
}

// Returns { frameworks } or { frameworks: [], unreadable: reason }; never throws.
export function manifestHints(name, text) {
  const parser = PARSERS[name];
  if (!parser) return { frameworks: [] };
  try {
    return { frameworks: parser(text) };
  } catch (error) {
    return { frameworks: [], unreadable: `could not parse ${name}: ${error instanceof Error && error.message === 'not a JSON object' ? error.message : 'invalid JSON'}` };
  }
}

export function describeHint(entry) {
  if (!entry.declared) return `${entry.framework} (version not declared in this manifest)`;
  const version = entry.major === null ? '' : ` ${entry.major}`;
  return `${entry.framework}${version} (${entry.package} ${entry.declared})`;
}
