// How to get a missing tool, per operating system (PF-0158). Display only: YallaFlow never
// installs PHP, Composer, Git, Node.js or Docker, and never runs these commands. Each entry
// is the tool's own official page (written without its scheme, like the catalog's docs field;
// the console shows it as an https link) plus, where one is well established, the usual command.
// The Windows and macOS entries are not verified on those systems by this project.
const GUIDANCE = {
  php: {
    win32: { url: 'windows.php.net/download/', hint: 'php-zip', steps: ['Download the PHP zip (Thread Safe, x64), unpack it, and add its folder to PATH.'] },
    darwin: { url: 'www.php.net/manual/en/install.macosx.php', command: 'brew install php' },
    linux: { url: 'www.php.net/manual/en/install.unix.php', command: 'sudo apt install php-cli php-sqlite3 unzip', commandNote: 'Debian/Ubuntu' }
  },
  composer: {
    win32: { url: 'getcomposer.org/download/', hint: 'composer-setup', steps: ['Run Composer-Setup.exe (it needs PHP installed first), then open a new terminal.'] },
    darwin: { url: 'getcomposer.org/download/', command: 'brew install composer' },
    linux: { url: 'getcomposer.org/download/', command: 'sudo apt install composer', commandNote: 'Debian/Ubuntu' }
  },
  pdo_sqlite: {
    win32: { url: 'www.php.net/manual/en/ref.pdo-sqlite.php', hint: 'php-ini-sqlite', steps: ['In php.ini, enable the lines extension=pdo_sqlite and extension=sqlite3.'] },
    darwin: { url: 'www.php.net/manual/en/ref.pdo-sqlite.php', hint: 'brew-php-sqlite', steps: ['Homebrew PHP includes it; reinstall PHP with Homebrew if it is missing.'] },
    linux: { url: 'www.php.net/manual/en/ref.pdo-sqlite.php', command: 'sudo apt install php-sqlite3', commandNote: 'Debian/Ubuntu' }
  },
  git: {
    win32: { url: 'git-scm.com/download/win', command: 'winget install --id Git.Git -e' },
    darwin: { url: 'git-scm.com/download/mac', command: 'xcode-select --install' },
    linux: { url: 'git-scm.com/download/linux', command: 'sudo apt install git', commandNote: 'Debian/Ubuntu' }
  },
  node: {
    win32: { url: 'nodejs.org/en/download' },
    darwin: { url: 'nodejs.org/en/download' },
    linux: { url: 'nodejs.org/en/download' }
  },
  docker: {
    win32: { url: 'docs.docker.com/desktop/setup/install/windows-install/' },
    darwin: { url: 'docs.docker.com/desktop/setup/install/mac-install/' },
    linux: { url: 'docs.docker.com/engine/install/' }
  }
};
GUIDANCE.npx = GUIDANCE.node;
GUIDANCE.npm = GUIDANCE.node;
GUIDANCE['docker-compose'] = GUIDANCE.docker;
Object.freeze(GUIDANCE);

export const GUIDED_PLATFORMS = Object.freeze(['win32', 'darwin', 'linux']);

// → { platform, url, command?, commandNote?, hint?, steps? } (hint: the console's key for its own wording of steps) or null for a tool or system without an entry.
export function toolGuidance(tool, platform = process.platform) {
  const entry = GUIDANCE[tool]?.[platform];
  return entry ? { platform, ...entry } : null;
}
