#!/bin/bash
# PreToolUse:Bash guard — blocks `pip install` when uv is installed and names
# the replacement; uv installs the same packages 10-100x faster.
#
# 0.5.0 dropped the grep/find/npx/sed -i swaps: in Claude Code's shell grep and
# find already run as built-in ugrep and bfs, npx costs only ~0.2 s more than
# bunx, and every block costs a full model turn (~5 s), more than they saved.
#
# Protocol: same as block-dangerous-git.sh (exit 0 allow, exit 2 block + stderr reason).
# Escape hatch: put ALLOW_SLOW_TOOL=1 in the command when pip itself is required.

command -v uv >/dev/null 2>&1 || exit 0

IFS= read -r -d '' payload

if command -v jq >/dev/null 2>&1; then
  cmd=$(jq -r '.tool_input.command // empty' <<< "$payload" 2>/dev/null)
else
  cmd=$(python3 -c \
    'import json,sys
try: print(json.load(sys.stdin).get("tool_input",{}).get("command","") or "")
except Exception: print("")' <<< "$payload" 2>/dev/null)
fi

[ -z "${cmd:-}" ] && exit 0

case $cmd in
  *ALLOW_SLOW_TOOL=1*) exit 0 ;;
esac

# pip at command position: start, after ; & | ( or a newline, or after then/do.
nl=$'\n'
re="(^|[;&|(${nl}]|[[:space:]]then|[[:space:]]do)[[:space:]]*(sudo[[:space:]]+)?(python3?[[:space:]]+-m[[:space:]]+)?pip3?[[:space:]]+install([[:space:]]|\$)"
[[ $cmd =~ $re ]] || exit 0

printf 'BLOCKED by prefer-fast-tools.sh: use uv instead of pip install (10-100x faster):\n' >&2
printf '  uv pip install <pkg>                      inside a venv\n' >&2
printf '  uv run --with <pkg> python script.py      for a one-off script\n\n' >&2
printf 'Command: %s\n\n' "$cmd" >&2
printf 'If pip itself is required, add ALLOW_SLOW_TOOL=1 to the command.\n' >&2
exit 2
