#!/bin/bash
# PreToolUse:Bash guard — blocks slow or fragile tools that have a faster installed
# replacement, and tells Claude which one to use instead.
#
# Protocol: same as block-dangerous-git.sh (exit 0 allow, exit 2 block + stderr reason).
#
# Escape hatch: put ALLOW_SLOW_TOOL=1 in the command when the original tool is
# genuinely required (e.g. a grep-only flag, or a package bunx cannot run).

set -uo pipefail

payload=$(cat)

if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  cmd=$(printf '%s' "$payload" | python3 -c \
    'import json,sys
try: print(json.load(sys.stdin).get("tool_input",{}).get("command","") or "")
except Exception: print("")' 2>/dev/null)
fi

[ -z "${cmd:-}" ] && exit 0

case "$cmd" in
  *ALLOW_SLOW_TOOL=1*) exit 0 ;;
esac

norm=$(printf '%s' "$cmd" | tr '\n' ' ' | tr -s '[:space:]' ' ')

deny() {
  printf 'BLOCKED by prefer-fast-tools.sh: %s\n\n' "$1" >&2
  printf 'Command: %s\n\n' "$cmd" >&2
  printf 'Rewrite the command with the suggested tool. If the original tool is\n' >&2
  printf 'genuinely required, add ALLOW_SLOW_TOOL=1 to the command.\n' >&2
  exit 2
}

# Command position: start of line, after ; & | ( or $(, or as the program run by xargs.
pos='(^|[;&|(]|xargs( +-[^ ]+)*) *(sudo +)?'

m() { printf '%s' "$norm" | grep -Eq "$1"; }
has() { command -v "$1" >/dev/null 2>&1; }

has rg   && m "${pos}[ef]?grep( |$)" && deny "use rg instead of grep. rg reads stdin in pipes, is recursive by default, and respects .gitignore. For structural code search use sg (ast-grep)."
has fd   && m "${pos}find( |$)"      && deny "use fd instead of find (e.g. fd -e ts, fd -t d name, fd -H to include hidden)."
has bunx && m "${pos}npx( |$)"       && deny "use bunx instead of npx; it starts much faster."
has uv   && m "${pos}(python3? +-m +)?pip3? +install( |$)" && deny "use uv pip install instead of pip install; it is 10-100x faster."
has sd   && m "${pos}sed +([^|;&]* )?-[a-zA-Z]*i" && deny "use sd for in-place find-and-replace (sd 'from' 'to' file), or the Edit tool. sed -n for reading ranges is fine."

exit 0
