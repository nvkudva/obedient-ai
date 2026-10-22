#!/bin/bash
# One-time machine setup for obedient-ai: installs or updates the CLI tools the
# rules expect, then merges claude-settings.json into ~/.claude/settings.json.
# Runs as the plugin's Setup hook: `claude --init-only`. Re-run to update.
# Works on macOS and Linux (Homebrew refuses to run as root).

if ! command -v brew >/dev/null; then
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
for prefix in /opt/homebrew /usr/local /home/linuxbrew/.linuxbrew; do
  [ -x "$prefix/bin/brew" ] && eval "$("$prefix/bin/brew" shellenv)" && break
done

brew install ripgrep fd ast-grep jq yq duckdb sd bun watchexec difftastic \
  jc htmlq scc ruff gitleaks gnu-sed coreutils bash

# Adds the allowlist and shell; keeps every other key and rule already in the file.
settings=~/.claude/settings.json
mkdir -p ~/.claude
[ -f "$settings" ] || echo '{}' > "$settings"
jq -s --arg shell "$(brew --prefix)/bin/bash" '
  .[0] as $mine | .[1] as $ours
  | ($mine * $ours)
  | .permissions.allow = (($mine.permissions.allow // []) + $ours.permissions.allow | unique)
  | .env.CLAUDE_CODE_SHELL = $shell
' "$settings" "$(dirname "$0")/claude-settings.json" > "$settings.tmp" && mv "$settings.tmp" "$settings"
echo "obedient-ai setup done"
