#!/usr/bin/env bash
# Counts how often each obedient-ai part fired in past Claude Code sessions.
# Reads ~/.claude/projects/**/*.jsonl (main sessions only). Usage: tools/plugin-usage.sh [since-YYYY-MM-DD]
set -uo pipefail
root=~/.claude/projects
since=${1:-}
files=$(find "$root" -name '*.jsonl' -not -path '*/subagents/*' ${since:+-newermt "$since"})
total=$(printf '%s\n' "$files" | grep -c .)
oldest=$(printf '%s\n' "$files" | xargs ls -t | tail -1 | xargs date -r +%F 2>/dev/null)
echo "sessions: $total (oldest: ${oldest:-?})"
count_files() { printf '%s\n' "$files" | xargs rg -l -F -- "$1" 2>/dev/null | wc -l | tr -d ' '; }
count_hits()  { printf '%s\n' "$files" | xargs rg -c -F -- "$1" 2>/dev/null | awk -F: '{s+=$NF} END{print s+0}'; }
for pat in 'BLOCKED by block-dangerous-git' 'BLOCKED by block-sleep' 'BLOCKED by prefer-fast-tools' 'Blocked: standalone sleep' \
           'cache-keeper' 'Reply with only: ok' 'token-guard' 'Prompt dropped by a hook' 'quickrun'; do
  printf '%-34s sessions=%-5s hits=%s\n' "$pat" "$(count_files "$pat")" "$(count_hits "$pat")"
done
echo "-- skill invocations (obedient-ai)"
printf '%s\n' "$files" | xargs rg -o --no-filename '"name":"Skill","input":\{"skill":"[^"]*"' 2>/dev/null \
  | sed 's/.*"skill":"//;s/"$//' | sort | uniq -c | sort -rn | head -15
