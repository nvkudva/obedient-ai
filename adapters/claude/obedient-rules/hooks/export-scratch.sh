#!/bin/bash
# SessionStart: export SCRATCH=<this session's scratchpad> for every Bash call,
# so commands stop pasting the long /private/tmp/claude-<uid>/... path.
[ -n "${CLAUDE_ENV_FILE:-}" ] || exit 0
IFS= read -r -d '' payload
sid=$(jq -r '.session_id // empty' <<< "$payload")
cwd=$(jq -r '.cwd // empty' <<< "$payload")
[ -n "$sid" ] && [ -n "$cwd" ] || exit 0
slug=$(printf '%s' "$cwd" | sed 's/[^A-Za-z0-9]/-/g')
printf 'export SCRATCH=%q\n' "/private/tmp/claude-$(id -u)/$slug/$sid/scratchpad" >> "$CLAUDE_ENV_FILE"
# GNU sed and timeout first: models write GNU `sed -i` and `timeout`, which fail on macOS.
for gnubin in /opt/homebrew/opt/gnu-sed/libexec/gnubin /opt/homebrew/opt/coreutils/libexec/gnubin; do
  [ -d "$gnubin" ] && printf 'export PATH=%q:"$PATH"\n' "$gnubin" >> "$CLAUDE_ENV_FILE"
done
