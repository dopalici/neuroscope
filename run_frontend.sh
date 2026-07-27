#!/usr/bin/env bash
# Start the React dashboard (expects backend already on :8000).
set -euo pipefail
cd "$(dirname "$0")/frontend"
if [[ ! -d node_modules ]]; then
  npm install
fi
exec npm run dev
