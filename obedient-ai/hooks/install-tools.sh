#!/bin/bash
# Owns the list of fast CLI tools the plugin recommends.
#
#   install-tools.sh --missing     print the commands that are not installed
#   install-tools.sh [cmd...]      install the given commands (default: all missing)
#
# macOS: brew bottles. Linux (including Claude Code cloud sessions): prebuilt
# GitHub release binaries, downloaded in parallel. Nothing compiles, no apt, no
# sudo, no GitHub API calls (the latest version comes from the release redirect,
# so shared cloud IPs don't hit the API rate limit).

set -uo pipefail

# command:brew-formula
tools=(
  rg:ripgrep
  fd:fd
  ast-grep:ast-grep
  jq:jq
  yq:yq
  duckdb:duckdb
  sd:sd
  bunx:oven-sh/bun/bun
  watchexec:watchexec
  difft:difftastic
  jc:jc
  htmlq:htmlq
  scc:scc
  ruff:ruff
  gitleaks:gitleaks
)

unavailable() {
  [ "$1" = htmlq ] && [ "$(uname -s)" = Linux ] && [ "$(uname -m)" != x86_64 ]
}

missing_tools() {
  for t in "${tools[@]}"; do
    unavailable "${t%%:*}" && continue
    command -v "${t%%:*}" >/dev/null 2>&1 || echo "${t%%:*}"
  done
}

formula_for() {
  for t in "${tools[@]}"; do
    [ "${t%%:*}" = "$1" ] && echo "${t#*:}"
  done
}

if [ "${1:-}" = "--missing" ]; then
  missing_tools
  exit 0
fi

if [ $# -gt 0 ]; then
  wanted=("$@")
else
  wanted=($(missing_tools))
fi
[ ${#wanted[@]} -eq 0 ] && exit 0

if [ "$(uname -s)" = "Darwin" ]; then
  command -v brew >/dev/null 2>&1 || { echo "install-tools: install Homebrew from https://brew.sh, then re-run." >&2; exit 1; }
  formulae=()
  for cmd in "${wanted[@]}"; do formulae+=("$(formula_for "$cmd")"); done
  HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_ENV_HINTS=1 brew install "${formulae[@]}"
  exit $?
fi

case $(uname -m) in
  aarch64|arm64) X=aarch64; G=arm64 ;;
  *) X=x86_64; G=amd64 ;;
esac

BIN=/usr/local/bin
[ -w "$BIN" ] || BIN="$HOME/.local/bin"
mkdir -p "$BIN"

GH=https://github.com
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Prints the latest release tag, read from the redirect of /releases/latest.
latest_tag() {
  local url
  url=$(curl -fsSIL -o /dev/null -w '%{url_effective}' "$GH/$1/releases/latest") || return 1
  echo "${url##*/}"
}

# fetch <url> <binary...>: download, unpack by extension, install the named binaries.
fetch() {
  local url=$1 dir file
  shift
  dir=$(mktemp -d "$WORK/x.XXXX")
  file="$dir/${url##*/}"
  curl -fsSL "$url" -o "$file" || return 1
  case $file in
    *.tar.gz|*.tgz) tar -xzf "$file" -C "$dir" ;;
    *.tar.xz) tar -xJf "$file" -C "$dir" ;;
    *.zip) unzip -q -o "$file" -d "$dir" 2>/dev/null || python3 -m zipfile -e "$file" "$dir" ;;
    *.gz) gunzip "$file" && mv "${file%.gz}" "$dir/$1" ;;
    *) mv "$file" "$dir/$1" ;;
  esac || return 1
  local bin path
  for bin in "$@"; do
    path=$(find "$dir" -type f -name "$bin" | head -1)
    [ -n "$path" ] || return 1
    install -m 755 "$path" "$BIN/$bin" || return 1
  done
}

install_one() {
  local tag
  case $1 in
    rg) tag=$(latest_tag BurntSushi/ripgrep) && fetch "$GH/BurntSushi/ripgrep/releases/download/$tag/ripgrep-$tag-$X-unknown-linux-musl.tar.gz" rg ;;
    fd) tag=$(latest_tag sharkdp/fd) && fetch "$GH/sharkdp/fd/releases/download/$tag/fd-$tag-$X-unknown-linux-musl.tar.gz" fd ;;
    ast-grep) fetch "$GH/ast-grep/ast-grep/releases/latest/download/app-$X-unknown-linux-gnu.zip" ast-grep sg ;;
    jq) fetch "$GH/jqlang/jq/releases/latest/download/jq-linux-$G" jq ;;
    yq) fetch "$GH/mikefarah/yq/releases/latest/download/yq_linux_$G" yq ;;
    duckdb) fetch "$GH/duckdb/duckdb/releases/latest/download/duckdb_cli-linux-$G.gz" duckdb ;;
    sd) tag=$(latest_tag chmln/sd) && fetch "$GH/chmln/sd/releases/download/$tag/sd-$tag-$X-unknown-linux-musl.tar.gz" sd ;;
    bunx)
      local arch=x64
      [ "$X" = aarch64 ] && arch=aarch64
      fetch "$GH/oven-sh/bun/releases/latest/download/bun-linux-$arch.zip" bun && ln -sf "$BIN/bun" "$BIN/bunx" ;;
    watchexec) tag=$(latest_tag watchexec/watchexec) && fetch "$GH/watchexec/watchexec/releases/download/$tag/watchexec-${tag#v}-$X-unknown-linux-musl.tar.xz" watchexec ;;
    difft)
      local libc=musl
      [ "$X" = aarch64 ] && libc=gnu
      tag=$(latest_tag Wilfred/difftastic) && fetch "$GH/Wilfred/difftastic/releases/download/$tag/difft-$tag-$X-unknown-linux-$libc.tar.gz" difft ;;
    jc) tag=$(latest_tag kellyjonbrazil/jc) && fetch "$GH/kellyjonbrazil/jc/releases/download/$tag/jc-${tag#v}-linux-$X.tar.gz" jc ;;
    htmlq) [ "$X" = x86_64 ] || { echo "install-tools: htmlq has no Linux $X build" >&2; return 1; }
      fetch "$GH/mgdm/htmlq/releases/latest/download/htmlq-x86_64-linux.tar.gz" htmlq ;;
    scc) fetch "$GH/boyter/scc/releases/latest/download/scc_Linux_$([ "$X" = aarch64 ] && echo arm64 || echo x86_64).tar.gz" scc ;;
    ruff) fetch "$GH/astral-sh/ruff/releases/latest/download/ruff-$X-unknown-linux-musl.tar.gz" ruff ;;
    gitleaks) tag=$(latest_tag gitleaks/gitleaks) && fetch "$GH/gitleaks/gitleaks/releases/download/$tag/gitleaks_${tag#v}_linux_$([ "$X" = aarch64 ] && echo arm64 || echo x64).tar.gz" gitleaks ;;
    *) echo "install-tools: unknown tool $1" >&2; return 1 ;;
  esac
}

for cmd in "${wanted[@]}"; do
  ( install_one "$cmd" >/dev/null 2>"$WORK/err.$cmd" || touch "$WORK/failed.$cmd" ) &
done
wait

failed=()
for cmd in "${wanted[@]}"; do
  [ -e "$WORK/failed.$cmd" ] && failed+=("$cmd") && cat "$WORK/err.$cmd" >&2
done

case ":$PATH:" in *":$BIN:"*) ;; *) echo "install-tools: add $BIN to PATH" >&2 ;; esac
if [ ${#failed[@]} -gt 0 ]; then
  echo "install-tools: failed: ${failed[*]}" >&2
  exit 1
fi
echo "install-tools: installed ${wanted[*]} in $BIN"
