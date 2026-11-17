#!/usr/bin/env bash
# Static checks for the plugin. CI runs this; run it locally before pushing.
set -uo pipefail

fail=0
ok()  { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; fail=1; }

cd "$(dirname "$0")/.." || exit 1

for f in .claude-plugin/marketplace.json obedient-ai/.claude-plugin/plugin.json obedient-ai/hooks/hooks.json obedient-ai/claude-settings.json token-guard/.claude-plugin/plugin.json token-guard/hooks/hooks.json antigravity/plugin.json antigravity/hooks.json; do
  if python3 -m json.tool "$f" >/dev/null 2>&1; then ok "$f parses"; else bad "$f does not parse"; fi
done

for f in obedient-ai/context/rules.md obedient-ai/context/rules-opencode.md obedient-ai/context/rules-antigravity.md antigravity/rules/AGENTS.md pi/APPEND_SYSTEM.md; do
  if [ -s "$f" ]; then ok "$f non-empty"; else bad "$f missing or empty"; fi
done

for f in _common.sh block-dangerous-git.sh block-sleep.sh prefer-fast-tools.sh; do
  if cmp -s "obedient-ai/hooks/$f" "antigravity/hooks/$f"; then ok "antigravity/hooks/$f in sync"; else bad "antigravity/hooks/$f out of sync (run tools/sync-targets.sh)"; fi
done
if diff -rq obedient-ai/skills antigravity/skills >/dev/null 2>&1; then ok "antigravity/skills in sync"; else bad "antigravity/skills out of sync (run tools/sync-targets.sh)"; fi

for name in $(grep -o '"[a-z-]*\.md"' opencode/index.ts | tr -d '"'); do
  if [ -s "obedient-ai/context/$name" ] || [ -s "obedient-ai/output-styles/$name" ]; then ok "$name exists"; else bad "$name named in opencode/index.ts but missing"; fi
done

for ref in $(grep -o 'CLAUDE_PLUGIN_ROOT}/[^"\\]*' obedient-ai/hooks/hooks.json | sed 's|CLAUDE_PLUGIN_ROOT}/||'); do
  if [ -e "obedient-ai/$ref" ]; then ok "hook path $ref exists"; else bad "hook path $ref missing"; fi
done

for ref in $(grep -o '"\./[^"]*"' obedient-ai/hooks/hooks.json | tr -d '"'); do
  if [ -e "obedient-ai/hooks/$ref" ]; then ok "module $ref exists"; else bad "module $ref missing"; fi
done

for ref in $(grep -o '"\./[^"]*"' token-guard/hooks/hooks.json | tr -d '"'); do
  if [ -e "token-guard/hooks/$ref" ]; then ok "token-guard module $ref exists"; else bad "token-guard module $ref missing"; fi
done

for dir in obedient-ai/skills/*/; do
  skill=$(basename "$dir")
  if [ ! -s "$dir/SKILL.md" ]; then bad "skills/$skill has no SKILL.md"; continue; fi
  declared=$(head -10 "$dir/SKILL.md" | sed -n 's/^name:[[:space:]]*//p' | head -1 | tr -d ' ')
  if [ "$declared" = "$skill" ]; then ok "skills/$skill name matches"; else bad "skills/$skill declares name '$declared'"; fi
done

# Smoke-test dual-protocol guard hooks (Claude Code + Antigravity).
check_hook() {
  local script=$1 input=$2 expect_rc=$3 expect_out=$4 label=$5
  local out rc
  out=$(printf '%s' "$input" | "$script" 2>&1)
  rc=$?
  if [ "$rc" -eq "$expect_rc" ] && [[ "$out" == *"$expect_out"* ]]; then
    ok "hook $label"
  else
    bad "hook $label (rc=$rc, out=$out)"
  fi
}

check_hook obedient-ai/hooks/block-dangerous-git.sh '{"tool_input":{"command":"git reset --hard"}}' 2 'BLOCKED by block-dangerous-git.sh' 'git claude deny'
check_hook obedient-ai/hooks/block-dangerous-git.sh '{"toolCall":{"name":"run_command","args":{"CommandLine":"git reset --hard"}}}' 0 '"decision":"deny"' 'git agy deny'
check_hook obedient-ai/hooks/block-dangerous-git.sh '{"toolCall":{"name":"run_command","args":{"CommandLine":"git status"}}}' 0 '"decision":"allow"' 'git agy allow'
check_hook obedient-ai/hooks/block-sleep.sh '{"tool_input":{"command":"sleep 30"}}' 2 'BLOCKED by block-sleep.sh' 'sleep claude deny'
check_hook obedient-ai/hooks/block-sleep.sh '{"toolCall":{"name":"run_command","args":{"CommandLine":"sleep 30"}}}' 0 '"decision":"deny"' 'sleep agy deny'
if command -v uv >/dev/null 2>&1; then
  check_hook obedient-ai/hooks/prefer-fast-tools.sh '{"tool_input":{"command":"pip install foo"}}' 2 'BLOCKED by prefer-fast-tools.sh' 'pip claude deny'
  check_hook obedient-ai/hooks/prefer-fast-tools.sh '{"toolCall":{"name":"run_command","args":{"CommandLine":"pip install foo"}}}' 0 '"decision":"deny"' 'pip agy deny'
fi

if [ "$fail" -ne 0 ]; then echo "validate: failures above"; exit 1; fi
echo "validate: all checks passed"
