#!/usr/bin/env bash
# Thin wrapper — real work is in dev.py (better signal handling than bash).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 "$ROOT/scripts/dev.py"
