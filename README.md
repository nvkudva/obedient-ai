# obedient-ai

A Claude Code plugin marketplace with two plugins. `obedient-ai` injects standing rules into every session, adds guard hooks for dangerous git, foreground sleeps and `pip install`, a keep-alive for the prompt cache, an optional output style, and four skills. `token-guard` warns before a session gets expensive and trims wasteful Reads. Both are for people who want Claude terse and cheap by default instead of repeating the same instructions each time.

It replaces keeping those rules in `~/.claude/CLAUDE.md`. Keep both and the same text loads twice per session.

## Requirements

- Claude Code, either the CLI or claude.ai cloud sessions
- A POSIX shell on PATH, plus `jq` for the guard hooks. On Windows without one, the hooks do nothing
- Git, if you install from a local clone
- macOS is the tested platform: `export-scratch.sh` builds a `/private/tmp` path, and token-guard downscales images with `sips`
- `setup.sh` is optional and does touch the network and your machine, see "Setup script" below
- No accounts or keys

## Run it

```bash
claude plugin marketplace add nvkudva/obedient-ai
claude plugin install obedient-ai@obedient-ai
```

From inside a session use `/plugin marketplace add nvkudva/obedient-ai` then `/plugin install obedient-ai@obedient-ai`.

From a local clone:

```bash
git clone https://github.com/nvkudva/obedient-ai.git
claude plugin marketplace add ./obedient-ai
```

On claude.ai: **Settings → Capabilities → Plugins → Add marketplace**, enter `nvkudva/obedient-ai`, then toggle **obedient-ai** on.

Start a new session and run `/plugin` or `claude plugin list`; obedient-ai should be listed as installed. Existing sessions need a restart.

## How it works

`obedient-ai/hooks/hooks.json` registers these hooks:

- `SessionStart`: asserts `${CLAUDE_PLUGIN_ROOT}/context/rules.md` is non-empty, then `cat`s it into the session context. A missing or empty file prints its path and exits 2, so a broken install fails loudly instead of starting a rule-free session.
- `SessionStart`: `hooks/export-scratch.sh` exports `$SCRATCH` (the session scratchpad path) and puts GNU `sed` and `timeout` first on PATH when Homebrew has them.
- `PreToolUse:Bash`: `block-dangerous-git.sh` blocks irreversible git and `rm` commands (list in `rules.md`, "Guardrails"). It is skipped in auto mode. Bypass one command with `ALLOW_DANGEROUS_GIT=1`.
- `PreToolUse:Bash`: `block-sleep.sh` blocks a foreground `sleep` over 10 seconds. Bypass with `ALLOW_SLEEP=1`.
- `PreToolUse:Bash`: `prefer-fast-tools.sh` blocks `pip install` when `uv` is installed. Bypass with `ALLOW_SLOW_TOOL=1`.
- `modules`: `hooks/cacheKeeper.ts` is a keep-alive. After `intervalMinutes` idle (default 55, for the 1-hour cache TTL) in a session over `minTokens` (150000) it sends a one-word ping up to `maxPings` times (2), then compacts. Each ping spends tokens. Set the three values in the plugin's user config; raise `minTokens` very high to effectively disable it.

There is no per-project override. The reply format (short numbered bullets, superscript numbers, lettered options) lives in one file, `obedient-ai/output-styles/mini.md`. In Claude Code it is an output style: select it with `/output-style` or `"outputStyle": "obedient-ai:mini"` in settings, and switch to any other style the same way. The OpenCode adapter injects the same file as plain rules. Keep no copy in `~/.claude/output-styles/`.

The rules payload is `obedient-ai/context/rules.md`: working style, writing code, code and coding style, reading and searching, delegation, `PLAN.md`/`TODO.md`, session hygiene, efficiency, and guardrails and browser. It assumes tools such as `trash`, `rg`, `uv` and the `handoff` agent; edit `rules.md` to match your machine.

OpenCode uses the same `rules.md` plus a second file, `obedient-ai/context/rules-opencode.md`, loaded by `opencode/index.ts`. Anything that is only true in OpenCode lives there — tool names (`shell` not `bash`), background jobs, subagent names, and the fact that the git guard hooks do not run — so the shared `rules.md` stays valid in every harness.

Four rules, verbatim, so you can judge the fit before installing:

- "Edit, never rewrite. Use the smallest `old_string` that is still unique."
- "Run targeted tests — one file, one test — not the suite, unless I ask."
- "If you fail 3 times at the same problem, or keep repeating the same approach, stop and tell me what you tried."
- "Before a deploy or any production step, ask me once, up front, for the whole sequence. Then run it without further prompts."

## Setup script

`obedient-ai/setup.sh` runs only from the plugin's `Setup` hook, which fires on `claude --init-only`, not on every session. It installs Homebrew if missing (`curl | bash` of the official installer), runs `brew install` for 18 CLI tools the rules expect (ripgrep, fd, ast-grep, jq, yq, duckdb, sd, bun, watchexec, difftastic, jc, htmlq, scc, ruff, gitleaks, gnu-sed, coreutils, bash), then merges `obedient-ai/claude-settings.json` into `~/.claude/settings.json`: a read-only Bash allowlist, `CLAUDE_CODE_SHELL`, and an auto-compact window. Your existing keys win over ours, and the old file is saved as `~/.claude/settings.json.bak`. Do not run it if you do not want Homebrew packages installed.

The plugin also bundles four skills, each loaded lazily when its description matches the request:

- `polish` (`obedient-ai/skills/polish/SKILL.md`) polishes any codebase without changing behavior: dead code removal, folder reorganization, file and function renames, test and doc tidy-up. It plans first, waits for approval, then commits one step at a time, following the code style rules in `rules.md`.
- `post` (`obedient-ai/skills/post/SKILL.md`) drafts LinkedIn posts in the author's voice. Drop a `voice.md` at `~/.config/obedient-ai/voice.md` to replace the built-in persona; the post-structure rules still apply.
- `marketing` (`obedient-ai/skills/marketing/SKILL.md`) analyses a project and builds a launch kit: a Remotion video (it first asks desktop 16:9, mobile 9:16 or both; desktop is the default), LinkedIn, X and Instagram posts, and a review-agent loop that iterates until the output is ship-quality. It needs Node and ffmpeg, and loads the separately installed `remotion-best-practices` skill.
- `learn-logs` (`obedient-ai/skills/learn-logs/SKILL.md`) audits a coding agent's own session logs for failures, repeated calls, latency and wasted context. It ships two DuckDB adapters, `queries/opencode.sql` and `queries/claude-code.sql`, both run against real stores before shipping, and encodes the traps that produce wrong conclusions — turn wall clock masquerading as tool latency, the legacy `part` table truncating the window, and shell calls that exit non-zero while reporting `completed`. Needs `duckdb`.

## Other agents

| Agent | Rules | Skills | Guard hooks, cacheKeeper, token-guard |
|---|---|---|---|
| Claude Code | yes | yes | yes |
| OpenCode | yes, via `opencode/index.ts` (typed against `@opencode/plugin` 2.0.32; not run in a live session) | yes, same adapter | no |
| pi | concatenate `rules.md` and the body of `output-styles/mini.md` into `~/.pi/agent/APPEND_SYSTEM.md` (per pi docs; not tested) | `pi install <path-to-clone>` reads the `pi.skills` entry in `package.json` (per pi docs; not tested) | no |

The hooks and the keep-alive use Claude Code's hook and mod APIs, so they do not port. In other agents the git, sleep and `pip` rules in `rules.md` are advice only. `rules.md` names some Claude Code tools (`run_in_background`, Monitor, ToolSearch, `old_string`); `rules-opencode.md` maps them for OpenCode, and pi has no equivalent file yet.

## token-guard

A second plugin in this marketplace: a Claude Code mod that warns before a session gets expensive and trims wasteful calls. Install with `claude plugin install token-guard@obedient-ai`, or try it from a clone with `claude --plugin-dir token-guard`.

- Status line shows context percent, cache time left, turns, calls and trimmed count; toasts at 150 turns and 300 calls (compact, or write a handoff and start fresh).
- A new, unrelated prompt in a session over 150k tokens asks whether to continue, start fresh or compact first.
- `cd dir && git …` is rewritten to `git -C dir …`.
- `Read` of a missing path is denied with a hint to run `rg --files` first.
- `Read` of a PNG or JPEG over 300 KB is downscaled with `sips -Z 1200` (macOS) and the smaller copy is read.
- `Read` of an unchanged file already read this session is denied; a changed modification time allows it. Passing `offset` or `limit` always allows it.
- `Read` of a file over 600 lines with no `offset` or `limit` is capped at 400 lines.
- `Bash` repeats and inline `python3 - <<` patch helpers raise a toast only; nothing is blocked.
- `/guard` prints the counters and the transcripts folder size.

Thresholds are constants at the top of `token-guard/hooks/register.ts`. Counters reset when the mod reloads.

## Layout

```
.claude-plugin/marketplace.json
.github/workflows/validate.yml
opencode/index.ts
tools/validate.sh
obedient-ai/
  .claude-plugin/plugin.json
  hooks/hooks.json
  hooks/{block-dangerous-git,block-sleep,prefer-fast-tools,export-scratch}.sh
  hooks/cacheKeeper.ts
  setup.sh
  claude-settings.json
  context/rules.md
  context/rules-opencode.md
  output-styles/mini.md
  skills/post/SKILL.md
  skills/marketing/SKILL.md
  skills/polish/SKILL.md
  skills/learn-logs/SKILL.md
  skills/learn-logs/queries/opencode.sql
  skills/learn-logs/queries/claude-code.sql
  skills/marketing/templates/{theme.ts,ui.tsx}
token-guard/
  .claude-plugin/plugin.json
  hooks/hooks.json
  hooks/register.ts
```

## Status

Version 0.24.1. The hooks and the skills work; the marketplace installs from GitHub and from a local path.

Fixed as of 22 October 2026:

- The session hook now asserts `context/rules.md` is non-empty. It prints the path and exits 2 instead of starting a session with no rules.
- The `post` skill no longer triggers on "help me write"; that phrase fired on emails, commits and docs.
- The `post` skill reads `~/.config/obedient-ai/voice.md` when present and uses it as the persona, falling back to the author's voice otherwise.
- `tools/validate.sh` checks the three JSON manifests, both rules files, every context file named in `opencode/index.ts`, every path `hooks.json` runs, and that each skill's `name` matches its directory. `.github/workflows/validate.yml` runs it on push and pull request.
- The `PLAN.md`/`TODO.md` section now applies only when the repo has one of those files.

Still open:

- The validator checks structure, not runtime. Nothing proves the hooks fire or that skills load in a live session.

## License

No licence file yet — all rights reserved.
