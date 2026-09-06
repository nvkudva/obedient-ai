# obedient-ai

A Claude Code plugin marketplace with one plugin, `hook-obedient-ai`, which loads a
set of standing rules into every session via a `SessionStart` hook, and ships a
`linkedin-post` skill.

The rules cover response length, working style, code editing, reading/searching,
delegation, `PLAN.md`/`TODO.md` conventions, and session hygiene. They live in
[`hook-obedient-ai/context/rules.md`](hook-obedient-ai/context/rules.md) — edit that
file to change what gets injected.

## How it works

`hooks/hooks.json` registers a single `SessionStart` command:

```
cat "${CLAUDE_PLUGIN_ROOT}/context/rules.md"
```

Claude Code runs it at session start and adds the output to the session context.

The plugin also bundles the `linkedin-post` skill in
[`hook-obedient-ai/skills/linkedin-post/SKILL.md`](hook-obedient-ai/skills/linkedin-post/SKILL.md).
It defines the persona, structure, and style rules for drafting LinkedIn posts, and
triggers whenever a post is being written or refined.

## Install — terminal (Claude Code CLI)

```bash
claude plugin marketplace add nvkudva/obedient-ai
```

```bash
claude plugin install hook-obedient-ai@obedient-ai
```

Or from inside a session, `/plugin marketplace add nvkudva/obedient-ai` then
`/plugin install hook-obedient-ai@obedient-ai`.

Start a new session and the rules are loaded. Verify with `/plugin` or `claude plugin list`.

### Install from a local clone

```bash
claude plugin marketplace add ~/dev/projects/obedient-ai
```

## Install — claude.ai (cloud sessions)

1. Go to **claude.ai/settings/capabilities**.
2. Open the **Plugins** section and click **Add marketplace**.
3. Enter `nvkudva/obedient-ai` and confirm.
4. Find **hook-obedient-ai** in the list and toggle it **on**.

New cloud sessions pick up the rules; existing ones need a restart.

## Layout

```
.claude-plugin/marketplace.json
hook-obedient-ai/
  .claude-plugin/plugin.json
  hooks/hooks.json
  context/rules.md
  skills/linkedin-post/SKILL.md
```
