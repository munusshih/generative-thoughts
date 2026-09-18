#!/bin/zsh
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required."
  read "?Press Return to close..."
  exit 1
fi

if [ ! -d "$ROOT/node_modules" ] || [ ! -d "$ROOT/node_modules/vite" ]; then
  npm install
fi

export GT_NO_OPEN=0
exec node "$ROOT/local-server.mjs"
