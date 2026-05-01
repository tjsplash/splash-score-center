#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$DIR/.server.pid" ]; then
  pid=$(cat "$DIR/.server.pid")
  kill "$pid" 2>/dev/null && echo "stopped pid $pid"
  rm -f "$DIR/.server.pid"
fi
