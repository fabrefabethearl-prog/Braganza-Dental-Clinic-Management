#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found on this computer."
  echo "Install Node.js 18 or newer from https://nodejs.org and run this file again."
  exit 1
fi

PORT="${PORT:-4400}"
URL="http://127.0.0.1:${PORT}"

if [ ! -d "node_modules" ]; then
  npm install
fi

(
  sleep 2
  if command -v google-chrome >/dev/null 2>&1; then google-chrome "$URL" >/dev/null 2>&1 &
  elif command -v google-chrome-stable >/dev/null 2>&1; then google-chrome-stable "$URL" >/dev/null 2>&1 &
  elif [ -d "/Applications/Google Chrome.app" ]; then open -a "Google Chrome" "$URL" >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 &
  fi
) &

exec node server/index.js
