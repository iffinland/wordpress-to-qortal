#!/usr/bin/env bash
# Install reproducible build dependencies without running arbitrary lifecycle
# scripts. Electron and esbuild need their binary download steps, which are run
# explicitly here after npm ci --ignore-scripts.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

npm ci --ignore-scripts --no-audit --no-fund
npm --prefix desktop ci --ignore-scripts --no-audit --no-fund
npm --prefix templates/generic-cms ci --ignore-scripts --no-audit --no-fund

node desktop/node_modules/electron/install.js
node desktop/node_modules/esbuild/install.js
node templates/generic-cms/node_modules/esbuild/install.js

echo "build dependencies installed in $ROOT"
