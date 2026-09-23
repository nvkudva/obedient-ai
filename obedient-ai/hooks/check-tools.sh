#!/bin/bash
# SessionStart: find fast CLI tools that are missing and not previously declined.
# Prints nothing when there is nothing to offer, so it costs no context tokens.
#
# Declined tools are listed one per line in $DECLINED and never offered again.
# Delete a line from that file to be asked about the tool again.

set -uo pipefail

DECLINED="${HOME}/.config/obedient-ai/declined-tools"

# command:brew-formula
tools=(
  rg:ripgrep
  fd:fd
  sg:ast-grep
  jq:jq
  yq:yq
  duckdb:duckdb
  sd:sd
  bunx:oven-sh/bun/bun
  watchexec:watchexec
  difft:difftastic
  jc:jc
  htmlq:htmlq
  scc:scc
  ruff:ruff
  gitleaks:gitleaks
)

missing=()
formulae=()
for t in "${tools[@]}"; do
  cmd=${t%%:*}
  formula=${t#*:}
  command -v "$cmd" >/dev/null 2>&1 && continue
  [ -f "$DECLINED" ] && grep -qx "$cmd" "$DECLINED" && continue
  missing+=("$cmd")
  formulae+=("$formula")
done

[ ${#missing[@]} -eq 0 ] && exit 0

cat <<EOF
## Missing CLI tools (from obedient-ai check-tools hook)

Before starting the user's task, ask this once with AskUserQuestion (options "Yes" and "No"):

"These tools are not installed in your terminal: ${missing[*]}. Installing and using them could improve speed and results. Would you like to install them?"

- Yes: run \`brew install ${formulae[*]}\`, then report the result in one line.
- No: run \`mkdir -p "$(dirname "$DECLINED")" && printf '%s\n' ${missing[*]} >> "$DECLINED"\` so the user is never asked again.
EOF
