#!/usr/bin/env bash
# serve.sh — Starts a local HTTP server for the frontend.
# ES modules require a proper HTTP server (not file://).

PORT="${1:-3000}"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  CF Escrow Frontend"
echo "  http://localhost:$PORT"
echo ""
echo "  Make sure Phantom wallet is installed in your browser."
echo "  Press Ctrl+C to stop."
echo ""

if command -v python3 &>/dev/null; then
  python3 -m http.server "$PORT" --directory "$DIR"
elif command -v python &>/dev/null; then
  cd "$DIR" && python -m SimpleHTTPServer "$PORT"
elif command -v npx &>/dev/null; then
  npx serve "$DIR" -p "$PORT"
else
  echo "ERROR: No HTTP server found."
  echo "Install Python 3 or run: npm install -g serve"
  exit 1
fi
