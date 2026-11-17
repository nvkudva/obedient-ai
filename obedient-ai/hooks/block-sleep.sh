#!/bin/bash
# PreToolUse:Bash guard — blocks foreground `sleep N` (N > 10). Waiting in the
# foreground burns a turn and the cache; background jobs + Monitor re-invoke
# the model when the condition is met. Short settle pauses (sleep <= 10 after
# starting an app) pass: a block costs a full model turn, more than the pause.
# Protocol: exit 0 allow, exit 2 block + stderr reason.
# Escape hatch: put ALLOW_SLEEP=1 in the command.

# shellcheck source=_common.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
parse_hook_payload

cmd=$HOOK_CMD
[ -z "${cmd:-}" ] || [ "$HOOK_BG" = true ] && emit_allow
case $cmd in *ALLOW_SLEEP=1*) emit_allow ;; esac

nl=$'\n'
re="(^|[;&|(${nl}]|[[:space:]]then|[[:space:]]do)[[:space:]]*sleep[[:space:]]+([0-9]+)"
[[ $cmd =~ $re ]] || emit_allow
(( ${BASH_REMATCH[2]} > 10 )) || emit_allow

msg=$(printf 'BLOCKED by block-sleep.sh: no foreground sleep.\n  Start the job in the background, or if a fixed pause is truly required, add ALLOW_SLEEP=1 to the command.')
emit_deny "$msg"
