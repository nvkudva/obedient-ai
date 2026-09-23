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

set -uo pipefail

payload=$(cat)

# Extract .tool_input.command — prefer jq, fall back to python3.
if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null)
else
  cmd=$(printf '%s' "$payload" | python3 -c \
    'import json,sys
try: print(json.load(sys.stdin).get("tool_input",{}).get("command","") or "")
except Exception: print("")' 2>/dev/null)
fi

# Nothing to inspect -> allow (never break the session on a parse failure).
[ -z "${cmd:-}" ] && exit 0

# Explicit opt-out.
case "$cmd" in
  *ALLOW_DANGEROUS_GIT=1*) exit 0 ;;
esac

# Normalize: collapse whitespace, lowercase. Keeps regexes simple.
norm=$(printf '%s' "$cmd" | tr '\n' ' ' | tr -s '[:space:]' ' ' | tr '[:upper:]' '[:lower:]')

deny() {
  printf 'BLOCKED by block-dangerous-git.sh: %s\n\n' "$1" >&2
  printf 'Command: %s\n\n' "$cmd" >&2
  printf 'This operation is irreversible or destroys uncommitted/unpushed work.\n' >&2
  printf 'If this is genuinely intended, ask the user to run it themselves, or\n' >&2
  printf 'prefix it with ALLOW_DANGEROUS_GIT=1 after they confirm.\n' >&2
  printf 'Safer alternatives: git revert, git stash, git switch -c, git restore --source=.\n' >&2
  exit 2
}

m() { printf '%s' "$norm" | grep -Eq "$1"; }

# ---------------------------------------------------------------------------
# 1. History / working-tree destruction
# ---------------------------------------------------------------------------
m '(^|[;&|]) *git .*reset .*--hard'          && deny "git reset --hard discards all uncommitted changes"
m '(^|[;&|]) *git .*reset .*--merge'         && deny "git reset --merge can discard local changes"
m '(^|[;&|]) *git .*reset .*--keep'          && deny "git reset --keep can discard local changes"
m '(^|[;&|]) *git +([^"'\''|;&]*[[:space:]])?checkout[[:space:]]+[^"'\''|;&]*(-[a-z]*f([^a-z-]|$)|--force)' && deny "git checkout --force overwrites local modifications"
m '(^|[;&|]) *git .*switch .*(-f|--force|--discard-changes)' && deny "git switch --force discards local changes"
m '(^|[;&|]) *git .*restore .*(-s|--source|--worktree.*--staged|--staged.*--worktree)' && deny "git restore from another source overwrites working-tree files"
m '(^|[;&|]) *git .*clean .*-[a-z]*f'        && deny "git clean -f permanently deletes untracked files"
m '(^|[;&|]) *git +([^"'\''|;&]*[[:space:]])?rm[[:space:]]+[^"'\''|;&]*(-[a-z]*f([^a-z-]|$)|--force)'       && deny "git rm --force deletes files, including modified ones"
m '(^|[;&|]) *git .*stash (drop|clear)'      && deny "git stash drop/clear permanently deletes stashed work"

# ---------------------------------------------------------------------------
# 2. Rewriting published/shared history
# ---------------------------------------------------------------------------
m '(^|[;&|]) *git +([^"'\''|;&]*[[:space:]])?push[[:space:]]+[^"'\''|;&]*(-f|--force)([^-]|$)' && deny "git push --force overwrites remote history for everyone"
m '(^|[;&|]) *git .*push .*--force-with-lease'   && deny "force-push rewrites remote history (safer variant, still blocked)"
m '(^|[;&|]) *git .*push .*--mirror'             && deny "git push --mirror can delete every remote ref not present locally"
m '(^|[;&|]) *git .*push .*(^|[[:space:]]):[a-z0-9._/-]' && deny "git push <remote> :branch deletes a remote branch"
m '(^|[;&|]) *git .*push .*--delete'             && deny "git push --delete removes a remote branch or tag"
m '(^|[;&|]) *git .*filter-branch'               && deny "git filter-branch rewrites all history irreversibly"
m '(^|[;&|]) *git +filter-repo'                  && deny "git filter-repo rewrites all history irreversibly"
m '(^|[;&|]) *git .*rebase'                      && deny "git rebase rewrites commit history"
m '(^|[;&|]) *git .*commit .*--amend'            && deny "git commit --amend rewrites the last commit"
m '(^|[;&|]) *git .*branch .*(-d|-delete)'       && deny "deleting a branch can orphan unmerged commits"
m '(^|[;&|]) *git .*tag .*-d'                    && deny "git tag -d deletes a tag"
m '(^|[;&|]) *git .*update-ref .*-d'             && deny "git update-ref -d deletes a ref directly"

# ---------------------------------------------------------------------------
# 3. Repo / object-store destruction
# ---------------------------------------------------------------------------
m 'rm +(-[a-z]* +)*.*\.git( |/|$)'   && deny "removing .git destroys the entire repository"
m '(^|[;&|]) *git .*reflog +(expire|delete)' && deny "expiring the reflog removes the last safety net for recovering commits"
m '(^|[;&|]) *git .*gc .*--prune=(now|all)'  && deny "git gc --prune=now permanently deletes unreachable objects"
m '(^|[;&|]) *git .*prune([^-]|$)'           && deny "git prune permanently deletes unreachable objects"
m '(^|[;&|]) *git .*worktree +remove .*(-f|--force)' && deny "forcibly removing a worktree discards its changes"

# ---------------------------------------------------------------------------
# 4. Remote-platform destruction (GitHub CLI)
# ---------------------------------------------------------------------------
m '(^|[;&|]) *gh +repo +delete'    && deny "gh repo delete permanently deletes the remote repository"
m '(^|[;&|]) *gh +repo +archive'   && deny "gh repo archive makes the repository read-only"
m '(^|[;&|]) *gh +release +delete' && deny "gh release delete removes a published release"

# ---------------------------------------------------------------------------
# 5. Non-git catastrophes worth catching here
# ---------------------------------------------------------------------------
m 'rm +-[a-z]*r[a-z]* +(-[a-z]+ +)*/( |$)'  && deny "rm -rf / would destroy the filesystem"
m 'rm +-[a-z]*r[a-z]* +(-[a-z]+ +)*~( |/|$)' && deny "rm -rf on the home directory is catastrophic"
m '(^|[;&|]) *rm +(-{1,2}[a-z-]+ +)*(-[a-z]*r[a-z]*|--recursive)' && deny "recursive rm is not reversible -- use 'trash <path>' instead (restorable from Finder). Note trash exits 5 on a missing path: guard with [ -e path ] && trash path. On SMB/NAS mounts trash fails: mv into a .trash dir on the same volume. Plain rm on a single known file is fine"

exit 0
