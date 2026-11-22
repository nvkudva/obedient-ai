---
name: polish
description: >
  Polish any existing codebase for clarity without changing behavior: remove dead code, reorganize folders,
  rename files and functions, split oversized functions, tidy tests and docs. README files are out of scope.
  Plans first, waits for approval, then commits one step at a time.
  Use when the user asks to polish, clean up, tidy, reorganize, rename files, remove dead code, or refactor for clarity.
  Not for new features or bug fixes.
---
# Polish

Apply the "Code style" rules (including "Imports and calls") already in context to code that exists. If they are not in context, use this short form: small single-purpose functions (about 40 lines), descriptive names, group by feature, no `utils`/`helpers` folders, call local code through its module, delete dead code.
Behavior must not change. No new abstractions. Never touch README files.

## 1. Prepare
- `git status` must be clean. If not, stop and ask.
- `git switch -c chore/cleanup-$(date +%Y%m%d)`; if that name exists, add a suffix.
- Find the test and lint commands (project `CLAUDE.md`, `package.json`, `pyproject.toml`). Run them once now and record the result. Later runs are compared with this baseline: a test that already failed is not yours to fix.

## 2. Map (cheap)
- `git ls-files` only. Skip `node_modules`, `dist`, `build`, lockfiles, assets, generated files, snapshots, fixtures.
- Get structure from `rg -n "^(export|def|class|func|fn|pub fn)"`, not from reading files.
- Open a file in full only to edit it.

## 3. Find
- **Dead code:** for each top-level symbol and file, `rg -w <name>` outside its definition. Zero hits means candidate.
  Also unused imports (linter: `ruff` F401, eslint `no-unused-vars`) and commented-out blocks.
  Never mark dead without checking: framework entry points and routes, decorators, dynamic access
  (`getattr`, `import()`, string lookups), CLI entry points, public library API. List test-only references separately.
- **Structure:** folders grouped by feature, max 3 levels, no `utils`/`helpers`/`common`.
- **Names:** vague file, function and boolean names, per the naming rules.
- **Splits:** functions over about 40 lines or doing two jobs.
- **Tests:** vague names (`test 1`, "should work"), tests for code that no longer exists, `skip`/`xfail` with no reason,
  tests that always pass (empty or trivial assertions), setup repeated in every test.
  Also exported functions with no test at all.
- **Docs:** `.md` files and docstrings outside README that mention paths, names or commands that no longer exist.
  Stale or restating comments and stale TODOs in code.

## 4. Plan, then stop
Output once, max 50 lines, then wait for approval:
1. Dead code: symbol or file, `rg` evidence, risk flag if any.
2. Folder tree: new layout.
3. Rename table: old to new, for files, folders and functions.
4. Split list: function and the two jobs.
5. Tests: renames by behavior, obsolete tests to delete, and untested functions (name and what to assert).
6. Docs: file or line and the fix.

## 5. Execute (after approval)
One commit per step, in this order: dead code, moves, renames, splits, tests, docs.
- Moves: `git mv`. Renames and import updates: `sed` or `sg`. Never retype a file.
- Tests: rename and delete only. Write a new test only for an untested function the plan listed and I approved.
- Docs: edit only the lines that are wrong.
- Run tests and lint after each commit. Fix only breakage you caused.
- Same failure 3 times: stop and report what you tried.

## 6. Report
Max 5 lines: counts of files moved, renamed, deleted, functions split, tests changed and docs fixed, plus anything skipped and why.
