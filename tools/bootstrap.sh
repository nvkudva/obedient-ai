#!/bin/bash
# One-time machine setup for obedient-ai: installs or updates the CLI tools the
# rules expect, then merges the settings below into ~/.claude/settings.json.
# Run it by hand: `tools/bootstrap.sh`. Re-run to update.
# Works on macOS and Linux (Homebrew refuses to run as root).

if ! command -v brew >/dev/null; then
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
for prefix in /opt/homebrew /usr/local /home/linuxbrew/.linuxbrew; do
  [ -x "$prefix/bin/brew" ] && eval "$("$prefix/bin/brew" shellenv)" && break
done

brew install ripgrep fd ast-grep jq yq duckdb sd bun watchexec difftastic \
  jc htmlq scc ruff gitleaks gnu-sed coreutils bash

ours=$(cat <<'JSON'
{
  "env": {
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "200000"
  },
  "permissions": {
    "allow": [
      "Bash(cat *)",
      "Bash(diff *)",
      "Bash(file *)",
      "Bash(gh pr checks*)",
      "Bash(gh pr list*)",
      "Bash(gh pr view*)",
      "Bash(git branch --show-current)",
      "Bash(git diff*)",
      "Bash(git -C * diff*)",
      "Bash(git -C * log*)",
      "Bash(git -C * show*)",
      "Bash(git -C * status*)",
      "Bash(git log*)",
      "Bash(git show*)",
      "Bash(git status*)",
      "Bash(head *)",
      "Bash(jq *)",
      "Bash(ls *)",
      "Bash(ls)",
      "Bash(pwd)",
      "Bash(rg *)",
      "Bash(sed -n *)",
      "Bash(stat *)",
      "Bash(tail *)",
      "Bash(wc *)",
      "Bash(which *)"
    ]
  }
}
JSON
)

# Adds the allowlist and shell; your existing keys win, and the old file is saved as settings.json.bak.
settings=~/.claude/settings.json
mkdir -p ~/.claude
[ -f "$settings" ] || echo '{}' > "$settings"
cp "$settings" "$settings.bak"
jq -s --arg shell "$(brew --prefix)/bin/bash" '
  .[0] as $mine | .[1] as $ours
  | ($ours * $mine)
  | .permissions.allow = (($mine.permissions.allow // []) + $ours.permissions.allow | unique)
  | .env.CLAUDE_CODE_SHELL = $shell
' "$settings" <(printf '%s\n' "$ours") > "$settings.tmp" && mv "$settings.tmp" "$settings"
echo "obedient-ai setup done"
