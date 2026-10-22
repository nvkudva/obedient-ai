#!/bin/bash
# Installs the CLI tools the obedient-ai rules expect. Run once per machine;
# re-run to update (brew install upgrades anything outdated).
brew install ripgrep fd ast-grep jq yq duckdb sd bun watchexec difftastic \
  jc htmlq scc ruff gitleaks gnu-sed coreutils bash
