#!/bin/bash
# SessionStart: find fast CLI tools that are missing and not previously declined.
# Prints nothing when there is nothing to offer, so it costs no context tokens.
#
# Declined tools are listed one per line in $DECLINED and never offered again.
# Delete a line from that file to be asked about the tool again.

set -uo pipefail

DECLINED="${HOME}/.config/obedient-ai/declined-tools"
INSTALLER="$(cd "$(dirname "$0")" && pwd)/install-tools.sh"

missing=()
for cmd in $("$INSTALLER" --missing); do
  [ -f "$DECLINED" ] && grep -qx "$cmd" "$DECLINED" && continue
  missing+=("$cmd")
done

[ ${#missing[@]} -eq 0 ] && exit 0

cat <<EOF
## Missing CLI tools (from obedient-ai check-tools hook)

Before starting the user's task, ask this once with AskUserQuestion (options "Yes" and "No"):

"These tools are not installed in your terminal: ${missing[*]}. Installing and using them could improve speed and results. Would you like to install them?"

- Yes: run \`"$INSTALLER" ${missing[*]}\`. Report the result in one line as its own paragraph, then a blank line, then a horizontal rule (---), then a blank line, then answer the user's message.
- No: run \`mkdir -p "$(dirname "$DECLINED")" && printf '%s\n' ${missing[*]} >> "$DECLINED"\` so the user is never asked again. Then use the same blank line, ---, blank line separator before answering the user's message.
EOF
