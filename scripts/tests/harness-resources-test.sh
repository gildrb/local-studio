#!/usr/bin/env bash
# A focused Claude Code thread must not send its harness id to the daemon: harness_claude_smoke lists
# commands and skills with that thread focused, and the daemon rejects an unknown session.
set -uo pipefail
[ $# -eq 3 ] || { echo "usage: $0 <harness_claude_smoke binary> <eukhe> <scratch dir>"; exit 2; }
out=$("$1" "$2" "$3" 2>&1)
code=$?
for step in "ok   commands listed with the CLI thread focused" "ok   skills listed with the CLI thread focused" "PASS harness_claude_smoke"; do
  grep -qxF "$step" <<< "$out" || { echo "$out" | tail -5; echo "missing: $step"; exit 1; }
done
[ $code -eq 0 ] || { echo "harness_claude_smoke exited $code"; exit 1; }
echo ok
