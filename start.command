#!/bin/zsh
cd "$(dirname "$0")"
python3 -m http.server 4173 --bind 127.0.0.1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT
sleep 0.4
open "http://127.0.0.1:4173"
wait "$SERVER_PID"
