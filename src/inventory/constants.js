// Bounded, deterministic repository inventory (v0.3.9). Every bound and every
// recognized name is a named constant so classification is reproducible and can be
// tuned from dogfood evidence without changing the algorithm.

// Recognized source files at or above which a repository is Brownfield on source
// volume alone (decision 3, v0.3.9: 9 → greenfield, 10 → brownfield).
export const BROWNFIELD_SOURCE_FILE_THRESHOLD = 10;

// Traversal bounds. Directories deeper than INVENTORY_MAX_DEPTH (root = depth 0) are
// counted but not descended; the walk stops after INVENTORY_MAX_ENTRIES directory
// entries. Hitting either bound is reported, never silent.
export const INVENTORY_MAX_DEPTH = 16;
export const INVENTORY_MAX_ENTRIES = 50_000;

// Directory names never descended: version control, YallaFlow's own workspace,
// dependency installs, build output, caches, and IDE state.
export const IGNORED_DIRECTORIES = Object.freeze([
  '.git', '.hg', '.svn',
  '.yallaflow', '.projectflow',
  'node_modules', 'bower_components', 'vendor', '.venv', 'venv', '__pycache__',
  'dist', 'build', 'out', 'target', 'coverage',
  '.next', '.nuxt', '.angular', '.svelte-kit', '.gradle', '.dart_tool',
  '.cache', '.parcel-cache', '.turbo', '.tox', '.mypy_cache', '.pytest_cache',
  '.idea', '.vscode'
]);

// Recognized source-code extensions (counted, never read). Markup, data, and shell
// scripts are deliberately excluded: they do not by themselves indicate application
// code.
export const SOURCE_CODE_EXTENSIONS = Object.freeze([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.svelte',
  '.php', '.py', '.rb', '.go', '.rs',
  '.java', '.kt', '.kts', '.scala', '.groovy',
  '.cs', '.fs', '.vb',
  '.swift', '.m', '.mm', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp',
  '.dart', '.ex', '.exs', '.erl', '.clj', '.lua'
]);

// Recognized manifests. Discoverable by inventory; a manifest alone never classifies a
// project as Brownfield — it needs at least one recognized source file.
export const MANIFEST_FILES = Object.freeze([
  'package.json', 'composer.json', 'pyproject.toml', 'requirements.txt', 'setup.py',
  'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile',
  'pubspec.yaml', 'mix.exs', 'angular.json'
]);
export const MANIFEST_EXTENSIONS = Object.freeze(['.csproj', '.sln']);

// Container/CI configuration. Meaningful (and therefore Brownfield evidence) when it
// has at least one non-whitespace line that is not a full-line `#` or `//` comment.
export const CONTAINER_CI_FILES = Object.freeze([
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml',
  '.gitlab-ci.yml', 'azure-pipelines.yml', 'bitbucket-pipelines.yml', 'Jenkinsfile'
]);
// Recognized by their parent directory rather than their name alone.
export const CONTAINER_CI_PATHS = Object.freeze(['.circleci/config.yml']);
export const CI_WORKFLOW_DIRECTORY = '.github/workflows';
export const CONFIG_COMMENT_PREFIXES = Object.freeze(['#', '//']);

// Read caps. Manifests and container/CI files are the only bytes inventory reads.
export const MAX_MANIFEST_BYTES = 1024 * 1024;
export const MAX_CONFIG_BYTES = 256 * 1024;

// Output bounds for `yallaflow inspect`.
export const INSPECT_MANIFEST_LIMIT = 40;
export const INSPECT_DOCUMENT_LIMIT = 25;
// Nested hints written into tech-stack.md at init (a durable file agents read).
export const TECH_STACK_HINT_LIMIT = 40;
// Documentation candidates retained in memory (the total is always counted).
export const DOCUMENT_RETAIN_LIMIT = 1000;
