#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo ""
echo "The Corbett Report - WordPress to Qortal setup"
echo "Project folder: $ROOT_DIR"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo ""
  echo "On Zorin OS / Ubuntu, open a terminal and run:"
  echo "  sudo apt update"
  echo "  sudo apt install -y curl"
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "  sudo apt install -y nodejs"
  echo ""
  echo "Then run this setup script again."
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20 or newer is required. Installed version: $(node --version)"
  echo ""
  echo "Install Node.js 20 LTS with:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "  sudo apt install -y nodejs"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is missing. Install Node.js 20 LTS and run this script again."
  exit 1
fi

echo "Node.js: $(node --version)"
echo "npm: $(npm --version)"
echo ""

echo "Installing project dependencies..."
npm install --no-audit --no-fund

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo ""
  echo "Created .env from .env.example."
else
  echo ""
  echo "Keeping the existing .env file."
fi

mkdir -p wp-qortal-import

echo ""
echo "Setup finished."
echo ""
echo "Next steps:"
echo "  1. Edit .env and enter the WordPress login for corbettreport.com."
echo "     nano .env"
echo "  2. Check the setup:"
echo "     npm run doctor"
echo "  3. Check WordPress access:"
echo "     npm run inspect"
echo "  4. Record the existing QDN catalog once:"
echo "     npm run batch:init -- --from-qdn"
echo ""
echo "For the full walkthrough, open docs/ZORIN_LINUX_SETUP.md"
echo ""
