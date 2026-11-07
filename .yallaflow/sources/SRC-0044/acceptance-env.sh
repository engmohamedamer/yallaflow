#!/usr/bin/env bash
# YallaFlow 1.4.0 acceptance environment: disposable projects and an isolated console
# configuration under ONE folder you choose. It never touches your real projects, your
# saved console project list, or your global yallaflow install.
#
#   research/release-1.4/acceptance-env.sh <empty-or-new-folder> [--offline]
#
# --offline: build the "existing project" from a small local sample instead of running
# `composer create-project` (no network needed).
set -euo pipefail

YF14_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE="${1:?usage: acceptance-env.sh <folder> [--offline]}"
OFFLINE="${2:-}"
mkdir -p "$BASE"
BASE="$(cd "$BASE" && pwd)"
if [ -n "$(ls -A "$BASE" 2>/dev/null)" ]; then echo "Refusing: $BASE is not empty." >&2; exit 1; fi
case "$BASE" in "$HOME"|"$HOME/"|/|"$YF14_ROOT"*) echo "Refusing: choose a dedicated folder for the acceptance environment." >&2; exit 1;; esac

mkdir -p "$BASE/config" "$BASE/projects" "$BASE/new-projects"
cat > "$BASE/env.sh" <<EOF
# source this file: isolated YallaFlow 1.4.0 candidate environment
export XDG_CONFIG_HOME="$BASE/config"
export YALLAFLOW_CONSOLE_CONFIG="$BASE/config/yallaflow/console.json"
yf14() { node "$YF14_ROOT/src/cli.js" "\$@"; }
export -f yf14 2>/dev/null || true
EOF
# shellcheck disable=SC1091
source "$BASE/env.sh"
yf() { node "$YF14_ROOT/src/cli.js" "$@"; }
step() { printf '\n== %s\n' "$*"; }

step "1. Existing project (Brownfield): onboarding and stack detection"
SHOP="$BASE/projects/existing-shop"
if [ "$OFFLINE" = "--offline" ]; then
  mkdir -p "$SHOP/app/Models" "$SHOP/routes" "$SHOP/resources/js"
  printf '{"require":{"php":"^8.3","laravel/framework":"^13.0"}}\n' > "$SHOP/composer.json"
  printf '{}\n' > "$SHOP/composer.lock"
  printf '#!/usr/bin/env php\n<?php echo "artisan stub\\n";\n' > "$SHOP/artisan"
  printf '<?php\nclass Order {}\n' > "$SHOP/app/Models/Order.php"
  printf '<?php\n' > "$SHOP/routes/web.php"
  printf '{"private":true,"scripts":{"dev":"vite"},"devDependencies":{"vite":"^7.0.0"},"engines":{"node":">=20"}}\n' > "$SHOP/package.json"
  printf 'console.log(1)\n' > "$SHOP/resources/js/app.js"
  printf 'services:\n  db:\n    image: mysql:8.4\n  cache:\n    image: redis:7\n' > "$SHOP/docker-compose.yml"
else
  composer create-project laravel/laravel:13.11.0 "$SHOP" --no-interaction --prefer-dist --quiet
fi
(cd "$SHOP" && git init -q && git add -A && git -c user.email=acceptance@example.com -c user.name=Acceptance commit -qm "existing project" && yf init --name "Existing Shop" >/dev/null)
(cd "$SHOP" && yf overview | head -6)

step "2. Runtime: a small Node web service with a dev script (added, NOT trusted, NOT started)"
WEB="$BASE/projects/node-web"
mkdir -p "$WEB"
cat > "$WEB/server.js" <<'JS'
const http = require('http');
const port = Number(process.env.PORT || 4815);
console.log(`node-web starting on 127.0.0.1:${port}`);
http.createServer((req, res) => { console.log(`${req.method} ${req.url}`); res.end('hello from node-web\n'); }).listen(port, '127.0.0.1', () => console.log('ready'));
JS
printf '{"name":"node-web","private":true,"scripts":{"dev":"node server.js"}}\n' > "$WEB/package.json"
(cd "$WEB" && git init -q && yf init --name "Node Web" --type greenfield >/dev/null && yf runtime add web --name "Node web" --port 4815 --ready-port 4815 -- npm run dev >/dev/null && yf runtime status)

step "3. Work management and gate decisions (in node-web)"
(cd "$WEB" \
  && yf change "Change the greeting text" --scope bounded >/dev/null \
  && yf feature "Add a health endpoint with a reviewed specification" --scope architectural >/dev/null \
  && yf start --keep-active -- "Investigate slow responses on /" >/dev/null \
  && yf snapshot | head -6)

step "4. Console project list (isolated) and launch script"
yf console add "$SHOP" >/dev/null; yf console add "$WEB" >/dev/null; yf console list
cat > "$BASE/start-console.sh" <<EOF
#!/usr/bin/env bash
# Starts the 1.4.0 candidate console with the Agent Workspace (Codex, your subscription).
source "$BASE/env.sh"
cd "$WEB"
exec node "$YF14_ROOT/src/cli.js" console --agents
EOF
chmod +x "$BASE/start-console.sh"

cat <<EOF

Ready. Everything lives in $BASE.
  source $BASE/env.sh          # yf14 = the 1.4.0 candidate; isolated config
  $BASE/start-console.sh       # console with the Agent Workspace (Codex, your existing login)
New projects from the wizard: choose the parent folder $BASE/new-projects
Clean up: stop services (yf14 runtime stop --all in each project), close the console, delete $BASE.
EOF
