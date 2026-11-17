#!/bin/bash
# Shared PreToolUse hook helper for Claude Code and Antigravity.
# Source this file, then call:
#   parse_hook_payload   # sets HOOK_HARNESS, HOOK_CMD, HOOK_BG, HOOK_AUTO, payload
#   emit_allow           # exits 0 (prints {"decision":"allow"} for Antigravity)
#   emit_deny "$msg"     # exits 2 + stderr for Claude; {"decision":"deny","reason":...} + exit 0 for Antigravity

HOOK_HARNESS=""
HOOK_CMD=""
HOOK_BG="false"
HOOK_AUTO="false"
payload=""

parse_hook_payload() {
  IFS= read -r -d '' payload

  if command -v jq >/dev/null 2>&1; then
    local meta
    meta=$(jq -r '
      if (.toolCall? != null) then
        "antigravity " + ((.toolCall.args.IsDaemon // false) | tostring) + " false"
      else
        "claude " + ((.tool_input.run_in_background // false) | tostring) + " " + ((.permission_mode == "auto") | tostring)
      end
    ' <<< "$payload" 2>/dev/null)
    if [ -n "$meta" ]; then
      read -r HOOK_HARNESS HOOK_BG HOOK_AUTO <<< "$meta"
      if [ "$HOOK_HARNESS" = "antigravity" ]; then
        HOOK_CMD=$(jq -r '.toolCall.args.CommandLine // empty' <<< "$payload" 2>/dev/null)
      else
        HOOK_CMD=$(jq -r '.tool_input.command // empty' <<< "$payload" 2>/dev/null)
      fi
      return 0
    fi
  fi

  if command -v python3 >/dev/null 2>&1; then
    local meta
    meta=$(python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if isinstance(d.get("toolCall"), dict):
    args = d["toolCall"].get("args") or {}
    bg = "true" if args.get("IsDaemon") else "false"
    print(f"antigravity {bg} false")
else:
    ti = d.get("tool_input") or {}
    bg = "true" if ti.get("run_in_background") else "false"
    auto = "true" if d.get("permission_mode") == "auto" else "false"
    print(f"claude {bg} {auto}")
' <<< "$payload" 2>/dev/null)
    if [ -n "$meta" ]; then
      read -r HOOK_HARNESS HOOK_BG HOOK_AUTO <<< "$meta"
      HOOK_CMD=$(python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
    if isinstance(d.get("toolCall"), dict):
        print((d["toolCall"].get("args") or {}).get("CommandLine") or "")
    else:
        print((d.get("tool_input") or {}).get("command") or "")
except Exception:
    pass
' <<< "$payload" 2>/dev/null)
      return 0
    fi
  fi

  HOOK_HARNESS="claude"
  HOOK_CMD=""
}

emit_allow() {
  if [ "$HOOK_HARNESS" = "antigravity" ]; then
    printf '{"decision":"allow"}\n'
  fi
  exit 0
}

emit_deny() {
  local msg=$1
  if [ "$HOOK_HARNESS" = "antigravity" ]; then
    if command -v jq >/dev/null 2>&1; then
      jq -cRn --arg r "$msg" '{"decision":"deny","reason":$r}'
    else
      python3 -c 'import json,sys; print(json.dumps({"decision":"deny","reason":sys.argv[1]}))' "$msg"
    fi
    exit 0
  fi
  printf '%s\n' "$msg" >&2
  exit 2
}
