#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$PROJECT_ROOT/verbier-curator"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5173}"

echo "Verbier Curator local demo"
echo "Project root: $PROJECT_ROOT"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed or not on PATH."
  echo "Please install Node.js, then run this script again."
  exit 1
fi

if [ ! -f "$SCRIPT_DIR/server.mjs" ]; then
  echo "ERROR: Cannot find demo/server.mjs."
  echo "Make sure you are running from the Verbier project folder on the NAS."
  exit 1
fi

echo "Node: $(node --version)"
echo

echo "Optional preflight:"
echo "  ./demo/check-demo.sh"
echo
echo "Starting local static demo server..."
echo "Open:"
echo "  http://${HOST}:${PORT}/choose.html"
echo
echo "Use Ctrl+C in this terminal to stop the demo."
echo

exec node "$SCRIPT_DIR/server.mjs"
