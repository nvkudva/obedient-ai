# OpenCode-specific rules

`rules.md` is shared with Claude Code, Reasonix and Gemini. Everything below is
true only in OpenCode. The loader in `opencode/index.ts` appends this file after
`rules.md`, so these lines win wherever the two disagree.

## Tool names

- The shell tool is `shell`. There is no `bash` tool. Emit only tool names that
  appear in the tool list.
- Long jobs: `shell` with `background: true`, then read the output. There is no
  `Monitor` tool and no `run_in_background` argument.
- Deferred tool discovery is `search(...)` inside `execute`, not `ToolSearch`.
- Subagents: `subagent` with `agent: "explore"` for searches over ~5 files,
  `"general"` only for work that writes files. Put the budget and return
  contract in the prompt.
- At about 300 tool calls, write a handoff file and tell me to start a fresh
  session. There is no `handoff` agent here.
- Browser control lives under the `browser` namespace. Read the page as text
  before taking a screenshot; screenshots are the biggest context cost.

## Editing

- Read the file immediately before editing it. Anchor `oldString` on two or three
  unique lines, never the whole block, and copy the whitespace exactly.
- Never pass identical `oldString` and `newString`.
- Prefer `edit` over `write` on an existing file; a full rewrite is slower.
- Do not re-read a file already read this session unless it changed.

## Shell

- Append `|| echo "FAILED=$?"` when the exit status matters. A non-zero exit
  still reports as a completed call.

## Safety

- No `block-dangerous-git.sh` hook runs in OpenCode. The git prohibitions in
  `rules.md` are **unenforced** here: nothing will stop you. Same list, same hard
  stop, and ask me first.
- Same for `prefer-fast-tools.sh` and `block-sleep.sh`: absent. The rules they
  back are still binding.

## Project context

- Project instructions live in `AGENTS.md`, not `CLAUDE.md`. Record the dev-server
  port there, as `rules.md` asks.
- If `$SCRATCH` is unset, use `$TMPDIR/opencode`.

## Web

- Do not guess documentation URLs: `websearch` first, then `webfetch` the result.
  Guessed URLs 404 often enough to waste the round trip.
