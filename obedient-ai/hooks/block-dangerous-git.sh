#!/bin/bash
# PreToolUse:Bash guard — blocks irreversible / destructive commands.
#
# Protocol: Claude Code pipes JSON on stdin: {"tool_name":"Bash","tool_input":{"command":"..."}}
#   exit 0 -> allow
#   exit 2 -> BLOCK; stderr is fed back to Claude as the reason
#   any other exit code -> non-blocking error (hook is ignored)
#
# Escape hatch: run with ALLOW_DANGEROUS_GIT=1 in the command to bypass, e.g.
#   ALLOW_DANGEROUS_GIT=1 git reset --hard HEAD~1
#
# Each command segment is checked on its own, after heredoc bodies and quoted
# strings are removed, so commit messages and a neighbouring command's flags
# (--no-ff, --dry-run, commit -F) cannot trigger a rule. Flags are matched as
# whole tokens and case-sensitively. Recursive rm is allowed when every target
# is an absolute path inside /tmp, /private/tmp (Claude's scratchpad) or
# $TMPDIR. Pure bash (3.2+) plus one jq call.
# Sourcing this file defines check_cmd without running the hook.

export LC_ALL=C
nl=$'\n'
reason=""
word=""
vars=""
_out=""
TMP_MARK=/tmp/.mktemp

block() { reason=$1; return 1; }

# Drop heredoc bodies, keeping the line that opens each heredoc. Bodies fed to
# a shell (bash <<EOF) are commands, so they are kept.
strip_heredocs() {
  local line delim="" t d
  local re='(^|[^<])<<-?[[:space:]]*[\"'\'']?([A-Za-z_][A-Za-z0-9_]*)'
  local re_shell='(^|[[:space:];&|(])(bash|sh|zsh)([[:space:]]+-[^[:space:]]+)*[[:space:]]*<<'
  _out=""
  while IFS= read -r line; do
    if [ -n "$delim" ]; then
      t=${line#"${line%%[![:space:]]*}"}
      [ "$t" = "$delim" ] && delim=""
      continue
    fi
    if [[ $line =~ $re ]]; then
      d=${BASH_REMATCH[2]}
      [[ $line =~ $re_shell ]] || delim=$d
    fi
    _out+=$line$nl
  done <<< "$1"
}

# Records NAME=VALUE assignments whose value is a literal or $(mktemp ...), one
# per line in $vars, so rm targets like $SP/deck can be resolved.
collect_vars() {
  local s=$1 name val
  local re='(^|[[:space:];&|(])(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=("[^"`$]*"|'\''[^'\'']*'\''|"?\$\(mktemp[^)]*\)"?|[^[:space:];&|"'\''`$()]+)(.*)$'
  vars=""
  while [[ $s =~ $re ]]; do
    name=${BASH_REMATCH[3]}
    val=${BASH_REMATCH[4]}
    s=${BASH_REMATCH[5]}
    case $val in
      *mktemp*) val=$TMP_MARK ;;
      \"*\"|\'*\') val=${val:1:${#val}-2} ;;
    esac
    vars+=$name=$val$nl
  done
}

# Sets $word to the last value assigned to $1 in the command ($TMPDIR from env).
var_value() {
  local line
  word=""
  while IFS= read -r line; do
    [ "${line%%=*}" = "$1" ] && word=${line#*=}
  done <<< "$vars"
  [ -z "$word" ] && [ "$1" = TMPDIR ] && word=${TMPDIR:-}
  return 0
}

# True if $1 resolves to a path strictly inside /tmp, /private/tmp or $TMPDIR.
is_temp_path() {
  local p=$1 rest tmpd=${TMPDIR%/}
  if [[ $p =~ ^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?(.*)$ ]]; then
    rest=${BASH_REMATCH[2]}
    var_value "${BASH_REMATCH[1]}"
    [ -n "$word" ] || return 1
    p=$word$rest
  fi
  case $p in
    *..*|*'$'*) return 1 ;;
    /tmp/[!*?]*|/private/tmp/[!*?]*) return 0 ;;
  esac
  if [ -n "$tmpd" ]; then
    case $p in "$tmpd"/[!*?]*) return 0 ;; esac
  fi
  return 1
}

# Replace every quoted string with an empty one: "fix: restore x" -> "".
# A single word ("$D/fake", "--force") is unquoted instead, and so are strings
# run as commands (bash -c '...', eval "...").
strip_quotes() {
  local s=$1 q rest inner
  local re_next='^([^"'\'']*)(["'\''])(.*)$'
  local re_sq="^([^']*)'(.*)$"
  local re_dq='^(([^"\\]|\\.)*)"(.*)$'
  local re_sh='(^|[[:space:];&|(])((bash|sh|zsh)[[:space:]]+-[A-Za-z]*c|eval)[[:space:]]*$'
  local re_word='^[^[:space:];&|(){}<>`"'\''\\]+$'
  _out=""
  while [[ $s =~ $re_next ]]; do
    _out+=${BASH_REMATCH[1]}
    q=${BASH_REMATCH[2]}
    rest=${BASH_REMATCH[3]}
    if [ "$q" = "'" ]; then
      if [[ $rest =~ $re_sq ]]; then inner=${BASH_REMATCH[1]}; s=${BASH_REMATCH[2]}; else inner=$rest; s=""; fi
    else
      if [[ $rest =~ $re_dq ]]; then inner=${BASH_REMATCH[1]}; s=${BASH_REMATCH[3]}; else inner=$rest; s=""; fi
    fi
    if [[ $_out =~ $re_sh ]]; then _out+=$nl$inner$nl
    elif [[ $inner =~ $re_word ]]; then _out+=$inner
    else _out+=$q$q; fi
  done
  _out+=$s
}

# long_opt --x ARGS: an arg is --x or --x=...   short_opt x ARGS: an arg like -abx.
long_opt() {
  local o=$1 a; shift
  for a in "$@"; do
    [ "$a" = "--" ] && return 1
    case $a in "$o"|"$o"=*) return 0 ;; esac
  done
  return 1
}
short_opt() {
  local l=$1 a; shift
  for a in "$@"; do
    [ "$a" = "--" ] && return 1
    [[ $a =~ ^-[A-Za-z]+$ && $a == *"$l"* ]] && return 0
  done
  return 1
}
# any_opt "f --force" ARGS: true if any listed short or long option is present.
any_opt() {
  local spec
  for spec in $1; do
    if [ ${#spec} -eq 1 ]; then short_opt "$spec" "${@:2}" && return 0
    else long_opt "$spec" "${@:2}" && return 0; fi
  done
  return 1
}
# Sets $word to the first argument that is not an option.
first_arg() {
  local a
  word=""
  for a in "$@"; do
    case $a in -*) ;; *) word=$a; return 0 ;; esac
  done
}

check_git() {
  while [ $# -gt 0 ]; do
    case $1 in
      -C|-c|--git-dir|--work-tree|--namespace|--config-env) shift 2 ;;
      -*) shift ;;
      *) break ;;
    esac
  done
  [ $# -eq 0 ] && return 0
  local sub=$1 a
  shift
  case $sub in
    reset)
      long_opt --hard "$@" && { block "git reset --hard discards all uncommitted changes"; return; }
      long_opt --merge "$@" && { block "git reset --merge can discard local changes"; return; }
      long_opt --keep "$@" && { block "git reset --keep can discard local changes"; return; } ;;
    checkout)
      any_opt "f --force" "$@" && { block "git checkout --force overwrites local modifications"; return; } ;;
    switch)
      any_opt "f --force --discard-changes" "$@" && { block "git switch --force discards local changes"; return; } ;;
    restore)
      if any_opt "s --source" "$@" || { any_opt "W --worktree" "$@" && any_opt "S --staged" "$@"; }; then
        block "git restore from another source overwrites working-tree files"; return
      fi ;;
    clean)
      any_opt "f --force" "$@" && { block "git clean -f permanently deletes untracked files"; return; } ;;
    rm)
      any_opt "f --force" "$@" && { block "git rm --force deletes files, including modified ones"; return; } ;;
    stash)
      first_arg "$@"
      case $word in drop|clear) block "git stash drop/clear permanently deletes stashed work"; return ;; esac ;;
    push)
      long_opt --force-with-lease "$@" && { block "force-push rewrites remote history (safer variant, still blocked)"; return; }
      any_opt "f --force" "$@" && { block "git push --force overwrites remote history for everyone"; return; }
      long_opt --mirror "$@" && { block "git push --mirror can delete every remote ref not present locally"; return; }
      any_opt "d --delete" "$@" && { block "git push --delete removes a remote branch or tag"; return; }
      for a in "$@"; do
        case $a in
          :?*) block "git push <remote> :branch deletes a remote branch"; return ;;
          +?*) block "git push <remote> +branch force-overwrites remote history"; return ;;
        esac
      done ;;
    filter-branch|filter-repo)
      block "git $sub rewrites all history irreversibly"; return ;;
    rebase)
      long_opt --abort "$@" || { block "git rebase rewrites commit history"; return; } ;;
    pull)
      for a in "$@"; do
        case $a in
          --) break ;;
          -r|--rebase|--rebase=true|--rebase=merges|--rebase=interactive) block "git rebase rewrites commit history"; return ;;
        esac
      done ;;
    commit)
      long_opt --amend "$@" && { block "git commit --amend rewrites the last commit"; return; } ;;
    branch)
      any_opt "d D --delete" "$@" && { block "deleting a branch can orphan unmerged commits"; return; } ;;
    tag)
      any_opt "d --delete" "$@" && { block "git tag -d deletes a tag"; return; } ;;
    update-ref)
      short_opt d "$@" && { block "git update-ref -d deletes a ref directly"; return; } ;;
    reflog)
      first_arg "$@"
      case $word in expire|delete) block "expiring the reflog removes the last safety net for recovering commits"; return ;; esac ;;
    gc)
      for a in "$@"; do
        case $a in --prune=now|--prune=all) block "git gc --prune=now permanently deletes unreachable objects"; return ;; esac
      done ;;
    prune)
      block "git prune permanently deletes unreachable objects"; return ;;
    worktree)
      first_arg "$@"
      if [ "$word" = remove ] && any_opt "f --force" "$@"; then
        block "forcibly removing a worktree discards its changes"; return
      fi ;;
  esac
  return 0
}

check_gh() {
  case "${1:-} ${2:-}" in
    "repo delete") block "gh repo delete permanently deletes the remote repository" ;;
    "repo archive") block "gh repo archive makes the repository read-only" ;;
    "release delete") block "gh release delete removes a published release" ;;
  esac
}

check_rm() {
  local a recursive=0 opts=1 all_tmp=1
  local -a targets
  for a in "$@"; do
    if [ $opts -eq 1 ]; then
      case $a in
        --) opts=0; continue ;;
        --recursive) recursive=1; continue ;;
        --*) continue ;;
        -?*) [[ $a == *[rR]* ]] && recursive=1; continue ;;
      esac
    fi
    targets[${#targets[@]}]=$a
    case $a in
      .git|.git/|*/.git|*/.git/) block "removing .git destroys the entire repository"; return ;;
    esac
  done
  [ $recursive -eq 1 ] || return 0
  for a in ${targets[@]+"${targets[@]}"}; do
    case $a in
      /|/\*) block "rm -rf / would destroy the filesystem"; return ;;
      "~"|"~/"|'$HOME'|'$HOME/') block "rm -rf on the home directory is catastrophic"; return ;;
    esac
    is_temp_path "$a" || all_tmp=0
  done
  [ ${#targets[@]} -gt 0 ] && [ $all_tmp -eq 1 ] && return 0
  block "recursive rm is not reversible -- use 'trash <path>' instead (restorable from Finder). rm -rf is allowed only on absolute paths inside /tmp, /private/tmp (the scratchpad) or \$TMPDIR. Note trash exits 5 on a missing path: guard with [ -e path ] && trash path. On SMB/NAS mounts trash fails: mv into a .trash dir on the same volume. Plain rm on a single known file is fine"
}

check_segment() {
  local seg=$1 c
  local re_lead='^[[:space:]]*(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*)|if|then|else|elif|do|while|until|time|sudo|command|builtin|exec|nohup|env|xargs|!|\{|-[^[:space:]]*)[[:space:]]+(.*)$'
  while [[ $seg =~ $re_lead ]]; do seg=${BASH_REMATCH[3]}; done
  local -a t
  read -ra t <<< "$seg"
  [ ${#t[@]} -eq 0 ] && return 0
  c=${t[0]##*/}
  case $c in
    git) check_git "${t[@]:1}" ;;
    gh) check_gh "${t[@]:1}" ;;
    rm) check_rm "${t[@]:1}" ;;
  esac
}

# check_cmd CMD: returns 1 and sets $reason when CMD is dangerous.
check_cmd() {
  local s sep seg
  reason=""
  strip_heredocs "$1"
  s=${_out//\\$nl/ }
  collect_vars "$s"
  strip_quotes "$s"
  s=${_out//&&/$nl}
  s=${s//||/$nl}
  for sep in ';' '|' '&' '(' ')' '`'; do s=${s//"$sep"/$nl}; done
  while IFS= read -r seg; do
    check_segment "$seg" || return 1
  done <<< "$s"
  return 0
}

[[ ${BASH_SOURCE[0]} != "$0" ]] && return 0

IFS= read -r -d '' payload

# Extract .tool_input.command — prefer jq, fall back to python3.
if command -v jq >/dev/null 2>&1; then
  cmd=$(jq -r '.tool_input.command // empty' <<< "$payload" 2>/dev/null)
else
  cmd=$(python3 -c \
    'import json,sys
try: print(json.load(sys.stdin).get("tool_input",{}).get("command","") or "")
except Exception: print("")' <<< "$payload" 2>/dev/null)
fi

# Nothing to inspect -> allow (never break the session on a parse failure).
[ -z "${cmd:-}" ] && exit 0

case "$cmd" in
  *ALLOW_DANGEROUS_GIT=1*) exit 0 ;;
esac

check_cmd "$cmd" && exit 0

printf 'BLOCKED by block-dangerous-git.sh: %s\n\n' "$reason" >&2
printf 'Command: %s\n\n' "$cmd" >&2
printf 'This operation is irreversible or destroys uncommitted/unpushed work.\n' >&2
printf 'If this is genuinely intended, ask the user to run it themselves, or\n' >&2
printf 'prefix it with ALLOW_DANGEROUS_GIT=1 after they confirm.\n' >&2
printf 'Safer alternatives: git revert, git stash, git switch -c, git restore --source=.\n' >&2
exit 2
