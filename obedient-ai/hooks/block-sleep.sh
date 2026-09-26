#!/bin/bash
# PreToolUse:Bash guard — blocks foreground `sleep N` (N >= 3). Waiting in the
# foreground burns a turn and the cache; background jobs + Monitor re-invoke
# the model when the condition is met.
# Protocol: exit 0 allow, exit 2 block + stderr reason.
# Escape hatch: put ALLOW_SLEEP=1 in the command.

IFS= read -r -d '' payload
cmd=$(jq -r '.tool_input.command // empty' <<< "$payload" 2>/dev/null)
bg=$(jq -r '.tool_input.run_in_background // false' <<< "$payload" 2>/dev/null)
[ -z "${cmd:-}" ] || [ "$bg" = true ] && exit 0
case $cmd in *ALLOW_SLEEP=1*) exit 0 ;; esac

nl=$'\n'
re="(^|[;&|(${nl}]|[[:space:]]then|[[:space:]]do)[[:space:]]*sleep[[:space:]]+([0-9]+)"
[[ $cmd =~ $re ]] || exit 0
(( ${BASH_REMATCH[2]} >= 3 )) || exit 0

printf 'BLOCKED by block-sleep.sh: no foreground sleep.\n' >&2
printf '  Start the job with run_in_background, then wait with Monitor (until-loop on the condition).\n' >&2
printf '  If a fixed pause is truly required, add ALLOW_SLEEP=1 to the command.\n' >&2
exit 2
