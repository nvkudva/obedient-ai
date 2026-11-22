# Antigravity-specific rules

`rules.md` is shared with Claude Code, OpenCode, and pi. Everything below is true
only in Antigravity, so these lines win wherever the two disagree.

## Tool names

- The shell tool is `run_command`. There is no `bash` or `Bash` tool.
- File tools are `read_file` (use `StartLine` and `EndLine` for targeted slices),
  `edit_file` (`Target` / `Replacement`), and `write_file`.
- Subagents: use `invoke_subagent` (`research` for read-only exploration,
  `self` for isolated tasks), or `delegate_task` when a separate checkout
  (`isolation: "worktree"`) or another provider/model is requested.
- Long jobs: call `run_command` with a short `WaitMsBeforeAsync` (e.g. `500`) or
  `IsDaemon: true` for servers/watchers. The system wakes you when a background
  task finishes — never poll in a loop or use `sleep` as a timer.
- User decisions: use `ask_question` for multi-choice decisions.
- Browser & devices: use `preview_*` tools for browser tasks and `device_*` +
  `agent-device` for simulators/emulators when available.

## Safety

- `block-dangerous-git.sh`, `block-sleep.sh`, and `prefer-fast-tools.sh` are
  enforced via Antigravity `PreToolUse` hooks on `run_command`.

## Project context

- Project instructions live in `AGENTS.md` or `GEMINI.md` (and `.agents/rules/`),
  not `CLAUDE.md`.
- Scratch files go in `<appDataDir>/brain/<conversation-id>/scratch/` or `$TMPDIR`.
