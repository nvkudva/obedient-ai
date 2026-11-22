#!/usr/bin/env bash
# Static checks for the plugin. CI runs this; run it locally before pushing.
set -uo pipefail

fail=0
ok()  { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; fail=1; }

cd "$(dirname "$0")/.." || exit 1

claude=dist/claude
for f in .claude-plugin/marketplace.json $claude/obedient-ai/.claude-plugin/plugin.json $claude/obedient-ai/hooks/hooks.json tools/claude-settings.json $claude/token-saver/.claude-plugin/plugin.json $claude/token-saver/hooks/hooks.json dist/antigravity/plugin.json dist/antigravity/hooks.json; do
  if python3 -m json.tool "$f" >/dev/null 2>&1; then ok "$f parses"; else bad "$f does not parse"; fi
done

for f in core/context/rules.md core/context/rules-opencode.md core/context/rules-antigravity.md dist/antigravity/rules/AGENTS.md dist/pi/APPEND_SYSTEM.md; do
  if [ -s "$f" ]; then ok "$f non-empty"; else bad "$f missing or empty"; fi
done

for source in $(grep -o '"source": "[^"]*"' .claude-plugin/marketplace.json | cut -d'"' -f4); do
  if [ -f "$source/.claude-plugin/plugin.json" ]; then ok "marketplace source $source"; else bad "marketplace source $source has no plugin.json"; fi
done

# Generated files must equal a fresh build from core/. Build in a copy so a dirty tree cannot confuse it.
scratch=$(mktemp -d)
tar --exclude=node_modules --exclude=.git -cf - . | tar -xf - -C "$scratch"
"$scratch/tools/sync.sh"
if diff -r dist "$scratch/dist" >/dev/null 2>&1; then ok "dist/ in sync with core/"; else bad "dist/ out of sync (run tools/sync.sh)"; fi
rm -rf "$scratch"

for name in $(grep -o '"[a-z-]*\.md"' dist/opencode/index.ts | tr -d '"'); do
  if [ -s "core/context/$name" ] || [ -s "core/output-styles/$name" ]; then ok "$name exists"; else bad "$name named in dist/opencode/index.ts but missing"; fi
done

for ref in $(grep -o 'CLAUDE_PLUGIN_ROOT}/[^"\\]*' dist/claude/obedient-ai/hooks/hooks.json | sed 's|CLAUDE_PLUGIN_ROOT}/||'); do
  if [ -e "dist/claude/obedient-ai/$ref" ]; then ok "hook path $ref exists"; else bad "hook path $ref missing"; fi
done

for ref in $(grep -o '"\./[^"]*"' dist/claude/obedient-ai/hooks/hooks.json | tr -d '"'); do
  if [ -e "dist/claude/obedient-ai/hooks/$ref" ]; then ok "module $ref exists"; else bad "module $ref missing"; fi
done

for ref in $(grep -o '"\./[^"]*"' dist/claude/token-saver/hooks/hooks.json | tr -d '"'); do
  if [ -e "dist/claude/token-saver/hooks/$ref" ]; then ok "token-saver module $ref exists"; else bad "token-saver module $ref missing"; fi
done

for dir in core/skills/*/; do
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

check_hook core/guards/block-dangerous-git.sh '{"tool_input":{"command":"git reset --hard"}}' 2 'BLOCKED by block-dangerous-git.sh' 'git claude deny'
check_hook core/guards/block-dangerous-git.sh '{"toolCall":{"name":"run_command","args":{"CommandLine":"git reset --hard"}}}' 0 '"decision":"deny"' 'git agy deny'
check_hook core/guards/block-dangerous-git.sh '{"toolCall":{"name":"run_command","args":{"CommandLine":"git status"}}}' 0 '"decision":"allow"' 'git agy allow'
check_hook core/guards/block-sleep.sh '{"tool_input":{"command":"sleep 30"}}' 2 'BLOCKED by block-sleep.sh' 'sleep claude deny'
check_hook core/guards/block-sleep.sh '{"toolCall":{"name":"run_command","args":{"CommandLine":"sleep 30"}}}' 0 '"decision":"deny"' 'sleep agy deny'
if command -v uv >/dev/null 2>&1; then
  check_hook core/guards/prefer-fast-tools.sh '{"tool_input":{"command":"pip install foo"}}' 2 'BLOCKED by prefer-fast-tools.sh' 'pip claude deny'
  check_hook core/guards/prefer-fast-tools.sh '{"toolCall":{"name":"run_command","args":{"CommandLine":"pip install foo"}}}' 0 '"decision":"deny"' 'pip agy deny'
fi

if [ "$fail" -ne 0 ]; then echo "validate: failures above"; exit 1; fi
echo "validate: all checks passed"
