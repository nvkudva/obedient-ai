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

`obedient-ai/hooks/hooks.json` registers one `SessionStart` command, `cat "${CLAUDE_PLUGIN_ROOT}/context/rules.md"`, and Claude Code appends the output to the session context. There is no state, no config and no per-project override. The payload is `obedient-ai/context/rules.md` — 99 lines under seven headings: response length, working style, writing code, reading and searching, delegation, `PLAN.md`/`TODO.md`, and session hygiene.

Four rules, verbatim, so you can judge the fit before installing:

- "Default ceiling: 6 lines. To exceed it, the extra lines must be information I asked for, not context you decided I need."
- "Edit, never rewrite. Use the smallest `old_string` that is still unique."
- "Never cat/read an entire file when you need part of it. Use `rg -n` (or `grep -n`) to locate, then read a bounded range around the hit."
- "Max 3 subagents per task. If a task seems to need more, it's scoped wrong — tell me and wait."

The plugin also bundles a `linkedin-post` skill at `obedient-ai/skills/linkedin-post/SKILL.md`, loaded lazily when its description matches the request.

## Layout

```
.claude-plugin/marketplace.json
obedient-ai/
  .claude-plugin/plugin.json
  hooks/hooks.json
  context/rules.md
  skills/linkedin-post/SKILL.md
```

## Status

Version 0.3.0. The hook and the skill both work; the marketplace installs from GitHub and from a local path.

Known gaps, all present as of 7 September 2026:

- The hook has no assertion behind it. If `context/rules.md` is renamed or emptied, `cat` fails, the session starts with no rules, and nothing warns you.
- The `linkedin-post` skill is hardcoded to the author's voice and biography. It is not parameterised, so every installer gets that persona.
- Its trigger phrases include "help me write", which fires on emails, commits and docs that are not LinkedIn posts.
- No tests and no CI. Nothing validates the three JSON manifests or checks that the rules file is non-empty.
- The rules are unconditional. The `PLAN.md`/`TODO.md` section applies in repos that have neither file.

## License

No licence file yet — all rights reserved.
