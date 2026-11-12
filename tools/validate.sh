#!/usr/bin/env bash
# Static checks for the plugin. CI runs this; run it locally before pushing.
set -uo pipefail

fail=0
ok()  { printf 'ok   %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1"; fail=1; }

cd "$(dirname "$0")/.." || exit 1

for f in .claude-plugin/marketplace.json obedient-ai/.claude-plugin/plugin.json obedient-ai/hooks/hooks.json obedient-ai/claude-settings.json token-guard/.claude-plugin/plugin.json token-guard/hooks/hooks.json; do
  if python3 -m json.tool "$f" >/dev/null 2>&1; then ok "$f parses"; else bad "$f does not parse"; fi
done

for f in obedient-ai/context/rules.md obedient-ai/context/rules-opencode.md; do
  if [ -s "$f" ]; then ok "$f non-empty"; else bad "$f missing or empty"; fi
done

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

if [ "$fail" -ne 0 ]; then echo "validate: failures above"; exit 1; fi
echo "validate: all checks passed"
