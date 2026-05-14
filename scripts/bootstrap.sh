#!/usr/bin/env bash
# First-time local setup: Python venv, deps, frontend deps, .env scaffold.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

GREEN="\033[0;32m"; YELLOW="\033[0;33m"; RED="\033[0;31m"; NC="\033[0m"
say() { echo -e "${GREEN}[setup]${NC} $*"; }
warn() { echo -e "${YELLOW}[setup]${NC} $*"; }
die() { echo -e "${RED}[setup]${NC} $*" >&2; exit 1; }

# --- Python ---
command -v python3 >/dev/null || die "python3 not found. Install Python 3.10+."
PY_VER=$(python3 -c 'import sys;print(f"{sys.version_info.major}.{sys.version_info.minor}")')
say "Python $PY_VER detected"

if [ ! -d ".venv" ]; then
  say "Creating virtualenv at .venv"
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate

say "Installing Python dependencies"
pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet

# --- Node ---
command -v node >/dev/null || die "node not found. Install Node 18+."
command -v npm >/dev/null || die "npm not found."
say "Node $(node -v) detected"

if [ ! -d "dashboard/node_modules" ]; then
  say "Installing frontend dependencies (npm install)"
  (cd dashboard && npm install --silent)
else
  say "Frontend deps already installed (skip). Delete dashboard/node_modules to reinstall."
fi

# --- .env ---
# Non-destructive: create from .env.example if missing, or append missing MYSQL_* vars.
if [ ! -f ".env" ]; then
  say "Writing default .env from .env.example"
  cp .env.example .env
elif ! grep -q "^MYSQL_" .env 2>/dev/null && ! grep -q "^MYSQL_CONN_STR" .env 2>/dev/null; then
  say "Appending default MySQL vars to existing .env (original contents kept)"
  cat >> .env <<'EOF'

# Added by bootstrap — local MySQL (matches `make db-up`)
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3307
MYSQL_USER=connector
MYSQL_PASSWORD=localtest
MYSQL_DATABASE=app_db
EOF
else
  say ".env already has MySQL config (keeping as-is)"
fi

echo
say "Done. Next steps:"
echo "  1. (optional) make db-up         # start local MySQL via Docker"
echo "  2. make dev                      # start backend + frontend"
echo "  3. open http://localhost:5174"
