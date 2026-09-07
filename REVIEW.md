# Code review — obedient-ai

A single-plugin Claude Code marketplace whose entire payload is one `SessionStart` hook that `cat`s a rules file into context, plus one bundled `linkedin-post` skill.

Every file in the repo was read in full (six files, ~380 lines of content); nothing was skipped.

## Architecture

There are three layers and no code.

1. **Marketplace layer** — `.claude-plugin/marketplace.json` declares one entry, `obedient-ai`, sourced from the relative path `./obedient-ai`. This is what `claude plugin marketplace add nvkudva/obedient-ai` resolves.
2. **Plugin layer** — `obedient-ai/.claude-plugin/plugin.json` carries name, version `0.3.0`, and description. It declares no paths; hooks and skills are picked up by convention from `hooks/hooks.json` and `skills/*/SKILL.md`.
3. **Payload layer** — `obedient-ai/context/rules.md` (99 lines of standing instructions) and `obedient-ai/skills/linkedin-post/SKILL.md` (236 lines, frontmatter plus body).

Data moves one way and once. `obedient-ai/hooks/hooks.json:8` registers a single command, `cat "${CLAUDE_PLUGIN_ROOT}/context/rules.md"`. Claude Code runs it at session start and appends stdout to the session context. There is no state, no config, no per-project override, no conditional. The skill is loaded lazily by the harness on description match.

**What the structure gets right.** The split between marketplace manifest and plugin manifest is correct, so a second plugin can be added to `plugins[]` without restructuring. Putting the rules in a plain `.md` rather than embedding them in the hook JSON means the payload is diffable and reviewable — the right call. The hook uses `${CLAUDE_PLUGIN_ROOT}` rather than a hardcoded path, so it survives relocation.

**Where it hurts as this grows.** The hook is fire-and-forget with no verification: `cat` on a missing or renamed file exits non-zero, the rules silently do not load, and the session looks normal. Nothing in the repo asserts that `obedient-ai/context/rules.md` exists or that the three JSON files parse — a typo in `hooks.json:8` ships green. Second, the injection is unframed. The rules are written entirely in first person ("I can't see subagent output", `obedient-ai/context/rules.md:13`) but arrive as a bare markdown document starting at an `##` heading with no line identifying whose voice "I" is. The model has to infer that "I" means the user. A one-line header inside `rules.md` fixes this. Third, `rules.md` is monolithic and unconditional — every rule applies to every session in every repo, including the `PLAN.md`/`TODO.md` section (`obedient-ai/context/rules.md:77-92`) which is inert in repos that have neither. As more rule domains are added, splitting `context/` by concern and registering multiple hook commands is the natural next shape.

## Code quality

**Rule quality — the actual product.** `rules.md` is unusually good as a prompt: it is specific, gives thresholds rather than adjectives ("Budget: 20 tool calls", "Max 3 subagents", "under ~50 lines"), and pairs most prohibitions with the replacement behaviour. The response-length section correctly carves out an escape hatch at lines 3-4 so the 6-line ceiling does not suppress output the user asked for. That escape hatch is missing everywhere else: "Never print a file back to me" (`:38`) and "`git diff --stat` first. Full diff only if I ask" (`:41`) are absolute, and the second half of the latter already contradicts the first half of the former if the user does ask.

Two rules conflict with each other. `:28` says do not re-read a file already read this session; `:83` says read `PLAN.md` and `TODO.md` once at session start — but the injected rules cannot know whether those files exist, so the model either reads-to-check (violating "stop exploring the moment you can act", `:53`) or skips them. And `:45` forbids `cat`ing an entire file, which is exactly what `hooks.json:8` does — harmless, but it is the plugin's own first action.

**Skill quality.** `SKILL.md` frontmatter is valid YAML and the body is well organised: persona, style, structure, length ceiling, worked examples, and an explicit anti-pattern list. The four full example posts (`:148-224`, roughly 85 lines) are the strongest part and also the heaviest — they load in full whenever the skill triggers and belong in a `references/examples.md` the skill points to.

The trigger conditions are too broad. `SKILL.md:6` lists `"help me write"` as a trigger phrase and `:7-8` adds "Always use this skill even if the request is casual or vague." "Help me write" fires on emails, commit messages, and documentation. This skill will capture writing requests that have nothing to do with LinkedIn.

The skill is also hardcoded to one person — "Vijay's personal writing style" (`SKILL.md:4`), "17+ years" (`:14`), specific hardware and posts (`:18`, `:152-224`). That is fine for private use and wrong for a plugin published to a public marketplace under `claude plugin marketplace add nvkudva/obedient-ai`, where every installer gets Vijay's voice with no parameterisation.

The skill name `linkedin-post` is unqualified and collides with other catalogs that ship a skill of the same name; namespacing it (`obedient-linkedin-post`) removes the ambiguity at the point of invocation.

**Manifest hygiene.** All three JSON files parse. `plugin.json` uses `displayName`, which is not part of the plugin manifest schema and is ignored — `name` is the display field. `plugin.json` has no `author`, `homepage`, `repository`, `license`, or `keywords`, so the installed plugin listing gives a user no route back to the source. The marketplace entry (`marketplace.json:7-11`) carries no `version`, `author`, `category`, or `keywords`, which is what marketplace browse and search read.

**Config, secrets, dependencies.** No secrets, no credentials, no network calls, no dependencies of any kind. Nothing to audit here and nothing wrong.

**Tests and CI.** None, and no `.github/`. For a repo this small the useful bar is low: a workflow that runs `python3 -m json.tool` over the three manifests and asserts `obedient-ai/context/rules.md` is non-empty would catch every realistic breakage.

**Small things.** `SKILL.md:5` has trailing whitespace. `README.md:45` documents a local-clone install using `~/dev/projects/obedient-ai`, a path that exists only on the author's machine. There is no `.gitignore`, so `.DS_Store` and editor droppings can be committed by accident.

## Risks

- **Silent failure is the main one.** If `context/rules.md` is moved, renamed, or emptied, `hooks.json:8` fails and the session starts with no rules and no warning. The failure mode is invisible: the model just behaves normally. Every user of this plugin depends on a `cat` that has no assertion behind it.
- **`cat` is not portable.** `hooks.json:8` assumes a POSIX shell. On a Windows install without a bash-compatible shell on PATH, the hook fails — again silently. For a plugin distributed publicly this is a real install-base limitation.
- **No licence.** The repo has no `LICENSE` file and neither manifest declares one. It is published to a marketplace and installable by anyone, which leaves reuse terms undefined for every installer.
- **Rule duplication doubles the payload.** These rules are also commonly kept in a user's `~/.claude/CLAUDE.md`. When both are present the identical text loads twice per session — wasted context, and any future edit to one copy silently diverges from the other. The README should state that the plugin replaces the CLAUDE.md copy rather than supplementing it.
- **Over-broad skill triggering** (`SKILL.md:6-8`) will pull the LinkedIn persona into unrelated writing tasks. Low blast radius, high annoyance.

No injection or auth surface exists — the hook reads a file that ships in the repo and executes nothing from outside it.

## Action items

| Priority | Item | File | Why |
|---|---|---|---|
| P0 | Add a `LICENSE` file and a `license` field to both manifests | `.claude-plugin/marketplace.json`, `obedient-ai/.claude-plugin/plugin.json` | Publicly installable with undefined reuse terms |
| P0 | Make the hook fail loudly: `test -f "$F" \|\| { echo "obedient-ai: rules.md missing" >&2; exit 2; }` before the `cat` | `obedient-ai/hooks/hooks.json:8` | A missing rules file currently produces a normal-looking session with no rules |
| P1 | Add a one-line header to the top of the rules identifying them as the user's standing instructions | `obedient-ai/context/rules.md:1` | The whole document is first-person "I"/"me" with no statement of who is speaking |
| P1 | Narrow the skill trigger: drop `"help me write"` and the "always use this skill even if vague" clause | `obedient-ai/skills/linkedin-post/SKILL.md:6-8` | Fires on emails, commits, and docs that are not LinkedIn posts |
| P1 | Resolve the `PLAN.md`/`TODO.md` rule against the do-not-re-read rule — make it conditional on the files existing | `obedient-ai/context/rules.md:83` vs `:28` | Two rules give opposite instructions in a repo that has neither file |
| P1 | Add `author`, `homepage`, `repository`, `keywords` to the plugin manifest | `obedient-ai/.claude-plugin/plugin.json` | Installed listing gives no route back to source |
| P1 | Add `version`, `author`, `category`, `keywords` to the marketplace plugin entry | `.claude-plugin/marketplace.json:7-11` | Marketplace browse and search read these fields |
| P1 | Add a CI workflow validating the three JSON manifests and asserting `context/rules.md` is non-empty | `.github/workflows/` (absent) | Nothing currently catches a typo in the hook path or a broken manifest |
| P1 | Either parameterise the persona or rename the plugin to signal it is personal | `obedient-ai/skills/linkedin-post/SKILL.md:4,14,18` | Public installers inherit one named person's voice and biography |
| P2 | Replace `cat` with a shell-portable read, or document the POSIX-shell requirement | `obedient-ai/hooks/hooks.json:8` | Hook silently no-ops on a Windows install without a POSIX shell |
| P2 | Move the four example posts to `skills/linkedin-post/references/examples.md` and reference them | `obedient-ai/skills/linkedin-post/SKILL.md:144-236` | 85 lines of examples load in full on every trigger |
| P2 | Remove `displayName` from the plugin manifest | `obedient-ai/.claude-plugin/plugin.json:3` | Not in the manifest schema; ignored at load |
| P2 | Namespace the skill directory to avoid collision with other `linkedin-post` skills | `obedient-ai/skills/linkedin-post/` | Ambiguous when multiple catalogs are installed |
| P2 | Add an explicit exception clause to `:38` and `:41` mirroring the one at `:3-4` | `obedient-ai/context/rules.md:38,41` | Absolute prohibitions block output the user directly asks for |
| P2 | State in the README that the plugin replaces a `~/.claude/CLAUDE.md` copy of the same rules | `README.md:12-20` | Both loaded means the rules are injected twice and can silently diverge |
| P2 | Replace the machine-specific example path with a generic one | `README.md:45` | `~/dev/projects/obedient-ai` exists only on the author's machine |
| P2 | Add a `.gitignore` covering `.DS_Store` | repo root (absent) | Prevents accidental commits of OS droppings |
| P2 | Strip trailing whitespace in the skill frontmatter | `obedient-ai/skills/linkedin-post/SKILL.md:5` | Noise inside a YAML folded scalar |
