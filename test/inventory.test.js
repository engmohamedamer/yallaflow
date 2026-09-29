// v0.3.9 M1: bounded, deterministic repository inventory and Brownfield classification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { classifyProject, documentHandling, inventoryRepository, isMeaningfulConfig } from '../src/inventory/inventory.js';
import { composerJsonHints, describeHint, gradleHints, majorOf, manifestHints, packageJsonHints, pomHints } from '../src/inventory/frameworks.js';
import { BROWNFIELD_SOURCE_FILE_THRESHOLD, CONTAINER_CI_PATHS, IGNORED_DIRECTORIES, MAX_MANIFEST_BYTES } from '../src/inventory/constants.js';
import { DOCUMENT_FORMAT_EXTENSIONS, EXTENSION_FORMATS, SUPPORT_TIERS, TEXT_DOCUMENT_EXTENSIONS } from '../src/intake/constants.js';
import { detectProjectKind } from '../src/core/workspace.js';
import { apdFixture } from '../test-support/apd-fixture.js';

async function tmp() {
  return mkdtemp(path.join(os.tmpdir(), 'yallaflow-inventory-'));
}

async function put(root, relative, content = '') {
  const file = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

async function treeHash(root) {
  const hash = createHash('sha256');
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      hash.update(path.relative(root, full));
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) hash.update(await readFile(full));
    }
  }
  await walk(root);
  return hash.digest('hex');
}

async function sources(root, count, dir = 'src') {
  for (let index = 0; index < count; index++) await put(root, `${dir}/file${index}.js`, 'export {};\n');
}

const kindOf = async (root) => classifyProject(await inventoryRepository(root)).kind;

test('AC-005: a bare .git (including a real empty `git init`) is Greenfield', async () => {
  const root = await tmp();
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  const inventory = await inventoryRepository(root);
  assert.equal(inventory.git, true);
  const result = classifyProject(inventory);
  assert.equal(result.kind, 'greenfield');
  assert.ok(result.reasons.some((reason) => /Git alone never classifies/.test(reason)));
  assert.equal(await detectProjectKind(root), 'greenfield');
});

test('AC-005: an `npm init`-only package.json, or any manifest without source, is Greenfield', async () => {
  for (const manifest of ['package.json', 'composer.json', 'requirements.txt', 'build.gradle', 'Gemfile', 'pubspec.yaml', 'App.csproj']) {
    const root = await tmp();
    await put(root, manifest, manifest === 'package.json' ? JSON.stringify({ name: 'x', version: '1.0.0' }) : '');
    const inventory = await inventoryRepository(root);
    assert.equal(inventory.manifests.length, 1, `${manifest} is discovered`);
    const result = classifyProject(inventory);
    assert.equal(result.kind, 'greenfield', manifest);
    assert.match(result.reasons[0], /a manifest alone is not Brownfield/);
  }
});

test('AC-005: a manifest with one recognized source file is Brownfield', async () => {
  const root = await tmp();
  await put(root, 'requirements.txt', 'flask\n');
  await put(root, 'app.py', 'print("hi")\n');
  const result = classifyProject(await inventoryRepository(root));
  assert.equal(result.kind, 'brownfield');
  assert.match(result.reasons[0], /1 recognized manifest\(s\) with 1 recognized source file\(s\)/);
});

test('AC-005: the source-file threshold is the named constant — 9 files Greenfield, 10 Brownfield', async () => {
  assert.equal(BROWNFIELD_SOURCE_FILE_THRESHOLD, 10);
  const nine = await tmp();
  await sources(nine, 9);
  assert.equal(await kindOf(nine), 'greenfield');
  const ten = await tmp();
  await sources(ten, 10);
  const result = classifyProject(await inventoryRepository(ten));
  assert.equal(result.kind, 'brownfield');
  assert.match(result.reasons[0], /10 recognized source files \(≥ 10\)/);
  // Markup, data, and scripts are not recognized source files.
  const markup = await tmp();
  for (let index = 0; index < 12; index++) await put(markup, `site/page${index}.html`, '<p></p>');
  assert.equal(await kindOf(markup), 'greenfield');
});

test('AC-005: meaningful container/CI configuration is Brownfield; empty or comment-only is not', async () => {
  const cases = [
    ['Dockerfile', 'FROM node:20\n', 'brownfield'],
    ['docker-compose.yml', 'services: {}\n', 'brownfield'],
    ['.github/workflows/ci.yml', 'on: push\n', 'brownfield'],
    ['.circleci/config.yml', 'version: 2.1\n', 'brownfield'],
    ['.gitlab-ci.yml', 'test:\n  script: npm test\n', 'brownfield'],
    ['Jenkinsfile', '// pipeline\npipeline { agent any }\n', 'brownfield'],
    ['Dockerfile', '', 'greenfield'],
    ['Dockerfile', '   \n\t\n', 'greenfield'],
    ['compose.yaml', '# nothing yet\n  # still nothing\n', 'greenfield'],
    ['Jenkinsfile', '// TODO\n   // later\n', 'greenfield']
  ];
  for (const [file, content, expected] of cases) {
    const root = await tmp();
    await put(root, file, content);
    const inventory = await inventoryRepository(root);
    assert.equal(inventory.containerCi.length, 1, `${file} recognized`);
    assert.equal(classifyProject(inventory).kind, expected, `${file}: ${JSON.stringify(content)}`);
  }
  assert.ok(CONTAINER_CI_PATHS.includes('.circleci/config.yml'));
  assert.equal(isMeaningfulConfig('# a\n// b\n\n'), false);
  assert.equal(isMeaningfulConfig('# a\nimage: x\n'), true);
  // A .yml outside .github/workflows is not CI configuration.
  const other = await tmp();
  await put(other, 'config/ci.yml', 'on: push\n');
  assert.equal((await inventoryRepository(other)).containerCi.length, 0);
});

test('AC-006: an APD-shaped tree with only nested applications and no Git is Brownfield', async () => {
  const root = await apdFixture();
  const inventory = await inventoryRepository(root);
  assert.equal(inventory.git, false);
  const result = classifyProject(inventory);
  assert.equal(result.kind, 'brownfield');
  assert.equal(await detectProjectKind(root), 'brownfield');
});

test('AC-001: traversal is deterministic, skips ignored directories, and never follows symlinks', async () => {
  const root = await tmp();
  await sources(root, 3, 'b');
  await sources(root, 2, 'a');
  for (const ignored of ['node_modules', 'vendor', 'dist', '.yallaflow', '.git']) await sources(root, 20, ignored);
  const outside = await tmp();
  await sources(outside, 30);
  await put(outside, 'package.json', '{}');
  await symlink(outside, path.join(root, 'linked'));
  const first = await inventoryRepository(root);
  const second = await inventoryRepository(root);
  assert.deepEqual(first, second, 'same tree → same inventory');
  assert.equal(first.sourceFiles.total, 5);
  assert.equal(first.manifests.length, 0, 'symlinked manifest not followed');
  assert.equal(first.skipped.symlinks, 1);
  assert.equal(first.skipped.ignoredDirectories, 5);
  for (const name of ['node_modules', 'vendor', '.yallaflow', '.git', '.idea']) assert.ok(IGNORED_DIRECTORIES.includes(name));
});

test('AC-001: depth and entry bounds are enforced and reported, never silent', async () => {
  const root = await tmp();
  await put(root, 'a/b/c/d/deep.js', 'export {};\n');
  const shallow = await inventoryRepository(root, { maxDepth: 2 });
  assert.equal(shallow.sourceFiles.total, 0);
  assert.equal(shallow.truncated.depthLimitedDirectories, 1);
  const full = await inventoryRepository(root);
  assert.equal(full.sourceFiles.total, 1);
  assert.equal(full.truncated.depthLimitedDirectories, 0);

  const wide = await tmp();
  await sources(wide, 30);
  const capped = await inventoryRepository(wide, { maxEntries: 10 });
  assert.equal(capped.truncated.entries, true);
  assert.equal(capped.scanned.entries, 10);
  assert.deepEqual(await inventoryRepository(wide, { maxEntries: 10 }), capped, 'truncation point is deterministic');
});

test('AC-002: nested manifests, per-extension counts, documents, and hints — and nothing is persisted', async () => {
  const root = await apdFixture();
  const before = await treeHash(root);
  const inventory = await inventoryRepository(root);
  assert.equal(await treeHash(root), before, 'inventory writes nothing');
  const paths = inventory.manifests.map((entry) => entry.path);
  for (const expected of ['frontend-beneficiary/package.json', 'frontend-corporate/package.json', 'frontend-beneficiary/angular.json',
    'backend/shared-services/pom.xml', 'backend/ms-common-lib/pom.xml', 'backend/corporate/pom.xml', 'backend/beneficiary/pom.xml']) {
    assert.ok(paths.includes(expected), expected);
  }
  assert.ok(!paths.some((entry) => entry.includes('node_modules')), 'installed dependencies are not inventoried');
  assert.deepEqual(inventory.sourceFiles.byExtension, { '.java': 4, '.ts': 5 });
  assert.deepEqual(inventory.containerCi.map((entry) => entry.path), ['docker/docker-compose.yml', 'docker/beneficiary/Dockerfile']);
  assert.ok(inventory.documents.entries.some((entry) => entry.path === 'docs/APD_LLD.pdf'));
  assert.ok(!paths.includes('README.md'));
});

test('AC-003: Angular majors per nested application; Spring Boot from parent, BOM property, or a bare reference', async () => {
  const inventory = await inventoryRepository(await apdFixture());
  const hints = Object.fromEntries(inventory.manifests.map((entry) => [entry.path, entry.frameworks]));
  assert.deepEqual(hints['frontend-beneficiary/package.json'], [{ framework: 'Angular', package: '@angular/core', declared: '^16.2.12', major: 16, source: 'dependencies' }]);
  assert.deepEqual(hints['frontend-corporate/package.json'], [{ framework: 'Angular', package: '@angular/core', declared: '^8.0.3', major: 8, source: 'dependencies' }]);
  assert.deepEqual(hints['backend/shared-services/pom.xml'], [{ framework: 'Spring Boot', package: 'spring-boot-starter-parent', declared: '2.1.3.RELEASE', major: 2, source: 'parent' }]);
  assert.deepEqual(hints['backend/corporate/pom.xml'], [{ framework: 'Spring Boot', package: 'spring-boot-dependencies', declared: '2.7.2', major: 2, source: 'bom' }]);
  // The commented-out parent (version 9.9.9) is ignored; only the plugin reference remains.
  assert.deepEqual(hints['backend/beneficiary/pom.xml'], [{ framework: 'Spring Boot', package: 'org.springframework.boot', declared: null, major: null, source: 'reference' }]);
});

test('AC-003: exactly the approved framework list, deterministic majors, and no semantic labels', () => {
  const pkg = JSON.stringify({
    dependencies: { react: '^18.2.0', next: '14.1.0', vue: '~3.4.0', '@nestjs/core': '^10.0.0', nuxt: '^3.0.0', svelte: '^4.0.0', express: '^4.18.0' },
    devDependencies: { vite: '^5.0.0', react: '^17.0.0' }
  });
  const hints = packageJsonHints(pkg);
  assert.deepEqual(hints.map((entry) => `${entry.framework}:${entry.declared}:${entry.major}:${entry.source}`), [
    'React:^18.2.0:18:dependencies', 'Vue:~3.4.0:3:dependencies', 'Next.js:14.1.0:14:dependencies', 'NestJS:^10.0.0:10:dependencies', 'Vite:^5.0.0:5:devDependencies'
  ]);
  assert.ok(!hints.some((entry) => /nuxt|svelte|express/i.test(entry.package)), 'no hints beyond the approved list');
  const composer = composerJsonHints(JSON.stringify({ require: { 'laravel/framework': '^10.10', 'symfony/framework-bundle': '^6.0' }, 'require-dev': { 'yiisoft/yii2': '~2.0.45' } }));
  assert.deepEqual(composer.map((entry) => `${entry.framework} ${entry.major}`), ['Laravel 10', 'Yii2 2']);
  assert.deepEqual(gradleHints("plugins {\n  id 'org.springframework.boot' version '3.2.4'\n}\n").map((entry) => [entry.declared, entry.major]), [['3.2.4', 3]]);
  assert.deepEqual(gradleHints('plugins { id("org.springframework.boot") version "3.1.0" }').map((entry) => entry.major), [3]);
  assert.deepEqual(gradleHints('dependencies { implementation "org.springframework.boot:spring-boot-starter-web" }').map((entry) => entry.declared), [null]);
  assert.deepEqual(pomHints('<project><parent><groupId>org.example</groupId><artifactId>x</artifactId><version>1</version></parent></project>'), []);
  // Unresolvable property: the declared literal is kept, and no major is guessed.
  const unresolved = pomHints('<project><dependencyManagement><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-dependencies</artifactId><version>${boot}</version></dependency></dependencies></dependencyManagement></project>')[0];
  assert.deepEqual([unresolved.declared, unresolved.major], ['${boot}', null]);
  for (const [declared, major] of [['^16.2.12', 16], ['~8.0.3', 8], ['2.1.3.RELEASE', 2], ['v4.1.0', 4], ['16.x', 16], ['7', 7], ['latest', null], ['>=16 <18', null], ['workspace:*', null], ['*', null], [null, null], ['1.0.0 || 2.0.0', null]]) {
    assert.equal(majorOf(declared), major, JSON.stringify(declared));
  }
  const all = JSON.stringify([hints, composer]);
  assert.doesNotMatch(all, /microservice|monolith/i);
});

test('AC-003: malformed or unreadable manifests are reported, never thrown', async () => {
  assert.equal(manifestHints('package.json', '{ "secret": not json').unreadable, 'could not parse package.json: invalid JSON', 'fixed reason; manifest content is never echoed');
  assert.match(manifestHints('composer.json', '[]').unreadable, /not a JSON object/);
  const root = await tmp();
  await put(root, 'package.json', '{ broken');
  await put(root, 'index.js', 'x\n');
  const inventory = await inventoryRepository(root);
  assert.match(inventory.manifests[0].unreadable, /could not parse/);
  assert.equal(classifyProject(inventory).kind, 'brownfield');
});

test('AC-004: documentation candidates come from intake-owned formats and are labelled with intake handling', async () => {
  for (const [ext, format] of Object.entries(EXTENSION_FORMATS)) {
    if ([SUPPORT_TIERS.OFFICE, SUPPORT_TIERS.PDF].includes(format.tier)) assert.ok(DOCUMENT_FORMAT_EXTENSIONS.includes(ext), `${ext} shared with intake`);
  }
  for (const ext of ['.pdf', '.docx', '.xlsx', '.pptx', '.md', '.txt', '.rst', '.odg', '.epub']) assert.ok(DOCUMENT_FORMAT_EXTENSIONS.includes(ext), ext);
  for (const ext of TEXT_DOCUMENT_EXTENSIONS) assert.equal(EXTENSION_FORMATS[ext].tier, SUPPORT_TIERS.NATIVE_TEXT);
  assert.ok(!DOCUMENT_FORMAT_EXTENSIONS.includes('.png'), 'images are not documentation candidates');
  assert.equal(documentHandling('.pdf'), 'text extraction on intake');
  assert.equal(documentHandling('.docx'), 'text extraction on intake');
  assert.equal(documentHandling('.md'), 'native text');
  assert.equal(documentHandling('.odg'), 'preserve-only, no text extraction');
  assert.equal(documentHandling('.epub'), 'preserve-only, no text extraction');

  const inventory = await inventoryRepository(await apdFixture());
  const docs = Object.fromEntries(inventory.documents.entries.map((entry) => [entry.path, entry.handling]));
  assert.deepEqual(docs, {
    'README.md': 'native text',
    'docs/APD_LLD.pdf': 'text extraction on intake',
    'docs/Integration information.xlsx': 'text extraction on intake',
    'docs/architecture-overview.md': 'native text',
    'docs/context-diagram.odg': 'preserve-only, no text extraction'
  });
  assert.equal(inventory.documents.total, 5);
});

// --- Independent-review regressions (pre-freeze) ---------------------------------

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

test('review: unreadable container/CI files and directories are reported as unreadable, not as empty', { skip: isRoot && 'root ignores file modes' }, async () => {
  const root = await tmp();
  await put(root, 'Dockerfile', 'FROM node:20\n');
  await chmod(path.join(root, 'Dockerfile'), 0o000);
  await put(root, 'locked/a.js', 'x');
  await chmod(path.join(root, 'locked'), 0o000);
  try {
    const inventory = await inventoryRepository(root);
    assert.match(inventory.containerCi[0].unreadable, /could not read/);
    assert.equal(inventory.skipped.unreadableDirectories, 1);
    const result = classifyProject(inventory);
    assert.ok(result.reasons.some((reason) => /container\/CI configuration could not be read \(Dockerfile\)/.test(reason)));
    assert.ok(!result.reasons.some((reason) => /empty or comment-only/.test(reason)));
  } finally {
    await chmod(path.join(root, 'Dockerfile'), 0o644);
    await chmod(path.join(root, 'locked'), 0o755);
  }
});

test('review: Maven ${property} versions — kept when unresolvable, resolved from project-level (not profile) properties', () => {
  const inherited = pomHints('<project><parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>${project.parent.version}</version></parent></project>')[0];
  assert.equal(inherited.declared, '${project.parent.version}');
  assert.equal(inherited.major, null);
  assert.equal(describeHint(inherited), 'Spring Boot (spring-boot-starter-parent ${project.parent.version})');
  const profileFirst = pomHints('<project><profiles><profile><properties><boot>9.9.9</boot></properties></profile></profiles>' +
    '<properties><boot>3.2.1</boot></properties><dependencyManagement><dependencies><dependency><groupId>org.springframework.boot</groupId>' +
    '<artifactId>spring-boot-dependencies</artifactId><version>${boot}</version></dependency></dependencies></dependencyManagement></project>')[0];
  assert.deepEqual([profileFirst.declared, profileFirst.major], ['3.2.1', 3]);
});

test('review: Gradle comments are ignored; a BOM-prefixed package.json still yields hints', () => {
  assert.deepEqual(gradleHints("// id 'org.springframework.boot' version '1.0.0'\nplugins { id 'java' }\n"), []);
  assert.deepEqual(gradleHints("/* id 'org.springframework.boot' version '1.0.0' */\nplugins { id 'java' }\n"), []);
  assert.equal(gradleHints("repositories { maven { url 'https://repo.example' } }\nplugins { id 'org.springframework.boot' version '3.3.0' }")[0].major, 3);
  assert.equal(packageJsonHints('\uFEFF' + JSON.stringify({ dependencies: { react: '^18.0.0' } }))[0].major, 18);
});

test('review: Dockerfile.* and *.Dockerfile are recognized; oversized manifests are reported, not read', async () => {
  const root = await tmp();
  await put(root, 'Dockerfile.prod', 'FROM nginx\n');
  await put(root, 'api.Dockerfile', 'FROM node\n');
  await put(root, 'package.json', `{"dependencies":{"react":"^18.0.0"},"pad":"${'x'.repeat(MAX_MANIFEST_BYTES)}"}`);
  const inventory = await inventoryRepository(root);
  assert.deepEqual(inventory.containerCi.map((entry) => entry.path).sort(), ['Dockerfile.prod', 'api.Dockerfile']);
  assert.match(inventory.manifests[0].unreadable, /larger than \d+ bytes; not read/);
  assert.deepEqual(inventory.manifests[0].frameworks, []);
});
