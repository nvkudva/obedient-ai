---
name: polish
description: >
  Audit and polish an existing codebase area by area: cleanup, architecture (folder and component
  organization), UI/UX to Apple design standards, performance, production readiness, security,
  data integrity and feature correctness. Each area gets a score and ranked findings with actions;
  nothing changes until the user picks which to apply, then it commits one step at a time.
  Use when the user asks to polish, clean up, tidy, reorganize, audit, review like an architect or an
  Apple designer, make it production ready, check security or data loss, or remove dead code.
  Not for building new features.
---
# Polish

Audit first, change later. Every finding needs evidence (`file:line`, an `rg` count, a measured
number or a screenshot) and an action. Do not edit anything before step 4's answer.

Apply the "Code style" rules (including "Imports and calls") already in context. If they are not in
context, use this short form: small single-purpose functions (about 40 lines), descriptive names,
group by feature, no `utils`/`helpers` folders, call local code through its module, delete dead code.

## 1. Prepare

- `git status` must be clean. If not, stop and ask.
- Find the build, test, lint and run commands (`AGENTS.md`, `package.json`, `pyproject.toml`). Run
  build, tests and lint once and record the result as the baseline. A test that already failed is
  not yours to fix.
- Map cheaply: `git ls-files`, then `rg -n "^(export|def|class|func|fn|pub fn)"`. Skip
  `node_modules`, `dist`, `build`, lockfiles, assets, generated files and fixtures. Open a file in full
  only to judge or edit it.

## 2. Pick the areas

Ask with one multi-select question which areas to audit. Preselect what the user's request named;
offer the rest. Skip UI/UX when the project has no UI.

| Area | Lens | Default |
|---|---|---|
| Cleanup | senior dev | on |
| Architecture | architect | on |
| UI/UX | Apple principal designer | on if there is a UI |
| Performance | performance engineer | on |
| Production readiness | release engineer | on |
| Security | security reviewer | on |
| Data integrity | data engineer | on if the app stores user data |
| Correctness | QA lead | on |

## 3. Audit each chosen area

Score each area 1–10 against its checklist, with one line on why. Then list findings.

**Cleanup.** Dead code: `rg -w <name>` outside its definition, zero hits means a candidate. Never
mark dead without checking framework entry points and routes, decorators, dynamic access
(`getattr`, `import()`, string lookups), CLI entry points and public API. Also: unused imports and
dependencies, commented-out blocks, leftover names from a rename (old product name in strings,
storage keys, CSS classes, file names), stale TODOs and comments, docs naming paths that no longer
exist. README files are out of scope.

**Architecture.** Folders grouped by feature, max 3 levels, no `utils`/`helpers`/`common`.
Duplicate or near-duplicate components and functions that should be one. Components or functions
over about 40 lines or doing two jobs. Two ways of doing one thing (state, API calls, errors,
styling). Vague file, function and boolean names. Shared attributes defined in more than one place
(for example a shape outline and a brush that should come from one source).

**UI/UX.** Look at the real screens, not only the code: screenshot desktop (1440×900), phone
(390×844) and tablet portrait (820×1180) with the preview or browser tools; if none exist, say the
review is code-only. Check against Apple's Human Interface Guidelines: platform system fonts and a
consistent type scale; 4/8 pt spacing; touch targets of at least 44 pt; one radius, border and
icon size per control family; aligned control rows; no clutter, repeated text or walls of
instructions; clear empty, loading, error, disabled and selected states; contrast, labels,
keyboard use and reduced motion; dark mode if offered. Rate it as for an Apple Design Award and
name the three changes that would raise the score most.

**Performance.** Measure before claiming: production build size and first-load size, slow
renders and re-renders, work on the main thread during load, large images and fonts, caching.
Give the number and the file that causes it.

**Production readiness.** Build passes from clean; config and secrets come from the environment;
errors are caught at boundaries and shown to the user; no debug logging or dev flags in the build;
versioning and a release path; for a PWA, the service worker serves the new release on next load
while still caching; CI runs tests and lint; a deploy or run command exists.

**Security.** Secrets in the repo (`gitleaks detect` if installed, else `rg` for keys and tokens);
known-vulnerable dependencies (`npm audit`, `pip-audit`); injection and unsafe HTML (`innerHTML`,
`eval`, `dangerouslySetInnerHTML`, string-built SQL or shell); missing input validation at trust
boundaries; auth and permission checks; sensitive data in local storage or logs; missing CSP or
other headers for a web app.

**Data integrity.** Where user data is saved and when. Check that nothing is lost on refresh,
crash, a second tab or window, or a full storage quota; that schema or key changes migrate old
data instead of dropping it; that concurrent writes cannot overwrite each other; that delete asks
first; that users can export or back up what they made.

**Correctness.** Read each user-facing control and command and confirm its code does what its
label says. List controls that do nothing, do the wrong thing, or behave differently across the
states they appear in (nothing selected, one item, many items). List critical paths with no test.

Each finding: id (`area.n`, for example `ui.3`), one-line symptom, evidence, action, severity
(Must, Should or Nice) and effort (S, M or L). If a finding changes behavior, say so.

## 4. Report, then stop

- One line per area: score and finding count. Then findings, Must first, within each area.
- End with the action plan grouped by effort: small tasks first, then medium, then large.
- Ask one question: apply all Must and Should items (recommended), apply all, apply only small
  tasks, or name the ids to apply or skip. Offer to park items as later (v2) work.
- Wait for the answer. Do not edit before it.

## 5. Apply (after the answer)

- `git switch -c polish/$(date +%Y%m%d)`; if that name exists, add a suffix.
- Work in plan order. One commit per finding, or per area for many small ones, named by id.
- Cleanup and architecture changes keep behavior: moves with `git mv`, renames and import updates
  with `sed` or `sg`, never retype a file. UI, performance, security and data fixes may change
  behavior, but only as the approved finding says.
- After each commit run build, tests and lint, and compare with the baseline. Fix only breakage you
  caused. Write a new test only where an approved finding asked for one.
- After UI changes, screenshot the same three sizes again.
- Same failure 3 times: stop and report what you tried.

## 6. Report

One line per area: new score, findings applied, skipped and why. Then the ids left open, so the
next run can start from them.
