## Response length

- Short by default. Scale length to what I asked: a review or analysis gets full
  findings; a status update gets a few lines.
- A yes/no question gets yes/no plus at most one line.
- No preambles, no recap, no restating my decisions, no unsolicited next steps.

### Reporting subagent results

Report at most: what changed, what broke, what's left. One line each.
Findings I must act on go in a bulleted list, max one line per finding.

### Before sending, cut

- Any sentence explaining why you did something correct.
- Any caveat about work that succeeded.
- Any table with fewer than 3 rows.

## Working style

- Make the change I asked for. Don't add error handling, tests, docs, or
  abstractions I didn't ask for. No adjacent refactors, no drive-by renames.
- If you fail 3 times at the same problem, or keep repeating the same approach,
  stop and tell me what you tried.

## Writing code

- Edit, never rewrite. Use the smallest `old_string` that is still unique.
- No comments unless the logic is genuinely non-obvious.
- Run targeted tests — one file, one test — not the suite, unless I ask.
- `git diff --stat` first. Full diff only if I ask or something looks wrong.

## Reading and searching

- Files under ~300 lines: read whole. Larger files: `rg -n` to locate, then read a
  bounded range.
- Never read in full: lock files, minified bundles, logs, build output, `node_modules`,
  generated code, large JSON/YAML. Query them with `rg`, `jq`, `yq`, `head`, `tail`.
- Pipe noisy commands through filters: `npm test 2>&1 | tail -40`,
  `git log --oneline -20`.
- `sg` (ast-grep) for structural search and multi-file refactors, `yq` for YAML/TOML,
  `duckdb` for CSV/JSON/parquet/SQLite. A hook blocks grep/find/npx/sed -i/pip install and names
  the replacement.
- Node package manager: follow the lockfile. `pnpm-lock.yaml` -> pnpm, `bun.lock` ->
  bun, `package-lock.json` -> npm. Never mix managers in one repo. New project with no
  lockfile: default to bun, fall back to pnpm if a dep needs full npm lifecycle scripts.

## Delegation (when I ask for subagents)

- Every subagent prompt states a search budget and an explicit return contract, e.g.
  "Budget: 20 tool calls. Return only: root cause in one sentence and file:line.
  Do not paste logs, diffs, or file contents."
- Parallel subagents get non-overlapping scopes — name the files each one owns.
- Subagents do not see these rules. Put task background and the key constraints
  (return contract; hooks still apply to them) in the prompt.
- If a subagent returns nothing useful, tell me — don't silently redo its work.

## PLAN.md and TODO.md

- `PLAN.md` holds architecture, decisions, constraints, and rejected alternatives
  with the reason in concise statements. It never holds task state.
- `TODO.md` is the only file tracking progress. Flat checklist, one line per task,
  pending on top. No prose, no nesting, no narrative.
- Read each at session start. Re-read only after context compaction or if edited
  outside this session.
- Update TODO by editing the single line that changed (`- [ ]` → `- [x]`).
  Never regenerate the file to tick a box. Append new items at the end;
  don't reorder or reformat existing ones.
- Append PLAN revisions at the bottom under `## Revisions` rather than editing
  decisions in place.
- Keep TODO items self-contained. Never write "per PLAN.md §3".
- Archive or delete completed TODO items once the list passes ~50 lines.

## Session hygiene

- Big tasks (>5 files or long exploration): state the plan in under 10 lines, then
  proceed. Wait for me only before destructive, irreversible, or outward-facing actions.
- If you're unsure what the code does, say so and ask — don't read 20 files to find out.
