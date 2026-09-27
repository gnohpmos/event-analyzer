#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================================="
echo " Starting Network Event & Incident Analyzer Platform...   "
echo "=========================================================="

if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
fi

# Ensure data directories exist
mkdir -p data/postgres data/redis

echo "Building and starting Docker containers..."
docker compose up -d --build

echo ""
echo "Platform services status:"
docker compose ps

PORT=$(grep -E '^PORT=' .env | cut -d '=' -f 2 || echo "8089")
echo ""
echo "=========================================================="
echo " Event Analyzer is starting!"
echo " Web UI:    http://localhost:${PORT:-8089}"
echo " Backend:   http://localhost:${PORT:-8089}/api/health/"
echo " PRTG Hook: http://localhost:${PORT:-8089}/api/v1/integrations/prtg/events/"
echo "=========================================================="
