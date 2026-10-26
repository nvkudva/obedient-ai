# obedient-ai

A Claude Code plugin marketplace with one plugin that injects a fixed set of standing rules into every session, for people who want Claude terse by default instead of repeating the same instructions each time.

It replaces keeping those rules in `~/.claude/CLAUDE.md`. Keep both and the same text loads twice per session.

## Requirements

- Claude Code, either the CLI or claude.ai cloud sessions
- A POSIX shell on PATH — the session hook runs `cat`, so it silently does nothing on a Windows install without one
- Git, if you install from a local clone
- No accounts, keys, dependencies or network calls

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

`obedient-ai/hooks/hooks.json` registers one `SessionStart` command that asserts `${CLAUDE_PLUGIN_ROOT}/context/rules.md` is non-empty, then `cat`s it; Claude Code appends the output to the session context. A missing or empty file prints its path and exits 2, so a broken install fails loudly instead of starting a rule-free session. There is no state, no config and no per-project override. The payload is `obedient-ai/context/rules.md` — 141 lines under seven headings: response length, working style, writing code, reading and searching, delegation, `PLAN.md`/`TODO.md`, and session hygiene.

OpenCode uses the same `rules.md` plus a second file, `obedient-ai/context/rules-opencode.md`, loaded by `opencode/index.ts`. Anything that is only true in OpenCode lives there — tool names (`shell` not `bash`), background jobs, subagent names, and the fact that the git guard hooks do not run — so the shared `rules.md` stays valid in every harness.

Four rules, verbatim, so you can judge the fit before installing:

- "Default ceiling: 6 lines. To exceed it, the extra lines must be information I asked for, not context you decided I need."
- "Edit, never rewrite. Use the smallest `old_string` that is still unique."
- "Never cat/read an entire file when you need part of it. Use `rg -n` (or `grep -n`) to locate, then read a bounded range around the hit."
- "Max 3 subagents per task. If a task seems to need more, it's scoped wrong — tell me and wait."

The plugin also bundles four skills, each loaded lazily when its description matches the request:

- `polish` (`obedient-ai/skills/polish/SKILL.md`) polishes any codebase without changing behavior: dead code removal, folder reorganization, file and function renames, test and doc tidy-up. It plans first, waits for approval, then commits one step at a time, following the code style rules in `rules.md`.
- `linkedin-post` (`obedient-ai/skills/linkedin-post/SKILL.md`) drafts LinkedIn posts in the author's voice. Drop a `voice.md` at `~/.config/obedient-ai/voice.md` to replace the built-in persona; the post-structure rules still apply.
- `marketing` (`obedient-ai/skills/marketing/SKILL.md`) analyses a project and builds a launch kit: a Remotion video in a 16:9 cut (9:16 mobile cut on request), LinkedIn, X and Instagram posts, and a review-agent loop that iterates until the output is ship-quality. It needs Node and ffmpeg, and loads the separately installed `remotion-best-practices` skill.
- `analyze-coding-agent-logs` (`obedient-ai/skills/analyze-coding-agent-logs/SKILL.md`) audits a coding agent's own session logs for failures, repeated calls, latency and wasted context. It ships two DuckDB adapters, `queries/opencode.sql` and `queries/claude-code.sql`, both run against real stores before shipping, and encodes the traps that produce wrong conclusions — turn wall clock masquerading as tool latency, the legacy `part` table truncating the window, and shell calls that exit non-zero while reporting `completed`. Needs `duckdb`.

## Layout

```
.claude-plugin/marketplace.json
.github/workflows/validate.yml
opencode/index.ts
tools/validate.sh
obedient-ai/
  .claude-plugin/plugin.json
  hooks/hooks.json
  context/rules.md
  context/rules-opencode.md
  skills/linkedin-post/SKILL.md
  skills/marketing/SKILL.md
  skills/polish/SKILL.md
  skills/analyze-coding-agent-logs/SKILL.md
  skills/analyze-coding-agent-logs/queries/opencode.sql
  skills/analyze-coding-agent-logs/queries/claude-code.sql
  skills/marketing/templates/{theme.ts,ui.tsx}
```

## Status

Version 0.20.1. The hook and the skills work; the marketplace installs from GitHub and from a local path.

Fixed as of 22 October 2026:

- The session hook now asserts `context/rules.md` is non-empty. It prints the path and exits 2 instead of starting a session with no rules.
- The `linkedin-post` skill no longer triggers on "help me write"; that phrase fired on emails, commits and docs.
- The `linkedin-post` skill reads `~/.config/obedient-ai/voice.md` when present and uses it as the persona, falling back to the author's voice otherwise.
- `tools/validate.sh` checks the three JSON manifests, both rules files, every context file named in `opencode/index.ts`, every path `hooks.json` runs, and that each skill's `name` matches its directory. `.github/workflows/validate.yml` runs it on push and pull request.
- The `PLAN.md`/`TODO.md` section now applies only when the repo has one of those files.

Still open:

- The validator checks structure, not runtime. Nothing proves the hooks fire or that skills load in a live session.

## License

No licence file yet — all rights reserved.
