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

# shellcheck source=_common.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

if ! command -v uv >/dev/null 2>&1; then
  parse_hook_payload
  emit_allow
fi

parse_hook_payload
cmd=$HOOK_CMD

[ -z "${cmd:-}" ] && emit_allow

case $cmd in
  *ALLOW_SLOW_TOOL=1*) emit_allow ;;
esac

# pip at command position: start, after ; & | ( or a newline, or after then/do.
nl=$'\n'
re="(^|[;&|(${nl}]|[[:space:]]then|[[:space:]]do)[[:space:]]*(sudo[[:space:]]+)?(python3?[[:space:]]+-m[[:space:]]+)?pip3?[[:space:]]+install([[:space:]]|\$)"
[[ $cmd =~ $re ]] || emit_allow

msg=$(printf 'BLOCKED by prefer-fast-tools.sh: use uv instead of pip install (10-100x faster):\n  uv pip install <pkg>                      inside a venv\n  uv run --with <pkg> python script.py      for a one-off script\n\nCommand: %s\n\nIf pip itself is required, add ALLOW_SLOW_TOOL=1 to the command.' "$cmd")
emit_deny "$msg"
